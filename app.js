// app.js — Catchall: one place for every note, list and scribble.
import { db } from './db.js';
import * as Ink from './ink.js';

const APP_VERSION = '1.0.0';
const INBOX = 'inbox';
const TRASH_DAYS = 30;
const BACKUP_NAG_DAYS = 7;
const DAY = 86400000;

// ---------------------------------------------------------------- helpers
const $ = (sel, root = document) => root.querySelector(sel);
const uid = () =>
  (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'value' || k === 'checked' || k === 'disabled') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : String(kid));
  }
  return el;
}

const ICONS = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  back: '<path d="M15 18l-6-6 6-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/>',
  pin: '<path d="M12 17v5"/><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z"/>',
  layers: '<path d="M12 2l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  trash: '<path d="M3 6h18"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
  backup: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
  share: '<path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><path d="M16 6l-4-4-4 4"/><path d="M12 2v13"/>',
  more: '<circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/>',
  pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
  highlighter: '<path d="M9 11l-6 6v3h9l3-3"/><path d="M22 12l-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
  eraser: '<path d="M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21"/><path d="M22 21H7"/><path d="M5 11l9 9"/>',
  undo: '<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/>',
  redo: '<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/>',
  check: '<path d="M20 6L9 17l-5-5"/>',
  x: '<path d="M18 6L6 18M6 6l12 12"/>',
  type: '<path d="M4 7V4h16v3"/><path d="M9 20h6"/><path d="M12 4v16"/>',
  list: '<path d="M3 6l1.5 1.5L7 5"/><path d="M3 12l1.5 1.5L7 11"/><path d="M3 18l1.5 1.5L7 17"/><path d="M11 6h10M11 12h10M11 18h10"/>',
  finger: '<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/>',
  down: '<path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>',
};
function icon(name) {
  const s = document.createElement('span');
  s.className = 'ic';
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ''}</svg>`;
  return s;
}

const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode etc. */ } };

function firstGrapheme(str) {
  try {
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      const first = new Intl.Segmenter().segment(str)[Symbol.iterator]().next();
      return first.done ? '' : first.value.segment;
    }
  } catch { /* fall through */ }
  return [...str].slice(0, 2).join('');
}

const pad2 = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayStr = () => dateStr(new Date());
const parseDay = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

function ago(ts) {
  const d = Date.now() - ts;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return `${Math.floor(d / 60e3)} min ago`;
  if (d < DAY) return `${Math.floor(d / 3600e3)} hr ago`;
  if (d < 2 * DAY) return 'yesterday';
  const dt = new Date(ts);
  const opts = { month: 'short', day: 'numeric' };
  if (dt.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
  return dt.toLocaleDateString(undefined, opts);
}

function dueLabel(due) {
  const t = todayStr();
  const tomorrow = dateStr(new Date(Date.now() + DAY));
  if (due === t) return 'Today';
  if (due === tomorrow) return 'Tomorrow';
  return parseDay(due).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function autoGrow(ta) {
  const sc = $('#editor-scroll');
  const top = sc ? sc.scrollTop : 0;
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
  if (sc) sc.scrollTop = top;
}

// ---------------------------------------------------------------- state
const state = { notes: [], notebooks: [], view: { kind: 'inbox' }, openId: null, prevView: null };
let settings = {
  fingerDraws: true,     // until a Pencil shows up
  fingerAuto: true,      // switch to "Pencil writes, finger scrolls" automatically
  manualScroll: false,   // fallback finger-scroll mode
  inboxStarter: 'ink',
  lastBackup: 0,
  seeded: false,
};
let inkTool = { tool: 'pen', penColor: 'ink', hlColor: 'yellow', size: 'm', ...lsGet('catchall:ink', {}) };
let surfaces = [];

const SYSTEM_VIEWS = [
  { kind: 'inbox', name: 'Inbox', icon: 'inbox', hint: 'Quick notes land here. Jot now, sort later — or never. Search finds it either way.' },
  { kind: 'pinned', name: 'Pinned', icon: 'pin', hint: 'Notes you pinned. Pin from the 📌 button inside a note.' },
  { kind: 'upcoming', name: 'Coming up', icon: 'calendar', hint: 'Notes with a date on them, soonest first. Add one with the 📅 button inside a note.' },
  { kind: 'all', name: 'All notes', icon: 'layers' },
];

const EMOJI_PICKS = ['📒', '🐶', '🐾', '💼', '🛍️', '🏡', '🌺', '🌴', '💰', '🧾', '🎨', '📦', '🩺', '💊', '🎄', '🎉', '🚗', '🌱', '🐔', '🔧', '📚', '✨', '❤️', '🗂️'];

// ---------------------------------------------------------------- blocks + starters
const newText = (text = '', label) => ({ id: uid(), type: 'text', text, ...(label != null ? { label } : {}) });
const newItem = (text = '') => ({ id: uid(), text, done: false });
const newList = (label) => ({ id: uid(), type: 'checklist', items: [newItem()], ...(label != null ? { label } : {}) });
const newInk = () => ({ id: uid(), type: 'ink', h: Ink.INK_DEFAULT_H, paper: 'lined', strokes: [] });

const STARTERS = {
  ink: { label: 'Handwriting page', make: () => [newInk()] },
  text: { label: 'Typing', make: () => [newText()] },
  checklist: { label: 'Checklist', make: () => [newList()] },
  recipe: { label: 'Recipe (ingredients + steps)', make: () => [newList('Ingredients'), newText('', 'Steps')] },
  mealplan: {
    label: 'Meal plan (week + grocery list)',
    make: () => [newText('Mon: \nTue: \nWed: \nThu: \nFri: \nSat: \nSun: ', 'This week'), newList('Need to buy')],
  },
  trip: { label: 'Trip (plans + packing list)', make: () => [newText('', 'Plans'), newList('Packing list')] },
};

const DEFAULT_NOTEBOOKS = [
  { name: 'To-Do', emoji: '✅', starter: 'checklist' },
  { name: 'To-Buy', emoji: '🛒', starter: 'checklist' },
  { name: 'Meal Planning', emoji: '🍽️', starter: 'mealplan' },
  { name: 'Recipes', emoji: '📖', starter: 'recipe' },
  { name: 'Business Ideas', emoji: '💡', starter: 'ink' },
  { name: 'Travel Plans', emoji: '✈️', starter: 'trip' },
  { name: 'Gift Ideas', emoji: '🎁', starter: 'checklist' },
  { name: 'Reminders', emoji: '⏰', starter: 'checklist' },
  { name: 'Remember This', emoji: '🧠', starter: 'text' },
];

function blockEmpty(b) {
  if (b.type === 'text') return !(b.text || '').trim() || /^((Mon|Tue|Wed|Thu|Fri|Sat|Sun): ?\n?)+$/.test(b.text.trim() + '\n');
  if (b.type === 'checklist') return b.items.every((i) => !i.text.trim());
  if (b.type === 'ink') return !b.strokes.length;
  return true;
}
const noteEmpty = (n) => !n.title.trim() && n.blocks.every(blockEmpty);

// ---------------------------------------------------------------- notebooks
const nbById = (id) => state.notebooks.find((n) => n.id === id);
const nbInfo = (id) => (id === INBOX || !nbById(id) ? { id: INBOX, emoji: '📥', name: 'Inbox' } : nbById(id));
const sortedNotebooks = () => state.notebooks.slice().sort((a, b) => a.order - b.order);

// ---------------------------------------------------------------- persistence
const pending = new Map();
let saveTimer = 0;
function scheduleSave(note) {
  pending.set(note.id, note);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSaves, 350);
}
async function flushSaves() {
  clearTimeout(saveTimer);
  const list = [...pending.values()];
  pending.clear();
  if (!list.length) return;
  try {
    await db.putMany('notes', list);
  } catch (err) {
    list.forEach((n) => pending.set(n.id, n));
    toast(`Couldn't save just now (${err?.message || err}). Will retry.`);
    saveTimer = setTimeout(flushSaves, 3000);
  }
}
function touch(note) {
  note.updatedAt = Date.now();
  scheduleSave(note);
}
const saveSettings = () => db.put('meta', { key: 'settings', ...settings }).catch(() => {});
const saveNotebook = (nb) => db.put('notebooks', nb).catch((e) => toast(`Couldn't save notebook: ${e.message}`));
function saveUi() {
  lsSet('catchall:ui', { view: state.view.kind === 'search' ? state.prevView : state.view, openId: state.openId });
}

