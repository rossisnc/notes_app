// The table of contents: folders, sub-folders, notes and sub-notes in one simple list, plus search.
import * as store from './store.js';
import * as db from './db.js';
import { el, icon, iconBtn, actions, confirmBox, promptBox, toast, ago, escapeHTML, sheet } from './ui.js';
import { pickTemplate } from './picker.js';
import { importScansAsNote } from './importer.js';

let L = null;

export async function showLibrary({ openNote, openSettings, syncStatus }) {
  const expanded = new Set(await db.getMeta('expanded', []));
  const search = el('input', { class: 'search-input', type: 'search', placeholder: 'Search titles and handwriting', 'aria-label': 'Search', autocomplete: 'off' });
  const list = el('div', { class: 'tree', role: 'tree' });
  const status = el('button', { class: 'sync-status', onclick: openSettings });
  const root = el('section', { class: 'library' },
    el('header', { class: 'toolbar lib-bar' },
      el('h1', { class: 'app-title' }, 'Brain Dump'),
      el('div', { class: 'search-wrap', html: icon('search', 18) }, search),
      iconBtn('gear', 'Settings', openSettings)),
    el('div', { class: 'lib-actions' },
      el('button', { class: 'btn primary big', html: icon('plus') + '<span>New note</span>', onclick: () => newNote(null) }),
      el('button', { class: 'btn big', html: icon('folder') + '<span>New folder</span>', onclick: () => newFolder(null) }),
      el('button', { class: 'btn big', html: icon('scan') + '<span>Import scans</span>', onclick: () => importScans(null) })),
    list,
    status);
  document.getElementById('app').append(root);
  L = { root, list, search, status, expanded, openNote, syncStatus, query: '' };
  search.addEventListener('input', () => { clearTimeout(L.searchT); L.searchT = setTimeout(() => { L.query = search.value.trim(); render(); }, 150); });
  store.bus.addEventListener('items-changed', onChanged);
  store.bus.addEventListener('page-saved', onChanged);
  await render();
  updateStatus();
}

function onChanged() {
  if (!L) return;
  clearTimeout(L.renderT);
  L.renderT = setTimeout(render, 80);
}

export function hideLibrary() {
  if (!L) return;
  store.bus.removeEventListener('items-changed', onChanged);
  store.bus.removeEventListener('page-saved', onChanged);
  L.root.remove();
  L = null;
}

export function updateStatus() {
  if (!L) return;
  const s = L.syncStatus();
  L.status.innerHTML = icon('cloud', 18) + `<span>${escapeHTML(s.text)}</span>`;
  L.status.classList.toggle('warn', !!s.warn);
}

function saveExpanded() { db.setMeta('expanded', [...L.expanded]); }

