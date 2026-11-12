// The app's data model: folders, notes (with sub-notes), pages, assets, custom templates.
// Every save also marks the record "dirty" so the backup knows what to upload.
import * as db from './db.js';

export const bus = new EventTarget();
export function emit(type, detail = {}) {
  bus.dispatchEvent(new CustomEvent(type, { detail }));
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now())
  .replace(/-/g, '').slice(0, 20);

export const TAB_COLORS = ['#f39a8a', '#ee6b6b', '#e94b86', '#c4479e', '#8e5aa8', '#6a5fb0',
  '#3f7cc4', '#14a3d6', '#14b8b0', '#5fc18a', '#a5cc4c', '#e6c92a'];

function dirty(kind, id) {
  return { store: 'dirty', value: { key: `${kind}:${id}`, kind, id, at: Date.now() } };
}

// ---------- page size (matches the iPad screen, worked out once) ----------
let pageSizeCache;
export async function pageSize() {
  if (pageSizeCache) return pageSizeCache;
  let size = await db.getMeta('pageSize');
  if (!size) {
    const short = Math.min(screen.width, screen.height);
    const long = Math.max(screen.width, screen.height);
    const touch = navigator.maxTouchPoints > 1;
    // Pages are 1640 units wide (2× an iPad Air's 820pt portrait width) and as tall as the screen shape.
    const ratio = touch && short > 600 ? long / short : 2360 / 1640;
    size = { w: 1640, h: Math.round(1640 * ratio) };
    await db.setMeta('pageSize', size);
  }
  pageSizeCache = size;
  return size;
}

/** Page size for a background: custom templates keep their own shape. */
export async function sizeForBg(bg) {
  if (bg && bg.kind === 'custom') {
    const t = await db.get('templates', bg.id);
    if (t && t.w && t.h) return { w: t.w, h: t.h };
  }
  return pageSize();
}

// ---------- items (folders + notes) ----------
export async function allItems() {
  return db.getAll('items');
}

export async function getItem(id) {
  return db.get('items', id);
}

export async function saveItem(item, { touch = true } = {}) {
  if (touch) item.updatedAt = Date.now();
  await db.batch([{ store: 'items', value: item }, dirty('item', item.id)]);
  emit('items-changed', { id: item.id });
  return item;
}

export function niceDate(d = new Date()) {
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export async function createFolder({ parentId = null, title = 'New folder' } = {}) {
  const now = Date.now();
  return saveItem({ id: uid(), type: 'folder', parentId, title, createdAt: now, updatedAt: now });
}

export function newPage(noteId, bg, size, extra = {}) {
  const now = Date.now();
  return { id: uid(), noteId, w: size.w, h: size.h, bg, strokes: [], inkAt: 0, ocrText: '', ocrAt: 0,
    createdAt: now, updatedAt: now, ...extra };
}

/** Create a note with its first page(s). templateBg: {kind:'template', id} | {kind:'custom', id} */
export async function createNote({ parentId = null, title, bg = { kind: 'template', id: 'lined' } } = {}) {
  const size = await sizeForBg(bg);
  const now = Date.now();
  const note = { id: uid(), type: 'note', parentId, title: title || `${niceDate()} note`,
    createdAt: now, updatedAt: now, pageIds: [], lastBg: bg };
  const pages = [];
  if (bg.kind === 'template' && bg.id === 'tabbed') {
    note.tabs = Array.from({ length: 6 }, (_, i) => ({ id: uid(), label: String(i + 1).padStart(2, '0'), color: TAB_COLORS[i * 2 % 12] }));
    for (const tab of note.tabs) pages.push(newPage(note.id, bg, size, { tabId: tab.id }));
  } else {
    pages.push(newPage(note.id, bg, size));
  }
  note.pageIds = pages.map((p) => p.id);
  await db.batch([
    { store: 'items', value: note }, dirty('item', note.id),
    ...pages.flatMap((p) => [{ store: 'pages', value: p }, dirty('page', p.id)]),
  ]);
  await db.setMeta('lastBg', bg);
  emit('items-changed', { id: note.id });
  return note;
}

/** Create a note made of imported images (scans). images: [{assetId, w, h}] */
export async function createNoteFromImages({ parentId = null, title, images }) {
  const now = Date.now();
  const note = { id: uid(), type: 'note', parentId, title: title || `Scan ${niceDate()}`,
    createdAt: now, updatedAt: now, pageIds: [], lastBg: { kind: 'template', id: 'blank' } };
  const pages = images.map((img) => newPage(note.id, { kind: 'image', assetId: img.assetId }, { w: img.w, h: img.h }));
  note.pageIds = pages.map((p) => p.id);
  await db.batch([
    { store: 'items', value: note }, dirty('item', note.id),
    ...pages.flatMap((p) => [{ store: 'pages', value: p }, dirty('page', p.id)]),
  ]);
  emit('items-changed', { id: note.id });
  return note;
}

export async function renameItem(id, title) {
  const item = await getItem(id);
  if (!item) return;
  item.title = title.trim() || item.title;
  return saveItem(item);
}

/** true if `candidate` is `id` or lives somewhere underneath it */
export function isWithin(items, candidateId, id) {
  const byId = new Map(items.map((i) => [i.id, i]));
  let cur = byId.get(candidateId);
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur.id === id) return true;
    cur = cur.parentId ? byId.get(cur.parentId) : null;
  }
  return false;
}