document.addEventListener('visibilitychange', () => { if (document.hidden) flushSaves(); });
window.addEventListener('pagehide', flushSaves);

// ---------------------------------------------------------------- search + summaries
function noteSearchText(n) {
  const parts = [n.title, nbInfo(n.notebookId).name];
  for (const b of n.blocks) {
    if (b.label) parts.push(b.label);
    if (b.type === 'text') parts.push(b.text);
    if (b.type === 'checklist') for (const i of b.items) parts.push(i.text);
  }
  return parts.join('\n').toLowerCase();
}

function summarize(n) {
  const lines = [];
  for (const b of n.blocks) {
    if (b.type === 'text') for (const l of (b.text || '').split('\n')) { if (l.trim()) lines.push(l.trim()); }
    if (b.type === 'checklist') for (const i of b.items) { if (i.text.trim()) lines.push(`${i.done ? '✓ ' : ''}${i.text.trim()}`); }
  }
  let title = n.title.trim();
  if (!title) {
    const first = n.blocks.find((b) => !blockEmpty(b));
    if (first && first.type !== 'ink' && lines.length) title = lines.shift().replace(/^✓ /, '');
    else if (n.blocks.some((b) => b.type === 'ink' && b.strokes.length)) title = 'Handwritten note';
    else title = 'Untitled';
  }
  let snippet = lines.slice(0, 5).join('  ·  ');
  if (snippet.length > 160) snippet = snippet.slice(0, 157) + '…';
  return { title, snippet };
}

function checklistStats(n) {
  let done = 0, total = 0;
  for (const b of n.blocks) if (b.type === 'checklist') for (const i of b.items) if (i.text.trim()) { total++; if (i.done) done++; }
  return total ? { done, total } : null;
}

const thumbCache = new Map();
function thumbFor(n) {
  const block = n.blocks.find((b) => b.type === 'ink' && b.strokes.length);
  if (!block) return null;
  const dark = Ink.isDark();
  const c = thumbCache.get(n.id);
  if (c && c.u === n.updatedAt && c.dark === dark) return c.url;
  const canvas = Ink.renderThumb(block, 150, 110, dark);
  if (!canvas) return null;
  const url = canvas.toDataURL('image/png');
  thumbCache.set(n.id, { u: n.updatedAt, dark, url });
  return url;
}

const sortNotes = (arr) => arr.sort((a, b) => (b.pinned - a.pinned) || (b.updatedAt - a.updatedAt));

function notesFor(view) {
  const live = state.notes.filter((n) => !n.deletedAt);
  switch (view.kind) {
    case 'inbox': return sortNotes(live.filter((n) => n.notebookId === INBOX || !nbById(n.notebookId)));
    case 'pinned': return sortNotes(live.filter((n) => n.pinned));
    case 'all': return sortNotes(live);
    case 'upcoming': return live.filter((n) => n.due).sort((a, b) => a.due.localeCompare(b.due) || b.updatedAt - a.updatedAt);
    case 'notebook': return sortNotes(live.filter((n) => n.notebookId === view.id));
    case 'trash': return state.notes.filter((n) => n.deletedAt).sort((a, b) => b.deletedAt - a.deletedAt);
    case 'search': {
      const words = view.q.toLowerCase().split(/\s+/).filter(Boolean);
      return sortNotes(live.filter((n) => { const t = noteSearchText(n); return words.every((w) => t.includes(w)); }));
    }
    default: return [];
  }
}

// ---------------------------------------------------------------- navigation
function setView(v) {
  if (v.kind !== 'search') {
    state.prevView = null;
    const s = $('#search');
    if (s.value) s.value = '';
  }
  state.view = v;
  saveUi();
  document.body.classList.remove('nav-open');
  renderSidebar();
  renderMain();
  $('#main').scrollTop = 0;
}

function viewTitle(v) {
  if (v.kind === 'notebook') { const nb = nbById(v.id); return nb ? `${nb.emoji} ${nb.name}` : 'Notebook'; }
  if (v.kind === 'trash') return 'Trash';
  if (v.kind === 'settings') return 'Backup & settings';
  if (v.kind === 'search') return `Search: “${v.q}”`;
  return SYSTEM_VIEWS.find((s) => s.kind === v.kind)?.name || 'Notes';
}

function navItem({ label, emoji, iconName, count, active, onClick }) {
  return h('button', { class: 'nav-item' + (active ? ' active' : ''), onclick: onClick },
    iconName ? icon(iconName) : h('span', { class: 'nav-emoji' }, emoji),
    h('span', { class: 'nav-label' }, label),
    count ? h('span', { class: 'nav-count' }, count) : null);
}

function renderSidebar() {
  const v = state.view;
  const live = state.notes.filter((n) => !n.deletedAt);
  const counts = {
    inbox: live.filter((n) => n.notebookId === INBOX || !nbById(n.notebookId)).length,
    pinned: live.filter((n) => n.pinned).length,
    upcoming: live.filter((n) => n.due && n.due <= dateStr(new Date(Date.now() + 7 * DAY))).length,
    all: live.length,
  };
  const sys = $('#nav-system');
  sys.replaceChildren(...SYSTEM_VIEWS.map((s) => navItem({
    label: s.name, iconName: s.icon, count: counts[s.kind], active: v.kind === s.kind, onClick: () => setView({ kind: s.kind }),
  })));
  const books = $('#nav-notebooks');
  books.replaceChildren(...sortedNotebooks().map((nb) => navItem({
    label: nb.name, emoji: nb.emoji, count: live.filter((n) => n.notebookId === nb.id).length,
    active: v.kind === 'notebook' && v.id === nb.id, onClick: () => setView({ kind: 'notebook', id: nb.id }),
  })));
  const trashCount = state.notes.filter((n) => n.deletedAt).length;
  $('#nav-bottom').replaceChildren(
    navItem({ label: 'Trash', iconName: 'trash', count: trashCount, active: v.kind === 'trash', onClick: () => setView({ kind: 'trash' }) }),
    navItem({ label: 'Backup & settings', iconName: 'backup', active: v.kind === 'settings', onClick: () => setView({ kind: 'settings' }) }),
  );
}

