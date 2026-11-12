// Automatic backup to your private Cloudflare database, plus background handwriting reading.
// Everything works offline; this just copies changes up (and down) whenever there's signal.
import * as db from './db.js';
import * as store from './store.js';
import * as ink from './ink.js';
import * as tpl from './templates.js';

const API = '/api';
const PUSH_BUDGET = 900_000; // bytes per upload request
const OVERLAP = 300e6; // re-check the last 5 minutes of server changes each pull (srv is µs)
const OCR_IDLE_MS = 90_000; // wait until you've stopped writing on a page for 90s
const OCR_PER_RUN = 6;

const st = { token: null, state: 'off', lastSync: 0, message: '', running: null, server: null };
const listeners = new Set();
export function onStatus(fn) { listeners.add(fn); }
function setState(state, message = '') {
  st.state = state; st.message = message;
  for (const fn of listeners) fn();
}

export function statusText() {
  if (st.state === 'off') return { text: 'Backup is off — tap to set it up', warn: true };
  if (st.state === 'syncing') return { text: 'Backing up…' };
  if (st.state === 'offline') return { text: `Offline — saved on this iPad${st.lastSync ? ` (last backup ${ago(st.lastSync)})` : ''}` };
  if (st.state === 'error') return { text: `Backup problem: ${st.message || 'will retry'}`, warn: true };
  return { text: st.lastSync ? `Backed up ${ago(st.lastSync)}` : 'Backup on' };
}

function ago(ts) {
  const d = Date.now() - ts;
  if (d < 90e3) return 'just now';
  if (d < 3600e3) return `${Math.round(d / 60e3)} min ago`;
  return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (st.token) headers.authorization = `Bearer ${st.token}`;
  if (opts.json !== undefined) { headers['content-type'] = 'application/json'; opts.body = JSON.stringify(opts.json); }
  const res = await fetch(API + path, { ...opts, headers });
  return res;
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function init() {
  st.token = await db.getMeta('syncToken', null);
  st.lastSync = await db.getMeta('lastSync', 0);
  setState(st.token ? 'idle' : 'off');
  let t;
  const soon = () => { clearTimeout(t); t = setTimeout(() => syncNow(), 4000); };
  store.bus.addEventListener('items-changed', soon);
  store.bus.addEventListener('page-saved', soon);
  store.bus.addEventListener('templates-changed', soon);
  window.addEventListener('online', () => syncNow());
  window.addEventListener('offline', () => st.token && setState('offline'));
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); else if (st.token) syncNow(); });
  setInterval(() => syncNow(), 3 * 60e3);
  syncNow();
}

export function isOn() { return !!st.token; }

/** First-time setup (or joining from another device) with a password you choose. */
export async function setPassword(password) {
  const token = await sha256('braindump-v1:' + password);
  const res = await fetch(`${API}/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token }) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Setup failed (${res.status})`);
  st.token = token;
  await db.setMeta('syncToken', token);
  setState('idle');
  await syncNow();
  return body;
}

export async function serverStatus() {
  try {
    const res = await api('/status');
    st.server = await res.json();
  } catch { st.server = null; }
  return st.server;
}

export async function saveServerSettings(settings) {
  const res = await api('/settings', { method: 'POST', json: settings });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
  return serverStatus();
}

export function syncNow() {
  if (!st.token) { setState('off'); return Promise.resolve(); }
  if (st.running) return st.running;
  if (!navigator.onLine) { setState('offline'); return Promise.resolve(); }
  st.running = (async () => {
    setState('syncing');
    try {
      await push();
      const changed = await pull();
      st.lastSync = Date.now();
      await db.setMeta('lastSync', st.lastSync);
      setState('idle');
      if (changed) store.emit('remote-changed');
      readHandwriting().catch((e) => console.warn('ocr', e));
    } catch (e) {
      console.warn('sync', e);
      setState(navigator.onLine ? 'error' : 'offline', e.message === 'auth' ? 'password not accepted — re-enter it in Settings' : 'will retry');
    } finally {
      st.running = null;
    }
  })();
  return st.running;
}

function toB64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function fromB64(b64, mime) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

const STORE_OF = { item: 'items', page: 'pages', template: 'templates', asset: 'assets' };