export async function moveItem(id, newParentId) {
  const items = await allItems();
  if (newParentId && isWithin(items, newParentId, id)) throw new Error("Can't move something inside itself.");
  const item = items.find((i) => i.id === id);
  item.parentId = newParentId || null;
  return saveItem(item);
}

function descendants(items, id) {
  const out = [];
  const walk = (pid) => {
    for (const it of items) if (it.parentId === pid && !out.includes(it)) { out.push(it); walk(it.id); }
  };
  walk(id);
  return out;
}

/** Soft delete: goes to "Recently deleted" with everything inside it. */
export async function deleteItem(id) {
  const items = await allItems();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const stamp = Date.now();
  const all = [item, ...descendants(items, id).filter((d) => !d.deletedAt)];
  const ops = [];
  for (const it of all) {
    it.deletedAt = stamp;
    it.updatedAt = stamp;
    ops.push({ store: 'items', value: it }, dirty('item', it.id));
  }
  await db.batch(ops);
  emit('items-changed', { id });
}

export async function restoreItem(id) {
  const items = await allItems();
  const item = items.find((i) => i.id === id);
  if (!item) return;
  const stamp = item.deletedAt;
  const all = [item, ...descendants(items, id).filter((d) => d.deletedAt === stamp)];
  // If its parent is still deleted, bring it back to the top level.
  const parent = item.parentId && items.find((i) => i.id === item.parentId);
  if (parent && parent.deletedAt) item.parentId = null;
  const ops = [];
  for (const it of all) {
    delete it.deletedAt;
    it.updatedAt = Date.now();
    ops.push({ store: 'items', value: it }, dirty('item', it.id));
  }
  await db.batch(ops);
  emit('items-changed', { id });
}

// ---------- pages ----------
export async function getPage(id) {
  return db.get('pages', id);
}

export async function getPages(note) {
  const pages = await Promise.all(note.pageIds.map((id) => db.get('pages', id)));
  return pages.filter(Boolean);
}

export async function savePage(page, { ink = false } = {}) {
  const now = Date.now();
  page.updatedAt = now;
  if (ink) page.inkAt = now;
  // store a clean copy (the editor caches bounding boxes on stroke objects)
  const rec = { ...page, strokes: (page.strokes || []).map((s) => { if (!s._box) return s; const { _box, ...r } = s; return r; }) };
  await db.batch([{ store: 'pages', value: rec }, dirty('page', page.id)]);
  emit('page-saved', { id: page.id, noteId: page.noteId });
}

/** Insert pages into a note after index (or at end). */
export async function insertPages(note, pages, afterIndex = note.pageIds.length - 1) {
  note.pageIds.splice(afterIndex + 1, 0, ...pages.map((p) => p.id));
  const now = Date.now();
  note.updatedAt = now;
  await db.batch([
    ...pages.flatMap((p) => [{ store: 'pages', value: p }, dirty('page', p.id)]),
    { store: 'items', value: note }, dirty('item', note.id),
  ]);
  emit('items-changed', { id: note.id });
}

export async function removePage(note, pageId) {
  note.pageIds = note.pageIds.filter((id) => id !== pageId);
  const page = await getPage(pageId);
  const ops = [{ store: 'items', value: { ...note, updatedAt: Date.now() } }, dirty('item', note.id)];
  if (page) {
    page.deletedAt = Date.now();
    page.updatedAt = page.deletedAt;
    ops.push({ store: 'pages', value: page }, dirty('page', page.id));
  }
  note.updatedAt = Date.now();
  await db.batch(ops);
  emit('items-changed', { id: note.id });
}

// ---------- assets + custom templates ----------
export async function saveAsset({ blob, mime, w, h }) {
  const asset = { id: uid(), blob, mime: mime || blob.type, w, h, updatedAt: Date.now() };
  await db.batch([{ store: 'assets', value: asset }, dirty('asset', asset.id)]);
  return asset;
}

export async function getAsset(id) {
  return db.get('assets', id);
}

export async function customTemplates() {
  return (await db.getAll('templates')).filter((t) => !t.deletedAt).sort((a, b) => a.createdAt - b.createdAt);
}

export async function saveTemplate(t) {
  t.updatedAt = Date.now();
  t.createdAt = t.createdAt || t.updatedAt;
  await db.batch([{ store: 'templates', value: t }, dirty('template', t.id)]);
  emit('templates-changed');
  return t;
}

export async function deleteTemplate(id) {
  const t = await db.get('templates', id);
  if (!t) return;
  t.deletedAt = Date.now();
  await saveTemplate(t);
}