// ---------------------------------------------------------------- main list
function renderMain() {
  const v = state.view;
  $('#view-title').textContent = viewTitle(v);
  const actions = $('#view-actions');
  actions.replaceChildren();
  if (v.kind === 'notebook') {
    actions.append(h('button', { class: 'icon-btn', 'aria-label': 'Notebook options', onclick: (e) => notebookMenu(e.currentTarget, nbById(v.id)) }, icon('more')));
  }
  if (v.kind === 'trash' && state.notes.some((n) => n.deletedAt)) {
    actions.append(h('button', { class: 'btn danger-text', onclick: emptyTrash }, 'Empty trash'));
  }
  $('#fab').hidden = v.kind === 'settings' || v.kind === 'trash';

  const body = $('#main-body');
  body.replaceChildren();
  renderBanner(body);

  if (v.kind === 'settings') { renderSettings(body); return; }

  const sys = SYSTEM_VIEWS.find((s) => s.kind === v.kind);
  if (sys?.hint) body.append(h('p', { class: 'view-hint' }, sys.hint));
  if (v.kind === 'trash') body.append(h('p', { class: 'view-hint' }, `Deleted notes wait here for ${TRASH_DAYS} days, then disappear for good. Tap one to restore it.`));

  const notes = notesFor(v);
  if (!notes.length) { body.append(emptyState(v)); return; }

  if (v.kind === 'upcoming') {
    const t = todayStr(), week = dateStr(new Date(Date.now() + 7 * DAY));
    const groups = [
      ['Overdue', notes.filter((n) => n.due < t)],
      ['Today', notes.filter((n) => n.due === t)],
      ['Next 7 days', notes.filter((n) => n.due > t && n.due <= week)],
      ['Later', notes.filter((n) => n.due > week)],
    ];
    for (const [label, list] of groups) {
      if (!list.length) continue;
      body.append(h('h2', { class: 'group-label' + (label === 'Overdue' ? ' overdue' : '') }, label), cardGrid(list));
    }
    return;
  }
  body.append(cardGrid(notes, { trash: v.kind === 'trash', showNb: v.kind !== 'notebook' }));
}

function emptyState(v) {
  const msg = {
    inbox: ['Inbox zero. Suspicious, but congrats.', 'Tap + to jot something down.'],
    pinned: ['Nothing pinned yet.', 'Open a note and tap the pin to keep it up top.'],
    upcoming: ['Nothing with a date yet.', 'Open a note and tap the calendar to give it one.'],
    all: ['No notes yet.', 'Tap + to start.'],
    notebook: ['This notebook is empty.', 'Tap + to add the first note.'],
    trash: ['Trash is empty.', ''],
    search: ['Nothing matches that.', 'Search looks at titles, typed text and list items. Handwriting is searchable by its title.'],
  }[v.kind] || ['Nothing here.', ''];
  return h('div', { class: 'empty' }, h('p', { class: 'empty-title' }, msg[0]), msg[1] ? h('p', {}, msg[1]) : null);
}

function cardGrid(notes, opts = {}) {
  return h('div', { class: 'grid' }, notes.map((n) => noteCard(n, opts)));
}

function noteCard(n, { trash = false, showNb = true } = {}) {
  const { title, snippet } = summarize(n);
  const nb = nbInfo(n.notebookId);
  const stats = checklistStats(n);
  const thumb = thumbFor(n);
  const meta = [];
  if (stats) meta.push(h('span', { class: 'chip' + (stats.done === stats.total ? ' all-done' : '') }, `${stats.done}/${stats.total} done`));
  if (n.due && !trash) meta.push(h('span', { class: 'chip' + (n.due < todayStr() ? ' overdue' : '') }, '📅 ' + dueLabel(n.due)));
  meta.push(h('span', { class: 'card-time' }, trash ? `deleted ${ago(n.deletedAt)}` : ago(n.updatedAt)));
  const card = h('button', {
    class: 'card' + (n.pinned && !trash ? ' pinned' : ''),
    onclick: () => (trash ? trashMenu(card, n) : openEditor(n)),
  },
  h('div', { class: 'card-main' },
    showNb || (n.pinned && !trash) ? h('div', { class: 'card-top' },
      h('span', { class: 'card-nb' }, showNb ? `${nb.emoji} ${nb.name}` : ''),
      n.pinned && !trash ? h('span', { class: 'card-pin' }, icon('pin')) : null) : null,
    h('div', { class: 'card-title' }, title),
    snippet ? h('div', { class: 'card-snippet' }, snippet) : null,
    h('div', { class: 'card-meta' }, meta)),
  thumb ? h('img', { class: 'card-thumb', src: thumb, alt: '' }) : null);
  return card;
}

const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

function renderBanner(body) {
  const dismissed = lsGet('catchall:dismiss', {});
  const today = todayStr();
  const live = state.notes.filter((n) => !n.deletedAt && !noteEmpty(n));
  if (!isStandalone() && dismissed.install !== today && state.view.kind !== 'settings') {
    body.append(banner('📲', 'Put this on your Home Screen so it opens like a real app (and keeps your notes safer): in Safari, tap Share, then “Add to Home Screen”.', null, 'install'));
    return;
  }
  const since = settings.lastBackup ? Math.floor((Date.now() - settings.lastBackup) / DAY) : Infinity;
  if (live.length >= 3 && since >= BACKUP_NAG_DAYS && dismissed.backup !== today && state.view.kind !== 'settings') {
    const when = settings.lastBackup ? `Last backup was ${since} days ago.` : 'You haven’t backed up yet.';
    body.append(banner('📦', `${when} Your notes only live on this iPad — a backup takes 10 seconds.`, { label: 'Back up now', onClick: backupNow }, 'backup'));
  }
}

function banner(emoji, text, action, key) {
  const el = h('div', { class: 'banner' },
    h('span', { class: 'banner-emoji' }, emoji),
    h('span', { class: 'banner-text' }, text),
    action ? h('button', { class: 'btn primary', onclick: action.onClick }, action.label) : null,
    h('button', { class: 'icon-btn small', 'aria-label': 'Hide for today', onclick: () => {
      const d = lsGet('catchall:dismiss', {}); d[key] = todayStr(); lsSet('catchall:dismiss', d); el.remove();
    } }, icon('x')));
  return el;
}

// ---------------------------------------------------------------- creating notes
function createNote() {
  const v = state.view;
  const notebookId = v.kind === 'notebook' ? v.id : INBOX;
  const starter = notebookId === INBOX ? settings.inboxStarter : nbById(notebookId)?.starter || 'text';
  const now = Date.now();
  const note = {
    id: uid(), title: '', notebookId, blocks: (STARTERS[starter] || STARTERS.text).make(),
    pinned: v.kind === 'pinned', due: null, createdAt: now, updatedAt: now, deletedAt: null,
  };
  state.notes.push(note);
  openEditor(note, { focus: true });
}

// ---------------------------------------------------------------- editor
const currentNote = () => state.notes.find((n) => n.id === state.openId);

function openEditor(note, { focus = false } = {}) {
  state.openId = note.id;
  saveUi();
  $('#editor').hidden = false;
  document.body.classList.add('editing');
  renderEditorBar(note);
  renderEditorPage(note);
  $('#editor-scroll').scrollTop = 0;
  if (focus) {
    const first = note.blocks[0];
    if (first && first.type !== 'ink') $(`[data-block="${first.id}"] .text-input, [data-block="${first.id}"] .check-text`)?.focus({ preventScroll: true });
  }
}

function destroySurfaces() {
  surfaces.forEach((s) => s.destroy());
  surfaces = [];
}

function closeEditor() {
  const note = currentNote();
  destroySurfaces();
  $('#editor').hidden = true;
  document.body.classList.remove('editing');
  state.openId = null;
  saveUi();
  if (note) {
    if (noteEmpty(note)) {
      state.notes = state.notes.filter((n) => n !== note);
      pending.delete(note.id);
      db.delete('notes', note.id).catch(() => {});
    } else {
      // Tidy up untouched, unlabeled sections (e.g. a blank starter page you replaced).
      const keep = note.blocks.filter((b) => !blockEmpty(b) || b.label != null);
      if (keep.length && keep.length !== note.blocks.length) note.blocks = keep;
      scheduleSave(note);
      flushSaves();
    }
  }
  renderSidebar();
  renderMain();
}