// ---------------------------------------------------------------- actions
function defaultTitle(bg) {
  const now = new Date();
  const day = store.niceDate(now);
  const id = bg.kind === 'template' ? bg.id : '';
  if (id === 'weekly') {
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    return `Week of ${store.niceDate(monday)}`;
  }
  if (id === 'lists4') return `Lists · ${day}`;
  if (id === 'tabbed') return `Notebook · ${day}`;
  return `${day}, ${now.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

async function newNote(parentId) {
  const bg = await pickTemplate({ title: 'New note — pick a page style' });
  if (!bg) return;
  const note = await store.createNote({ parentId, bg, title: defaultTitle(bg) });
  if (parentId) { L.expanded.add(parentId); saveExpanded(); }
  L.openNote(note.id);
}

async function newFolder(parentId) {
  const title = await promptBox(parentId ? 'New sub-folder' : 'New folder', '', { ok: 'Create', placeholder: 'e.g. Business ideas' });
  if (!title || !title.trim()) return;
  await store.createFolder({ parentId, title: title.trim() });
  if (parentId) { L.expanded.add(parentId); saveExpanded(); }
}

async function importScans(parentId) {
  const note = await importScansAsNote(parentId);
  if (note) L.openNote(note.id);
}

async function moveDialog(item) {
  const items = (await store.allItems()).filter((i) => !i.deletedAt);
  return new Promise((resolve) => {
    const list = el('div', { class: 'move-list' });
    const pick = async (pid) => {
      try { await store.moveItem(item.id, pid); if (pid) { L.expanded.add(pid); saveExpanded(); } toast('Moved'); }
      catch (e) { toast(e.message); }
      s.close();
    };
    list.append(el('button', { class: 'move-row', html: icon('notes') + '<span>Top level (not in a folder)</span>', onclick: () => pick(null) }));
    const walk = (pid, depth) => {
      const kids = items.filter((i) => (i.parentId || null) === pid).sort(sorter);
      for (const k of kids) {
        if (k.id === item.id || store.isWithin(items, k.id, item.id)) continue;
        list.append(el('button', { class: 'move-row', style: { paddingLeft: 14 + depth * 22 + 'px' },
          html: icon(k.type === 'folder' ? 'folder' : 'note') + `<span>${escapeHTML(k.title)}</span>`, onclick: () => pick(k.id) }));
        walk(k.id, depth + 1);
      }
    };
    walk(null, 0);
    const s = sheet({ title: `Move "${item.title}" to…`, content: list, onClose: () => resolve() });
  });
}

async function rowMenu(item) {
  const isFolder = item.type === 'folder';
  const choice = await actions(item.title, [
    !isFolder ? { label: 'Open', value: 'open', icon: 'note' } : null,
    { label: isFolder ? 'New note in this folder' : 'Add a sub-note', value: 'sub-note', icon: 'plus' },
    isFolder ? { label: 'New sub-folder', value: 'sub-folder', icon: 'folder' } : null,
    isFolder ? { label: 'Import scans into this folder', value: 'scan', icon: 'scan' } : null,
    { label: 'Rename', value: 'rename' },
    { label: 'Move to…', value: 'move' },
    { label: 'Delete', value: 'delete', icon: 'trash', danger: true },
  ]);
  if (choice === 'open') L.openNote(item.id);
  else if (choice === 'sub-note') newNote(item.id);
  else if (choice === 'sub-folder') newFolder(item.id);
  else if (choice === 'scan') importScans(item.id);
  else if (choice === 'rename') {
    const t = await promptBox('Rename', item.title);
    if (t && t.trim()) await store.renameItem(item.id, t);
  } else if (choice === 'move') moveDialog(item);
  else if (choice === 'delete') {
    if (await confirmBox(`Delete "${item.title}"${isFolder ? ' and everything in it' : ''}? You can restore it from "Recently deleted" for 30 days.`, { ok: 'Delete', danger: true })) {
      await store.deleteItem(item.id);
    }
  }
}

// ---------------------------------------------------------------- rendering
const sorter = (a, b) => {
  if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
  if (a.type === 'folder') return a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true });
  return (b.updatedAt || 0) - (a.updatedAt || 0);
};

async function render() {
  if (!L) return;
  const all = await store.allItems();
  const live = all.filter((i) => !i.deletedAt);
  if (L.query) return renderSearch(live);
  const frag = document.createDocumentFragment();
  const kidsOf = (pid) => live.filter((i) => (i.parentId || null) === pid).sort(sorter);
  const countDeep = (id) => kidsOf(id).length;
  const walk = (pid, depth) => {
    for (const item of kidsOf(pid)) {
      const kids = kidsOf(item.id);
      const open = L.expanded.has(item.id);
      frag.append(row(item, depth, kids.length, open, countDeep(item.id)));
      if (open && kids.length) walk(item.id, depth + 1);
    }
  };
  walk(null, 0);
  if (!live.length) {
    frag.append(el('div', { class: 'empty' },
      el('p', {}, 'Nothing here yet.'),
      el('p', { class: 'muted' }, 'Tap "New note" to start writing, or "Import scans" to bring in photos or PDFs of your paper notes.')));
  }
  // recently deleted (30 days)
  const cutoff = Date.now() - 30 * 864e5;
  const deleted = all.filter((i) => i.deletedAt && i.deletedAt > cutoff && !(i.parentId && all.find((p) => p.id === i.parentId && p.deletedAt === i.deletedAt)));
  if (deleted.length) {
    const open = L.expanded.has('__trash');
    frag.append(el('button', { class: 'trash-head', onclick: () => { open ? L.expanded.delete('__trash') : L.expanded.add('__trash'); saveExpanded(); render(); },
      html: `<span class="chev ${open ? 'open' : ''}">${icon('chevron', 16)}</span>${icon('trash', 18)}<span>Recently deleted (${deleted.length})</span>` }));
    if (open) {
      for (const d of deleted.sort((a, b) => b.deletedAt - a.deletedAt)) {
        frag.append(el('div', { class: 'row deleted' },
          el('span', { class: 'row-icon', html: icon(d.type === 'folder' ? 'folder' : 'note', 20) }),
          el('span', { class: 'row-title' }, d.title),
          el('span', { class: 'row-meta' }, `deleted ${ago(d.deletedAt)}`),
          el('button', { class: 'btn small', html: icon('restore', 16) + '<span>Restore</span>', onclick: () => store.restoreItem(d.id) })));
      }
    }
  }
  L.list.replaceChildren(frag);
}

function row(item, depth, kidCount, open, count) {
  const isFolder = item.type === 'folder';
  const chev = el('button', {
    class: `chev ${open ? 'open' : ''} ${kidCount ? '' : 'none'}`, 'aria-label': open ? 'Collapse' : 'Expand', html: icon('chevron', 16),
    onclick: (e) => { e.stopPropagation(); toggle(item.id); },
  });
  const main = el('button', {
    class: 'row-main',
    onclick: () => (isFolder ? toggle(item.id) : L.openNote(item.id)),
  },
  el('span', { class: `row-icon ${isFolder ? 'folder' : ''}`, html: icon(isFolder ? 'folder' : 'note', 20) }),
  el('span', { class: 'row-title' }, item.title),
  el('span', { class: 'row-meta' }, isFolder ? (count ? `${count}` : '') : ago(item.updatedAt)));
  return el('div', { class: 'row', role: 'treeitem', style: { paddingLeft: 6 + depth * 26 + 'px' } },
    chev, main,
    iconBtn('more', `Options for ${item.title}`, () => rowMenu(item), { class: 'icon-btn row-more' }));
}

function toggle(id) {
  if (L.expanded.has(id)) L.expanded.delete(id); else L.expanded.add(id);
  saveExpanded();
  render();
}

function pathOf(item, byId) {
  const parts = [];
  let cur = item.parentId && byId.get(item.parentId);
  let guard = 0;
  while (cur && guard++ < 50) { parts.unshift(cur.title); cur = cur.parentId && byId.get(cur.parentId); }
  return parts.join(' › ');
}

function snippet(text, words) {
  const lower = text.toLowerCase();
  let at = -1;
  for (const w of words) { at = lower.indexOf(w); if (at >= 0) break; }
  if (at < 0) return '';
  const start = Math.max(0, at - 40);
  let s = escapeHTML(text.slice(start, at + 80).replace(/\s+/g, ' '));
  for (const w of words) s = s.replace(new RegExp(`(${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig'), '<mark>$1</mark>');
  return (start > 0 ? '…' : '') + s + '…';
}

async function renderSearch(live) {
  const words = L.query.toLowerCase().split(/\s+/).filter(Boolean);
  const byId = new Map(live.map((i) => [i.id, i]));
  const pages = await db.getAll('pages');
  const textByNote = new Map();
  for (const p of pages) {
    if (p.deletedAt || !p.ocrText) continue;
    if (!textByNote.has(p.noteId)) textByNote.set(p.noteId, []);
    textByNote.get(p.noteId).push(p);
  }
  const results = [];
  for (const item of live) {
    const title = item.title.toLowerCase();
    const notePages = (textByNote.get(item.id) || []).filter((p) => (item.pageIds || []).includes(p.id));
    const hay = title + ' ' + notePages.map((p) => p.ocrText.toLowerCase()).join(' ');
    if (!words.every((w) => hay.includes(w))) continue;
    const hitPage = notePages.find((p) => words.some((w) => p.ocrText.toLowerCase().includes(w)));
    const score = words.filter((w) => title.includes(w)).length * 10 + (item.updatedAt || 0) / 1e13;
    results.push({ item, hitPage, score });
  }
  results.sort((a, b) => b.score - a.score);
  const frag = document.createDocumentFragment();
  if (!results.length) frag.append(el('div', { class: 'empty' }, el('p', {}, `Nothing found for "${L.query}".`),
    el('p', { class: 'muted small' }, 'Handwriting becomes searchable a minute or so after you write it, once handwriting search is on (Settings).')));
  for (const { item, hitPage } of results.slice(0, 100)) {
    const isFolder = item.type === 'folder';
    const path = pathOf(item, byId);
    frag.append(el('button', {
      class: 'result',
      onclick: () => (isFolder ? (L.search.value = '', L.query = '', expandTo(item, byId)) : L.openNote(item.id, hitPage && hitPage.id)),
    },
    el('span', { class: 'row-icon', html: icon(isFolder ? 'folder' : 'note', 20) }),
    el('span', { class: 'result-text' },
      el('span', { class: 'row-title' }, item.title),
      path ? el('span', { class: 'row-meta' }, path) : null,
      hitPage ? el('span', { class: 'snippet', html: snippet(hitPage.ocrText, words) }) : null)));
  }
  L.list.replaceChildren(frag);
}

function expandTo(item, byId) {
  let cur = item;
  while (cur) { L.expanded.add(cur.id); cur = cur.parentId && byId.get(cur.parentId); }
  saveExpanded();
  render();
}