async function push() {
  const dirty = await db.getAll('dirty');
  if (!dirty.length) return;
  let batch = [], size = 0, done = [];
  const flush = async () => {
    if (!batch.length) return;
    const res = await api('/push', { method: 'POST', json: { records: batch } });
    if (res.status === 401) throw new Error('auth');
    if (!res.ok) throw new Error(`push ${res.status}`);
    for (const d of done) {
      const cur = await db.get('dirty', d.key);
      if (cur && cur.at === d.at) await db.del('dirty', d.key);
    }
    batch = []; size = 0; done = [];
  };
  for (const d of dirty) {
    const rec = await db.get(STORE_OF[d.kind], d.id);
    if (!rec) { await db.del('dirty', d.key); continue; }
    let data;
    if (d.kind === 'asset') {
      // upload the image itself first, then its description
      const b64 = await toB64(rec.blob);
      const res = await api(`/blob/${rec.id}`, { method: 'PUT', body: b64, headers: { 'x-mime': rec.mime || 'image/jpeg', 'content-type': 'text/plain' } });
      if (res.status === 401) throw new Error('auth');
      if (!res.ok) throw new Error(`blob ${res.status}`);
      const { blob, ...meta } = rec;
      data = JSON.stringify(meta);
    } else {
      data = JSON.stringify(rec);
    }
    if (size + data.length > PUSH_BUDGET) await flush();
    batch.push({ kind: d.kind, id: d.id, updatedAt: rec.updatedAt || 0, data });
    size += data.length;
    done.push(d);
    if (batch.length >= 200) await flush();
  }
  await flush();
}

async function pull() {
  let since = await db.getMeta('pullSince', 0);
  let changed = false;
  let maxSeen = since;
  for (let guard = 0; guard < 500; guard++) {
    const res = await api(`/pull?since=${since}&limit=100`);
    if (res.status === 401) throw new Error('auth');
    if (!res.ok) throw new Error(`pull ${res.status}`);
    const { records, more, last } = await res.json();
    for (const r of records) {
      const storeName = STORE_OF[r.kind];
      if (!storeName) continue;
      const local = await db.get(storeName, r.id);
      if (local && (local.updatedAt || 0) >= (r.updatedAt || 0)) continue;
      if (r.kind === 'asset') {
        if (local && local.blob) continue;
        const b = await api(`/blob/${r.id}`);
        if (!b.ok) continue;
        const mime = b.headers.get('x-mime') || r.data.mime || 'image/jpeg';
        await db.put('assets', { ...r.data, blob: fromB64(await b.text(), mime) });
      } else {
        await db.put(storeName, r.data);
      }
      changed = true;
    }
    since = last;
    maxSeen = Math.max(maxSeen, last);
    if (!more) break;
  }
  await db.setMeta('pullSince', Math.max(0, maxSeen - OVERLAP));
  return changed;
}

// ---------------------------------------------------------------- handwriting reading
let ocrRunning = false;

export async function pagesWaiting() {
  const [pages, items] = await Promise.all([db.getAll('pages'), db.getAll('items')]);
  const liveNotes = new Map(items.filter((i) => i.type === 'note' && !i.deletedAt).map((n) => [n.id, n]));
  const now = Date.now();
  return pages.filter((p) => {
    const note = liveNotes.get(p.noteId);
    if (!note || p.deletedAt || !note.pageIds.includes(p.id)) return false;
    const hasContent = (p.strokes && p.strokes.length) || (p.bg && p.bg.kind === 'image');
    if (!hasContent) return false;
    const changedAt = Math.max(p.inkAt || 0, p.bg && p.bg.kind === 'image' ? p.createdAt || 1 : 0);
    return changedAt > (p.ocrAt || 0) && now - (p.inkAt || 0) > OCR_IDLE_MS;
  });
}

export async function readHandwriting({ force = false } = {}) {
  if (ocrRunning || !st.token || !navigator.onLine) return 0;
  const server = st.server || (await serverStatus());
  if (!server || !server.ocrKey) return 0;
  ocrRunning = true;
  let done = 0;
  try {
    const waiting = (await pagesWaiting()).slice(0, force ? 30 : OCR_PER_RUN);
    for (const p of waiting) {
      const image = await renderForReading(p);
      const res = await api('/ocr', { method: 'POST', json: { image, mediaType: 'image/jpeg' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.error) { console.warn('ocr failed', body.error || res.status); break; }
      const fresh = await db.get('pages', p.id);
      if (!fresh) continue;
      fresh.ocrText = body.text || '';
      fresh.ocrAt = Date.now();
      await store.savePage(fresh);
      done++;
    }
  } finally {
    ocrRunning = false;
  }
  return done;
}

/** Draw a page (scan + ink, ink always black) onto white for reading. Returns base64 JPEG. */
async function renderForReading(page) {
  const W = 1000;
  const H = Math.round((W * page.h) / page.w);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  if (page.bg && page.bg.kind === 'image') {
    const url = await tpl.assetURL(page.bg.assetId);
    if (url) {
      const img = new Image();
      img.src = url;
      try { await img.decode(); ctx.drawImage(img, 0, 0, W, H); } catch {}
    }
  }
  ctx.setTransform(W / page.w, 0, 0, H / page.h, 0, 0);
  for (const s of page.strokes || []) ink.drawStroke(ctx, { ...s, c: 'k' });
  const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.8));
  c.width = 0;
  return toB64(blob);
}