function renderEditorBar(note) {
  const sel = h('select', { class: 'nb-select', 'aria-label': 'Notebook', onchange: () => { note.notebookId = sel.value; touch(note); } },
    h('option', { value: INBOX }, '📥 Inbox'),
    sortedNotebooks().map((nb) => h('option', { value: nb.id }, `${nb.emoji} ${nb.name}`)));
  sel.value = nbById(note.notebookId) ? note.notebookId : INBOX;

  const dateInput = h('input', {
    type: 'date', class: 'date-overlay', 'aria-label': 'Set a date', value: note.due || '',
    onchange: () => { note.due = dateInput.value || null; touch(note); renderEditorBar(note); renderDueRow(note); },
  });

  $('#editor-bar').replaceChildren(
    h('button', { class: 'btn-back', onclick: closeEditor }, icon('back'), h('span', {}, 'Notes')),
    sel,
    h('div', { class: 'spacer' }),
    h('label', { class: 'icon-btn date-btn' + (note.due ? ' on' : ''), title: 'Date' }, icon('calendar'), dateInput),
    h('button', { class: 'icon-btn' + (note.pinned ? ' on' : ''), 'aria-label': note.pinned ? 'Unpin' : 'Pin', title: 'Pin', onclick: () => { note.pinned = !note.pinned; touch(note); renderEditorBar(note); } }, icon('pin')),
    h('button', { class: 'icon-btn', 'aria-label': 'Share', title: 'Share', onclick: () => shareNote(note) }, icon('share')),
    h('button', { class: 'icon-btn', 'aria-label': 'More', title: 'More', onclick: (e) => noteMenu(e.currentTarget, note) }, icon('more')),
  );
}

function renderDueRow(note) {
  const row = $('#due-row');
  if (!row) return;
  row.replaceChildren();
  if (note.due) {
    row.append(h('span', { class: 'chip big' + (note.due < todayStr() ? ' overdue' : '') }, '📅 ', dueLabel(note.due),
      h('button', { class: 'chip-x', 'aria-label': 'Remove date', onclick: () => { note.due = null; touch(note); renderEditorBar(note); renderDueRow(note); } }, icon('x'))));
  }
  row.append(h('span', { class: 'meta-time' }, `Edited ${ago(note.updatedAt)}`));
}

function renderEditorPage(note, focusSelector) {
  destroySurfaces();
  const title = h('textarea', { class: 'title-input', rows: 1, placeholder: 'Title (helps you find it later)', value: note.title, enterkeyhint: 'next' });
  title.addEventListener('input', () => { note.title = title.value.replace(/\n/g, ' '); autoGrow(title); touch(note); });
  title.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      $('#blocks textarea, #blocks input.check-text')?.focus();
    }
  });

  const blocks = h('div', { id: 'blocks' }, note.blocks.map((b) => renderBlock(note, b)));
  const addBar = h('div', { class: 'add-bar' },
    h('span', { class: 'add-label' }, 'Add:'),
    h('button', { class: 'btn add-btn', onclick: () => addBlock(note, 'ink') }, icon('pen'), 'Handwriting'),
    h('button', { class: 'btn add-btn', onclick: () => addBlock(note, 'text') }, icon('type'), 'Typing'),
    h('button', { class: 'btn add-btn', onclick: () => addBlock(note, 'checklist') }, icon('list'), 'Checklist'));

  $('#editor-page').replaceChildren(title, h('div', { id: 'due-row', class: 'due-row' }), blocks, addBar);
  renderDueRow(note);
  autoGrow(title);
  document.querySelectorAll('#editor-page textarea').forEach(autoGrow);
  surfaces.forEach((s) => s.layout(true));
  if (focusSelector) {
    const el = $(focusSelector);
    if (el) { el.focus({ preventScroll: true }); }
  }
}

function addBlock(note, type) {
  const b = type === 'ink' ? newInk() : type === 'checklist' ? newList() : newText();
  // Swap out an untouched starter section instead of leaving it empty above.
  if (note.blocks.length === 1 && blockEmpty(note.blocks[0]) && note.blocks[0].label == null && note.blocks[0].type !== type) {
    note.blocks = [];
  }
  note.blocks.push(b);
  touch(note);
  const sel = type === 'ink' ? null : `[data-block="${b.id}"] ${type === 'text' ? 'textarea' : 'input.check-text'}`;
  renderEditorPage(note, sel);
  $(`[data-block="${b.id}"]`)?.scrollIntoView({ block: type === 'ink' ? 'start' : 'center', behavior: 'smooth' });
}

function moveBlock(note, b, dir) {
  const i = note.blocks.indexOf(b), j = i + dir;
  if (j < 0 || j >= note.blocks.length) return;
  [note.blocks[i], note.blocks[j]] = [note.blocks[j], note.blocks[i]];
  touch(note);
  renderEditorPage(note);
  $(`[data-block="${b.id}"]`)?.scrollIntoView({ block: 'center' });
}

function renderBlock(note, b) {
  const wrap = h('section', { class: `block block-${b.type}`, 'data-block': b.id });
  const moreBtn = () => h('button', { class: 'icon-btn small block-more', 'aria-label': 'Section options', onclick: (e) => blockMenu(e.currentTarget, note, b) }, icon('more'));

  if (b.label != null) {
    const label = h('input', { class: 'block-label', value: b.label, placeholder: 'Heading', 'aria-label': 'Section heading' });
    label.addEventListener('input', () => { b.label = label.value; touch(note); });
    wrap.append(label);
  }

  if (b.type === 'text') {
    const ta = h('textarea', { class: 'text-input', rows: 2, value: b.text || '', placeholder: 'Type here… or write with Apple Pencil and iPad turns it into text.' });
    ta.addEventListener('input', () => { b.text = ta.value; autoGrow(ta); touch(note); });
    wrap.append(moreBtn(), ta);
  } else if (b.type === 'checklist') {
    wrap.append(renderChecklist(note, b, moreBtn()));
  } else if (b.type === 'ink') {
    const surface = new Ink.InkSurface(b, {
      tool: () => inkTool,
      settings,
      onChange: () => { touch(note); toolbar._sync(); },
      onPenSeen,
      onStrokeCut,
      scroller: () => $('#editor-scroll'),
    });
    surfaces.push(surface);
    const toolbar = inkToolbar(note, b, surface);
    const room = h('button', { class: 'btn ghost more-room', onclick: () => {
      if (!surface.grow()) toast('This page is full — tap “Handwriting” below to add another one.');
      room.disabled = b.h >= Ink.INK_MAX_H;
    } }, icon('down'), 'More room');
    room.disabled = b.h >= Ink.INK_MAX_H;
    wrap.append(toolbar, surface.el, room);
  }
  return wrap;
}

