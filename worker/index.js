// Brain Dump backup server (Cloudflare Worker + D1).
// Serves the app's files, keeps a private copy of every note, and reads handwriting with Claude.
//
// Data is stored as opaque JSON text so the Worker never has to parse big payloads
// (keeps each request well inside the free plan's CPU limit).
import Anthropic from '@anthropic-ai/sdk';

const MODELS = {
  accurate: 'claude-opus-5-5',
  budget: 'claude-haiku-5-5',
};

const OCR_PROMPT = `This is a page from someone's personal notebook (handwriting, maybe on a printed template or a scanned paper page).
Transcribe every word on it so the page can be found with a text search later.
- Output only the transcribed text, in reading order, one line per written line.
- Include printed headings and labels too.
- If a word is hard to read, write your best guess.
- Do not describe the page, add commentary, or use markdown.
- If there is no text at all, output nothing.`;

let schemaReady = false;

async function ensureSchema(env) {
  if (schemaReady) return;
  await env.DB.batch([
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS records (
      kind TEXT NOT NULL, id TEXT NOT NULL, updated_at INTEGER NOT NULL,
      srv INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (kind, id))`),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS records_srv ON records(srv)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, mime TEXT NOT NULL, b64 TEXT NOT NULL, srv INTEGER NOT NULL)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)'),
  ]);
  schemaReady = true;
}

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function getSetting(env, key) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first();
  return row ? row.value : null;
}

async function setSetting(env, key, value) {
  await env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(key, value).run();
}

async function isAuthed(req, env) {
  const h = req.headers.get('authorization') || '';
  const token = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
  if (!token) return false;
  const stored = await getSetting(env, 'auth_hash');
  if (!stored) return false;
  const hash = await sha256(token);
  // constant-time-ish compare
  if (hash.length !== stored.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= hash.charCodeAt(i) ^ stored.charCodeAt(i);
  return diff === 0;
}

let lastSrv = 0;
function nextSrv() {
  lastSrv = Math.max(Date.now() * 1000, lastSrv + 1);
  return lastSrv;
}

async function handleApi(req, env, url) {
  await ensureSchema(env);
  const path = url.pathname.replace(/^\/api/, '');

  if (path === '/status' && req.method === 'GET') {
    const setup = !!(await getSetting(env, 'auth_hash'));
    if (!(await isAuthed(req, env))) return json({ setup, authed: false });
    return json({
      setup, authed: true,
      ocrKey: !!(await getSetting(env, 'anthropic_key')),
      ocrModel: (await getSetting(env, 'ocr_model')) || 'accurate',
    });
  }

  if (path === '/setup' && req.method === 'POST') {
    const { token } = await req.json();
    if (!token || String(token).length < 32) return json({ error: 'bad token' }, 400);
    const existing = await getSetting(env, 'auth_hash');
    if (existing) {
      // Re-entering the same password on a new device is fine.
      if (existing === (await sha256(token))) return json({ ok: true, existing: true });
      return json({ error: 'A backup password is already set. Use that password.' }, 409);
    }
    await setSetting(env, 'auth_hash', await sha256(token));
    return json({ ok: true });
  }

  if (!(await isAuthed(req, env))) return json({ error: 'Wrong password or not set up' }, 401);

  if (path === '/push' && req.method === 'POST') {
    const { records } = await req.json();
    if (!Array.isArray(records) || records.length > 500) return json({ error: 'bad batch' }, 400);
    const stmts = [];
    let srv = 0;
    for (const r of records) {
      if (!r || typeof r.kind !== 'string' || typeof r.id !== 'string' || typeof r.data !== 'string') continue;
      srv = nextSrv();
      stmts.push(env.DB.prepare(`INSERT INTO records (kind, id, updated_at, srv, data) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(kind, id) DO UPDATE SET updated_at = excluded.updated_at, srv = excluded.srv, data = excluded.data
        WHERE excluded.updated_at >= records.updated_at`).bind(r.kind, r.id, Math.floor(r.updatedAt || 0), srv, r.data));
    }
    if (stmts.length) await env.DB.batch(stmts);
    return json({ ok: true, count: stmts.length });
  }

  if (path === '/pull' && req.method === 'GET') {
    const since = Number(url.searchParams.get('since') || 0);
    const limit = Math.min(200, Number(url.searchParams.get('limit') || 100));
    const { results } = await env.DB.prepare('SELECT kind, id, updated_at, srv, data FROM records WHERE srv > ? ORDER BY srv LIMIT ?')
      .bind(since, limit + 1).all();
    const more = results.length > limit;
    const rows = results.slice(0, limit);
    // Build the response by hand so the (possibly large) data JSON is never parsed here.
    const body = '{"records":[' + rows.map((r) =>
      `{"kind":${JSON.stringify(r.kind)},"id":${JSON.stringify(r.id)},"updatedAt":${r.updated_at},"srv":${r.srv},"data":${r.data}}`).join(',') +
      `],"more":${more},"last":${rows.length ? rows[rows.length - 1].srv : since}}`;
    return new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
  }

  const blobMatch = path.match(/^\/blob\/([A-Za-z0-9_-]{6,64})$/);
  if (blobMatch) {
    const id = blobMatch[1];
    if (req.method === 'PUT') {
      const mime = (req.headers.get('x-mime') || 'image/jpeg').slice(0, 60);
      const b64 = await req.text();
      if (b64.length > 1_990_000) return json({ error: 'too big' }, 413);
      await env.DB.prepare('INSERT INTO blobs (id, mime, b64, srv) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET mime = excluded.mime, b64 = excluded.b64, srv = excluded.srv')
        .bind(id, mime, b64, nextSrv()).run();
      return json({ ok: true });
    }
    if (req.method === 'GET') {
      const row = await env.DB.prepare('SELECT mime, b64 FROM blobs WHERE id = ?').bind(id).first();
      if (!row) return json({ error: 'not found' }, 404);
      return new Response(row.b64, { headers: { 'content-type': 'text/plain', 'x-mime': row.mime, 'cache-control': 'no-store' } });
    }
  }

  if (path === '/blobs' && req.method === 'GET') {
    const { results } = await env.DB.prepare('SELECT id FROM blobs').all();
    return json({ ids: results.map((r) => r.id) });
  }

  if (path === '/settings' && req.method === 'POST') {
    const body = await req.json();
    if (typeof body.anthropicKey === 'string') {
      const key = body.anthropicKey.trim();
      if (key) await setSetting(env, 'anthropic_key', key);
      else await env.DB.prepare('DELETE FROM settings WHERE key = ?').bind('anthropic_key').run();
    }
    if (body.ocrModel === 'accurate' || body.ocrModel === 'budget') await setSetting(env, 'ocr_model', body.ocrModel);
    return json({ ok: true });
  }

  if (path === '/ocr' && req.method === 'POST') {
    const apiKey = await getSetting(env, 'anthropic_key');
    if (!apiKey) return json({ error: 'No Claude API key saved yet.' }, 412);
    const { image, mediaType = 'image/jpeg' } = await req.json();
    if (!image || image.length > 7_000_000) return json({ error: 'bad image' }, 400);
    const modelKey = (await getSetting(env, 'ocr_model')) || 'accurate';
    return json(await readHandwriting(apiKey, modelKey, image, mediaType));
  }

  return json({ error: 'not found' }, 404);
}

async function readHandwriting(apiKey, modelKey, image, mediaType) {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const model = MODELS[modelKey] || MODELS.accurate;
  const params = {
    model,
    max_tokens: 8000,
    output_config: { effort: 'low' }, // plain transcription doesn't need deep thinking
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
        { type: 'text', text: OCR_PROMPT },
      ],
    }],
  };
  try {
    let response;
    if (model === MODELS.accurate) {
      // If a safety check ever declines a page, let the API retry on a fallback model automatically.
      response = await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } else {
      response = await client.messages.create(params);
    }
    if (response.stop_reason === 'refusal') return { text: '', refused: true };
    const text = response.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    return { text, model: response.model };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { error: 'Your Claude API key was rejected. Check it in Settings.', status: 401 };
    if (err instanceof Anthropic.RateLimitError) return { error: 'Claude is busy (rate limited). Will try again later.', retry: true, status: 429 };
    if (err instanceof Anthropic.APIError) return { error: `Claude API error ${err.status}`, retry: (err.status || 500) >= 500, status: err.status };
    return { error: 'Could not reach Claude', retry: true };
  }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(req, env, url);
      } catch (err) {
        return json({ error: String(err && err.message || err) }, 500);
      }
    }
    return env.ASSETS.fetch(req);
  },
};