function renderChecklist(note, b, moreButton) {
  const list = h('div', { class: 'check-list' });
  const footer = h('div', { class: 'check-footer' });
  const updateFooter = () => {
    const filled = b.items.filter((i) => i.text.trim());
    const done = filled.filter((i) => i.done).length;
    footer.replaceChildren(
      h('button', { class: 'btn ghost', onclick: () => {
        const it = newItem(); b.items.push(it); const r = row(it); list.append(r); r.querySelector('input').focus(); touch(note); updateFooter();
      } }, icon('plus'), 'Add item'),
      h('span', { class: 'check-progress' }, filled.length ? `${done} of ${filled.length} done` : ''),
      moreButton);
  };

  const row = (item) => {
    const r = h('div', { class: 'check-row' + (item.done ? ' done' : ''), 'data-item': item.id });
    const box = h('button', { class: 'check-box', role: 'checkbox', 'aria-checked': String(!!item.done), 'aria-label': 'Done' }, icon('check'));
    box.addEventListener('click', () => {
      item.done = !item.done;
      r.classList.toggle('done', item.done);
      box.setAttribute('aria-checked', String(item.done));
      touch(note); updateFooter();
    });
    const input = h('input', { class: 'check-text', type: 'text', value: item.text, placeholder: 'List item', enterkeyhint: 'next', autocapitalize: 'sentences' });
    input.addEventListener('input', () => { item.text = input.value; touch(note); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        const idx = b.items.indexOf(item);
        const it = newItem();
        b.items.splice(idx + 1, 0, it);
        const nr = row(it);
        r.after(nr);
        nr.querySelector('input').focus();
        touch(note); updateFooter();
      } else if (e.key === 'Backspace' && input.value === '' && b.items.length > 1) {
        e.preventDefault();
        removeItem(item, r, true);
      }
    });
    // Paste a multi-line list → one item per line.
    input.addEventListener('paste', (e) => {
      const text = e.clipboardData?.getData('text/plain');
      if (!text || !/\r?\n/.test(text.trim())) return;
      e.preventDefault();
      const lines = text.split(/\r?\n/).map((s) => s.replace(/^\s*(?:[-*•·○◦☐☑✓✔]|\[[ xX]?\]|\d+[.)])\s*/, '').trim()).filter(Boolean);
      if (!lines.length) return;
      item.text = (input.value + lines.shift()).trim();
      input.value = item.text;
      let after = r, idx = b.items.indexOf(item);
      for (const l of lines) {
        const it = newItem(l);
        b.items.splice(++idx, 0, it);
        const nr = row(it);
        after.after(nr);
        after = nr;
      }
      touch(note); updateFooter();
    });
    const del = h('button', { class: 'icon-btn small check-del', 'aria-label': 'Remove item', onclick: () => removeItem(item, r, false) }, icon('x'));
    r.append(box, input, del);
    return r;
  };

  const removeItem = (item, r, focusPrev) => {
    const idx = b.items.indexOf(item);
    b.items.splice(idx, 1);
    const prev = r.previousElementSibling || r.nextElementSibling;
    r.remove();
    if (!b.items.length) { const it = newItem(); b.items.push(it); list.append(row(it)); }
    if (focusPrev && prev) {
      const pi = prev.querySelector('input');
      pi.focus();
      pi.setSelectionRange(pi.value.length, pi.value.length);
    }
    touch(note); updateFooter();
  };

  list.append(...b.items.map(row));
  updateFooter();
  return h('div', {}, list, footer);
}

// ---------------------------------------------------------------- ink toolbar
function onPenSeen() {
  if (settings.fingerAuto && settings.fingerDraws) {
    settings.fingerDraws = false;
    saveSettings();
    surfaces.forEach((s) => s.updateMode());
    syncToolbars();
    toast('Apple Pencil spotted ✏️ Pencil writes, your finger scrolls. (Tap the ✋ button to change that.)', { ms: 5000 });
  }
}

function onStrokeCut() {
  settings.manualScroll = true;
  saveSettings();
  surfaces.forEach((s) => s.updateMode());
  toast('A Pencil stroke got interrupted, so I switched finger-scrolling to backup mode. Change it in Backup & settings.', { ms: 6000 });
}

function setInkTool(patch) {
  Object.assign(inkTool, patch);
  lsSet('catchall:ink', inkTool);
  syncToolbars();
}
const syncToolbars = () => document.querySelectorAll('.ink-toolbar').forEach((t) => t._sync?.());

function inkToolbar(note, b, surface) {
  const tb = h('div', { class: 'ink-toolbar', role: 'toolbar', 'aria-label': 'Handwriting tools' });
  const toolBtn = (tool, iconName, label) => h('button', {
    class: 'tool' + (inkTool.tool === tool ? ' on' : ''), 'aria-label': label, title: label, 'aria-pressed': String(inkTool.tool === tool),
    onclick: () => setInkTool({ tool }),
  }, icon(iconName));

  tb._sync = () => {
    const dark = Ink.isDark();
    const parts = [toolBtn('pen', 'pen', 'Pen'), toolBtn('hl', 'highlighter', 'Highlighter'), toolBtn('eraser', 'eraser', 'Eraser'), h('span', { class: 'tb-sep' })];
    if (inkTool.tool !== 'eraser') {
      const isHl = inkTool.tool === 'hl';
      const table = isHl ? Ink.HL_COLORS : Ink.PEN_COLORS;
      const currentColor = isHl ? inkTool.hlColor : inkTool.penColor;
      for (const [key, c] of Object.entries(table)) {
        parts.push(h('button', {
          class: 'swatch' + (key === currentColor ? ' on' : ''), 'aria-label': c.name, title: c.name,
          style: `--sw:${isHl ? c.swatch : dark ? c.dark : c.light}`,
          onclick: () => setInkTool(isHl ? { hlColor: key } : { penColor: key }),
        }));
      }
      parts.push(h('span', { class: 'tb-sep' }));
    }
    for (const [key, px] of [['s', 4], ['m', 7], ['l', 11]]) {
      parts.push(h('button', {
        class: 'size' + (inkTool.size === key ? ' on' : ''), 'aria-label': { s: 'Thin', m: 'Medium', l: 'Thick' }[key],
        onclick: () => setInkTool({ size: key }),
      }, h('span', { class: 'size-dot', style: `width:${px}px;height:${px}px` })));
    }
    parts.push(h('span', { class: 'tb-sep' }));
    parts.push(h('button', { class: 'tool', 'aria-label': 'Undo', title: 'Undo', disabled: !surface.canUndo(), onclick: () => { surface.undo(); tb._sync(); } }, icon('undo')));
    parts.push(h('button', { class: 'tool', 'aria-label': 'Redo', title: 'Redo', disabled: !surface.canRedo(), onclick: () => { surface.redo(); tb._sync(); } }, icon('redo')));
    parts.push(h('span', { class: 'tb-spacer' }));
    parts.push(h('button', {
      class: 'tool' + (settings.fingerDraws ? ' on' : ''), 'aria-pressed': String(settings.fingerDraws),
      'aria-label': settings.fingerDraws ? 'Finger draws (tap so finger scrolls)' : 'Finger scrolls (tap so finger draws)',
      title: settings.fingerDraws ? 'Finger draws' : 'Finger scrolls — Pencil only',
      onclick: () => {
        settings.fingerDraws = !settings.fingerDraws;
        settings.fingerAuto = false;
        saveSettings();
        surfaces.forEach((s) => s.updateMode());
        syncToolbars();
        toast(settings.fingerDraws ? 'Finger draws now. (Scroll with two fingers.)' : 'Finger scrolls now. Only Apple Pencil writes.');
      },
    }, icon('finger')));
    parts.push(h('button', { class: 'tool', 'aria-label': 'Page options', title: 'Page options', onclick: (e) => blockMenu(e.currentTarget, note, b, surface) }, icon('more')));
    tb.replaceChildren(...parts);
  };
  tb._sync();
  return tb;
}

// ---------------------------------------------------------------- menus
let openMenu = null;
function closeMenu() {
  if (!openMenu) return;
  openMenu.remove();
  openMenu = null;
}
function popMenu(anchor, items) {
  closeMenu();
  const menu = h('div', { class: 'pop', role: 'menu' }, items.map((it) => {
    if (it === '-') return h('hr');
    if (it.heading) return h('div', { class: 'pop-heading' }, it.heading);
    return h('button', {
      class: 'pop-item' + (it.danger ? ' danger' : '') + (it.checked ? ' checked' : ''), role: 'menuitem',
      onclick: () => { closeMenu(); it.onClick(); },
    }, h('span', { class: 'pop-check' }, it.checked ? '✓' : ''), it.label);
  }));
  const backdrop = h('div', { class: 'pop-backdrop', onpointerdown: (e) => { e.preventDefault(); closeMenu(); } }, menu);
  document.body.append(backdrop);
  openMenu = backdrop;
  const r = anchor.getBoundingClientRect();
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8));
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  menu.style.left = left + 'px';
  menu.style.top = top + 'px';
  menu.addEventListener('pointerdown', (e) => e.stopPropagation());
}

function blockMenu(anchor, note, b, surface) {
  const i = note.blocks.indexOf(b);
  const items = [];
  if (b.type === 'checklist') {
    items.push({ label: 'Uncheck everything (reuse list)', onClick: () => { b.items.forEach((it) => { it.done = false; }); touch(note); renderEditorPage(note); } });
    items.push({ label: 'Move checked items to bottom', onClick: () => { b.items.sort((x, y) => x.done - y.done); touch(note); renderEditorPage(note); } });
    items.push({ label: 'Clear checked items', onClick: () => {
      b.items = b.items.filter((it) => !it.done);
      if (!b.items.length) b.items.push(newItem());
      touch(note); renderEditorPage(note);
    } });
    items.push('-');
  }
  if (b.type === 'ink' && surface) {
    items.push({ heading: 'Paper' });
    for (const [k, label] of [['lined', 'Lined'], ['grid', 'Grid'], ['dots', 'Dots'], ['blank', 'Blank']]) {
      items.push({ label, checked: (b.paper || 'lined') === k, onClick: () => surface.setPaper(k) });
    }
    items.push('-');
    items.push({ label: 'Save page as image', onClick: () => saveInkImage(note, b) });
    items.push({ label: 'Erase whole page', danger: true, onClick: async () => {
      if (await confirmDialog('Erase everything on this page?', 'You can still undo right after.', 'Erase')) surface.clear();
    } });
    items.push('-');
  }
  if (i > 0) items.push({ label: 'Move section up', onClick: () => moveBlock(note, b, -1) });
  if (i < note.blocks.length - 1) items.push({ label: 'Move section down', onClick: () => moveBlock(note, b, 1) });
  items.push({
    label: b.label != null ? 'Remove heading' : 'Add a heading',
    onClick: () => {
      if (b.label != null) delete b.label; else b.label = '';
      touch(note);
      renderEditorPage(note, b.label != null ? `[data-block="${b.id}"] .block-label` : null);
    },
  });
  items.push({ label: 'Delete section', danger: true, onClick: async () => {
    if (!blockEmpty(b) && !(await confirmDialog('Delete this section?', 'This removes it from the note.', 'Delete'))) return;
    note.blocks = note.blocks.filter((x) => x !== b);
    touch(note);
    renderEditorPage(note);
  } });
  popMenu(anchor, items);
}

function noteMenu(anchor, note) {
  popMenu(anchor, [
    { label: 'Copy as text', onClick: async () => {
      try { await navigator.clipboard.writeText(noteToText(note)); toast('Copied'); } catch { toast('Couldn’t copy — try Share instead.'); }
    } },
    { label: 'Duplicate', onClick: () => {
      const copy = structuredClone(note);
      copy.id = uid();
      copy.title = note.title ? `${note.title} (copy)` : '';
      copy.createdAt = copy.updatedAt = Date.now();
      copy.blocks.forEach((bl) => { bl.id = uid(); });
      state.notes.push(copy);
      scheduleSave(copy);
      openEditor(copy);
      toast('Duplicated — you’re in the copy now.');
    } },
    '-',
    { label: 'Move to Trash', danger: true, onClick: () => {
      note.deletedAt = Date.now();
      scheduleSave(note);
      state.openId = null;
      destroySurfaces();
      $('#editor').hidden = true;
      document.body.classList.remove('editing');
      saveUi();
      renderSidebar(); renderMain();
      toast('Moved to Trash', { action: 'Undo', onAction: () => { note.deletedAt = null; scheduleSave(note); renderSidebar(); renderMain(); } });
    } },
  ]);
}

function notebookMenu(anchor, nb) {
  if (!nb) return;
  const list = sortedNotebooks();
  const i = list.indexOf(nb);
  const swap = (j) => {
    const other = list[j];
    [nb.order, other.order] = [other.order, nb.order];
    saveNotebook(nb); saveNotebook(other);
    renderSidebar();
  };
  const items = [{ label: 'Edit name, icon & starter', onClick: () => editNotebook(nb) }];
  if (i > 0) items.push({ label: 'Move up in list', onClick: () => swap(i - 1) });
  if (i < list.length - 1) items.push({ label: 'Move down in list', onClick: () => swap(i + 1) });
  items.push('-', { label: 'Delete notebook', danger: true, onClick: async () => {
    const count = state.notes.filter((n) => n.notebookId === nb.id).length;
    const ok = await confirmDialog(`Delete “${nb.name}”?`, count ? `Its ${count} note${count === 1 ? '' : 's'} will move to the Inbox (nothing gets deleted).` : 'It’s empty, so nothing else changes.', 'Delete');
    if (!ok) return;
    const moved = state.notes.filter((n) => n.notebookId === nb.id);
    moved.forEach((n) => { n.notebookId = INBOX; scheduleSave(n); });
    state.notebooks = state.notebooks.filter((x) => x !== nb);
    await db.delete('notebooks', nb.id).catch(() => {});
    setView({ kind: 'inbox' });
  } });
  popMenu(anchor, items);
}

function trashMenu(anchor, note) {
  popMenu(anchor, [
    { label: 'Restore', onClick: () => {
      note.deletedAt = null;
      if (note.notebookId !== INBOX && !nbById(note.notebookId)) note.notebookId = INBOX;
      scheduleSave(note); renderSidebar(); renderMain(); toast('Restored');
    } },
    { label: 'Delete forever', danger: true, onClick: async () => {
      if (!(await confirmDialog('Delete this note forever?', 'This can’t be undone.', 'Delete forever'))) return;
      state.notes = state.notes.filter((n) => n !== note);
      await db.delete('notes', note.id).catch(() => {});
      renderSidebar(); renderMain();
    } },
  ]);
}

async function emptyTrash() {
  const trashed = state.notes.filter((n) => n.deletedAt);
  if (!(await confirmDialog(`Permanently delete ${trashed.length} note${trashed.length === 1 ? '' : 's'}?`, 'This can’t be undone.', 'Empty trash'))) return;
  state.notes = state.notes.filter((n) => !n.deletedAt);
  await db.deleteMany('notes', trashed.map((n) => n.id)).catch(() => {});
  renderSidebar(); renderMain();
}

// ---------------------------------------------------------------- dialogs + toast
function dialog({ title, message, body = [], actions, initialFocus }) {
  const dlg = $('#dialog');
  return new Promise((resolve) => {
    const done = (v) => { dlg.close(); resolve(v); };
    dlg.replaceChildren(h('form', { method: 'dialog', class: 'dlg', onsubmit: (e) => { e.preventDefault(); done('ok'); } },
      h('h2', {}, title),
      message ? h('p', { class: 'dlg-msg' }, message) : null,
      body,
      h('div', { class: 'dlg-actions' }, actions.map((a) => h('button', {
        type: a.value === 'ok' ? 'submit' : 'button',
        class: 'btn' + (a.primary ? ' primary' : '') + (a.danger ? ' danger' : ''),
        onclick: a.value === 'ok' ? null : () => done(a.value),
      }, a.label)))));
    dlg.oncancel = () => resolve(null);
    dlg.showModal();
    if (initialFocus) initialFocus.focus();
  });
}

async function confirmDialog(title, message, okLabel) {
  const r = await dialog({ title, message, actions: [{ label: 'Cancel', value: null }, { label: okLabel, value: 'ok', danger: true }] });
  return r === 'ok';
}

async function editNotebook(nb) {
  const isNew = !nb;
  const name = h('input', { class: 'field', value: nb?.name || '', placeholder: 'e.g. Dog business, House projects', maxlength: 40, autocapitalize: 'words' });
  const emoji = h('input', { class: 'field emoji-field', value: nb?.emoji || '📒', maxlength: 8, 'aria-label': 'Icon' });
  const picks = h('div', { class: 'emoji-picks' }, EMOJI_PICKS.map((e) => h('button', { type: 'button', class: 'emoji-pick', onclick: () => { emoji.value = e; } }, e)));
  const starter = h('select', { class: 'field' }, Object.entries(STARTERS).map(([k, v]) => h('option', { value: k }, v.label)));
  starter.value = nb?.starter || 'text';
  const res = await dialog({
    title: isNew ? 'New notebook' : 'Edit notebook',
    body: [
      h('label', { class: 'field-row' }, h('span', {}, 'Name'), name),
      h('div', { class: 'field-row' }, h('span', {}, 'Icon'), h('div', { class: 'emoji-wrap' }, emoji, picks)),
      h('label', { class: 'field-row' }, h('span', {}, 'New notes start as'), starter),
    ],
    actions: [{ label: 'Cancel', value: null }, { label: 'Save', value: 'ok', primary: true }],
    initialFocus: isNew ? name : null,
  });
  if (res !== 'ok' || !name.value.trim()) return;
  const target = nb || { id: uid(), order: Math.max(0, ...state.notebooks.map((n) => n.order)) + 1 };
  target.name = name.value.trim();
  target.emoji = firstGrapheme(emoji.value.trim()) || '📒';
  target.starter = starter.value;
  if (isNew) state.notebooks.push(target);
  await saveNotebook(target);
  if (isNew) setView({ kind: 'notebook', id: target.id });
  else { renderSidebar(); renderMain(); }
}

let toastTimer = 0;
function toast(msg, { action, onAction, ms = 3200 } = {}) {
  const t = $('#toast');
  t.replaceChildren(h('span', {}, msg));
  if (action) t.append(h('button', { class: 'toast-btn', onclick: () => { t.classList.remove('show'); onAction(); } }, action));
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), action ? 6000 : ms);
}

// ---------------------------------------------------------------- sharing + backup
function noteToText(note) {
  const out = [];
  if (note.title.trim()) out.push(note.title.trim(), '');
  for (const b of note.blocks) {
    if (b.label) out.push(`${b.label}:`);
    if (b.type === 'text' && b.text.trim()) out.push(b.text.trim());
    if (b.type === 'checklist') for (const i of b.items) { if (i.text.trim()) out.push(`${i.done ? '☑' : '☐'} ${i.text.trim()}`); }
    if (b.type === 'ink' && b.strokes.length) out.push('[handwriting]');
    out.push('');
  }
  return out.join('\n').trim();
}

function dataUrlToFile(url, name) {
  const [head, b64] = url.split(',');
  const type = head.match(/:(.*?);/)[1];
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type });
}

const safeName = (s) => (s || 'note').replace(/[^\w\- ]+/g, '').trim().slice(0, 40).replace(/\s+/g, '-') || 'note';

// Hands a file to the iPad share sheet (→ Save to Files / iCloud Drive / AirDrop),
// or downloads it where sharing files isn't supported.
async function saveFile(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return true; } catch (e) { if (e.name === 'AbortError') return false; }
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: file.name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return true;
}

async function shareNote(note) {
  const text = noteToText(note);
  const { title } = summarize(note);
  // Built synchronously so iPad still treats the share as "from your tap".
  const files = note.blocks.filter((b) => b.type === 'ink' && b.strokes.length)
    .map((b, i) => dataUrlToFile(Ink.renderInkImage(b).toDataURL('image/png'), `${safeName(title)}${i ? '-' + (i + 1) : ''}.png`));
  const payload = { title, text };
  if (files.length && navigator.canShare?.({ files })) payload.files = files;
  if (navigator.share) {
    try { await navigator.share(payload); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Copied the note as text.'); } catch { toast('Sharing isn’t available here.'); }
}

function saveInkImage(note, b) {
  const { title } = summarize(note);
  saveFile(dataUrlToFile(Ink.renderInkImage(b).toDataURL('image/png'), `${safeName(title)}.png`));
}

function serializeNote(n) {
  return { ...n, blocks: n.blocks.map((b) => (b.type === 'ink' ? { ...b, strokes: b.strokes.map((s) => ({ ...s, pts: Ink.u16ToB64(s.pts) })) } : b)) };
}
function deserializeNote(n) {
  return { ...n, blocks: (n.blocks || []).map((b) => (b.type === 'ink' ? { ...b, strokes: (b.strokes || []).map((s) => ({ ...s, pts: Ink.b64ToU16(s.pts) })) } : b)) };
}

async function backupNow() {
  await flushSaves();
  const data = {
    app: 'catchall', format: 1, appVersion: APP_VERSION, exportedAt: new Date().toISOString(),
    notebooks: state.notebooks, notes: state.notes.map(serializeNote),
  };
  const file = new File([JSON.stringify(data)], `catchall-backup-${todayStr()}.json`, { type: 'application/json' });
  const ok = await saveFile(file);
  if (!ok) return;
  settings.lastBackup = Date.now();
  saveSettings();
  toast('Backup made. Keep it somewhere that isn’t just this iPad (iCloud Drive is perfect).', { ms: 5000 });
  renderMain();
}

async function restoreBackup(file) {
  let data;
  try { data = JSON.parse(await file.text()); } catch { data = null; }
  if (!data || data.app !== 'catchall' || !Array.isArray(data.notes)) { toast('That file isn’t a Catchall backup.'); return; }
  let added = 0, updated = 0;
  const nbChanged = [];
  for (const nb of data.notebooks || []) {
    if (!nbById(nb.id)) { state.notebooks.push(nb); nbChanged.push(nb); }
  }
  const changed = [];
  if (data.notes.some((n) => n.welcome)) {
    const spare = state.notes.filter((n) => n.welcome && n.updatedAt === n.createdAt);
    if (spare.length) {
      state.notes = state.notes.filter((n) => !spare.includes(n));
      db.deleteMany('notes', spare.map((n) => n.id)).catch(() => {});
    }
  }
  for (const raw of data.notes) {
    let n;
    try { n = deserializeNote(raw); } catch { continue; }
    const existing = state.notes.find((x) => x.id === n.id);
    if (!existing) { state.notes.push(n); changed.push(n); added++; }
    else if (n.updatedAt > existing.updatedAt) { Object.assign(existing, n); changed.push(existing); updated++; }
  }
  try {
    if (nbChanged.length) await db.putMany('notebooks', nbChanged);
    if (changed.length) await db.putMany('notes', changed);
  } catch (e) { toast(`Restore hit a snag: ${e.message}`); return; }
  thumbCache.clear();
  renderSidebar(); renderMain();
  toast(added || updated ? `Restored ${added} new and ${updated} updated note${added + updated === 1 ? '' : 's'}.` : 'Everything in that backup is already here.');
}

// ---------------------------------------------------------------- settings view
async function renderSettings(body) {
  const since = settings.lastBackup ? `Last backup: ${ago(settings.lastBackup)}.` : 'No backup yet.';
  const fileInput = h('input', { type: 'file', accept: 'application/json,.json', hidden: true, onchange: () => { if (fileInput.files[0]) restoreBackup(fileInput.files[0]); fileInput.value = ''; } });

  const toggle = (label, hint, key, after) => {
    const cb = h('input', { type: 'checkbox', checked: !!settings[key], onchange: () => {
      settings[key] = cb.checked; if (key === 'fingerDraws') settings.fingerAuto = false; saveSettings(); after?.();
    } });
    return h('label', { class: 'setting-row' }, h('div', {}, h('div', { class: 'setting-title' }, label), hint ? h('div', { class: 'setting-hint' }, hint) : null), h('span', { class: 'switch' }, cb, h('span', { class: 'switch-ui' })));
  };

  const starterSel = h('select', { class: 'field', onchange: () => { settings.inboxStarter = starterSel.value; saveSettings(); } },
    ['ink', 'text', 'checklist'].map((k) => h('option', { value: k }, STARTERS[k].label)));
  starterSel.value = settings.inboxStarter;

  const storageLine = h('p', { class: 'setting-hint' }, 'Checking storage…');

  body.append(
    h('section', { class: 'panel' },
      h('h2', {}, '📦 Backup'),
      h('p', {}, 'Your notes are saved on this iPad only — no account, no cloud, works offline. That also means if the iPad is lost, reset, or Safari’s data gets cleared, the notes go with it. A backup file is your safety net.'),
      h('p', { class: 'setting-hint' }, `${since} Tip: choose “Save to Files” → iCloud Drive when the share sheet opens.`),
      h('div', { class: 'panel-actions' },
        h('button', { class: 'btn primary', onclick: backupNow }, icon('backup'), 'Back up now'),
        h('button', { class: 'btn', onclick: () => fileInput.click() }, 'Restore from a backup file'),
        fileInput),
      h('p', { class: 'setting-hint' }, 'Restoring merges: it adds missing notes and updates older copies. It never deletes anything.')),
    h('section', { class: 'panel' },
      h('h2', {}, '✏️ Apple Pencil & finger'),
      toggle('Finger draws on handwriting pages', 'Off = only Apple Pencil writes and your finger scrolls. This switches off by itself the first time you use a Pencil.', 'fingerDraws', () => surfaces.forEach((s) => s.updateMode())),
      toggle('Backup scrolling mode', 'Turn on if Pencil strokes ever get cut off or the page jumps while you write.', 'manualScroll', () => surfaces.forEach((s) => s.updateMode())),
      h('p', { class: 'setting-hint' }, 'Want handwriting you can search? Write with the Pencil inside a Typing box — iPad converts it to text (Scribble). Handwriting pages stay as ink; give them a title so search can find them.')),
    h('section', { class: 'panel' },
      h('h2', {}, '📥 Inbox'),
      h('label', { class: 'field-row' }, h('span', {}, 'New Inbox notes start as'), starterSel)),
    h('section', { class: 'panel' },
      h('h2', {}, '📒 Notebooks'),
      h('p', {}, 'Add, rename, reorder or delete notebooks from the ⋯ button at the top of each notebook.'),
      h('div', { class: 'panel-actions' }, h('button', { class: 'btn', onclick: () => editNotebook(null) }, icon('plus'), 'New notebook'))),
    h('section', { class: 'panel' },
      h('h2', {}, 'ℹ️ About'),
      storageLine,
      h('p', { class: 'setting-hint' }, `Catchall ${APP_VERSION} · ${isStandalone() ? 'Running as a Home Screen app' : 'Running in the browser — add it to your Home Screen for the best experience'}`)),
  );

  try {
    const [est, persisted] = await Promise.all([navigator.storage?.estimate?.(), navigator.storage?.persisted?.()]);
    const mb = est ? (est.usage / 1048576).toFixed(1) : '?';
    storageLine.textContent = `Using about ${mb} MB on this device for ${state.notes.length} notes. ${persisted ? 'Storage is marked “keep”, so the iPad won’t clear it to free space.' : ''}`;
  } catch { storageLine.textContent = `${state.notes.length} notes on this device.`; }
}

// ---------------------------------------------------------------- startup
function welcomeNote() {
  const now = Date.now();
  const tips = newList('Try these');
  tips.items = [
    'Tap + to jot something. It lands in the Inbox.',
    'Write with Apple Pencil on a handwriting page — your finger scrolls.',
    'Write with the Pencil inside a Typing box — iPad turns it into searchable text.',
    'Paste a list into a checklist — every line becomes its own item.',
    'Give notes a 📅 date and they show up in “Coming up”.',
    'Back up once a week: Backup & settings → Back up now.',
    'Done? ⋯ → Move to Trash.',
  ].map((t) => newItem(t));
  return {
    id: uid(), welcome: true, title: '👋 Start here', notebookId: INBOX, pinned: true, due: null, createdAt: now, updatedAt: now, deletedAt: null,
    blocks: [newText('One place for everything: to-dos, to-buys, meal plans, recipes, business ideas, gift lists, scribbles. Each notebook starts new notes the right way — checklists for lists, handwriting for ideas, ingredients + steps for recipes. Change any of that in the notebook’s ⋯ menu.'), tips],
  };
}

async function init() {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});

  let notes = [], notebooks = [], meta = [];
  try {
    [notes, notebooks, meta] = await Promise.all([db.getAll('notes'), db.getAll('notebooks'), db.getAll('meta')]);
  } catch (e) {
    toast(`Storage isn’t available here (${e.message}). Notes won’t be saved.`, { ms: 10000 });
  }
  const saved = meta.find((m) => m.key === 'settings');
  if (saved) { const { key, ...rest } = saved; Object.assign(settings, rest); }
  state.notes = notes;
  state.notebooks = notebooks;

  if (!settings.seeded) {
    state.notebooks = DEFAULT_NOTEBOOKS.map((nb, i) => ({ id: uid(), order: i, ...nb }));
    const welcome = welcomeNote();
    state.notes.push(welcome);
    settings.seeded = true;
    try {
      await db.putMany('notebooks', state.notebooks);
      await db.put('notes', welcome);
      await saveSettings();
    } catch { /* reported above */ }
  }

  // Empty the trash of anything older than 30 days.
  const cutoff = Date.now() - TRASH_DAYS * DAY;
  const expired = state.notes.filter((n) => n.deletedAt && n.deletedAt < cutoff);
  if (expired.length) {
    state.notes = state.notes.filter((n) => !expired.includes(n));
    db.deleteMany('notes', expired.map((n) => n.id)).catch(() => {});
  }

  // Ask iPadOS not to clear our storage when space runs low.
  navigator.storage?.persist?.().catch(() => {});

  const ui = lsGet('catchall:ui', {});
  if (ui.view && (ui.view.kind !== 'notebook' || nbById(ui.view.id))) state.view = ui.view;

  // Static UI wiring
  $('#search').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (q) {
      if (state.view.kind !== 'search') state.prevView = state.view;
      state.view = { kind: 'search', q };
      renderSidebar(); renderMain();
    } else {
      setView(state.prevView || { kind: 'inbox' });
    }
  });
  $('#add-notebook').addEventListener('click', () => editNotebook(null));
  $('#fab').addEventListener('click', createNote);
  $('#menu-btn').addEventListener('click', () => document.body.classList.toggle('nav-open'));
  $('#nav-scrim').addEventListener('click', () => document.body.classList.remove('nav-open'));
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    thumbCache.clear();
    surfaces.forEach((s) => s.redraw());
    syncToolbars();
    if (!state.openId) renderMain();
  });

  renderSidebar();
  renderMain();
  const reopen = ui.openId && state.notes.find((n) => n.id === ui.openId && !n.deletedAt);
  if (reopen) openEditor(reopen);
}

init();
