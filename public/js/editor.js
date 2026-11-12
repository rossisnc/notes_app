// The note editor: a vertical stack of pages you write on with Apple Pencil.
// Pencil (or mouse) writes; fingers scroll. Scribble over ink to erase it; draw a shape and hold to snap it.
import * as store from './store.js';
import * as db from './db.js';
import * as ink from './ink.js';
import * as tpl from './templates.js';
import { recognize, looksLikeScratch, scratchTargets, distToStroke, strokeBox, fromXY } from './shapes.js';
import { el, icon, iconBtn, popover, actions, confirmBox, promptBox, toast, sheet } from './ui.js';
import { pickTemplate } from './picker.js';
import { importAsPages } from './importer.js';

const HOLD_MS = 550;
let S = null; // editor state

const prefs = { tool: 'pen', color: 'k', size: 1, dim: 1, darkPaper: false };

async function loadPrefs() {
  Object.assign(prefs, await db.getMeta('editorPrefs', {}));
}
function savePrefs() { db.setMeta('editorPrefs', { ...prefs }); }

export async function openEditor(noteId, { onClose, pageId } = {}) {
  await loadPrefs();
  const note = await store.getItem(noteId);
  if (!note || note.type !== 'note') { toast("Couldn't open that note."); onClose && onClose(); return; }
  const pageList = await store.getPages(note);
  if (!pageList.length) {
    const size = await store.pageSize();
    const p = store.newPage(note.id, note.lastBg || { kind: 'template', id: 'lined' }, size);
    await store.insertPages(note, [p]);
    pageList.push(p);
  }
  S = {
    note, pages: new Map(pageList.map((p) => [p.id, p])), mounted: new Map(),
    undo: [], redo: [], dirty: new Set(), saveTimer: null, active: null, currentPageId: pageList[0].id,
    onClose, cssW: 800,
  };
  buildDOM();
  layoutPages();
  if (pageId && S.pages.has(pageId)) requestAnimationFrame(() => scrollToPage(pageId, false));
  db.setMeta('lastOpenNote', note.id);
}

export function isOpen() { return !!S; }

export async function closeEditor() {
  if (!S) return;
  await flushSave();
  S.observer && S.observer.disconnect();
  window.removeEventListener('resize', S.onResize);
  document.removeEventListener('visibilitychange', S.onHide);
  S.root.remove();
  const cb = S.onClose;
  S = null;
  cb && cb();
}

// ---------------------------------------------------------------- DOM
function buildDOM() {
  const title = el('input', { class: 'title-input', value: S.note.title, 'aria-label': 'Note title', autocomplete: 'off' });
  title.addEventListener('change', async () => { S.note.title = title.value.trim() || S.note.title; await store.saveItem(S.note); });
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter') title.blur(); });

  const penBtn = iconBtn('pen', 'Pen', () => setTool('pen'));
  const eraserBtn = iconBtn('eraser', 'Eraser', () => setTool('eraser'));
  const sizeBtns = ink.SIZES.map((s, i) => el('button', { class: 'size-btn', 'aria-label': ['Fine', 'Medium', 'Thick'][i], onclick: () => { prefs.size = i; setTool('pen'); } },
    el('span', { class: 'dot', style: { width: 4 + i * 4 + 'px', height: 4 + i * 4 + 'px' } })));
  const colorBtns = ['k', 'w'].map((c) => el('button', { class: `color-btn c-${c}`, 'aria-label': c === 'k' ? 'Black ink' : 'White ink', onclick: () => { prefs.color = c; setTool('pen'); } }));
  const undoBtn = iconBtn('undo', 'Undo', () => undo());
  const redoBtn = iconBtn('redo', 'Redo', () => redo());
  const sunBtn = iconBtn('sun', 'Page brightness', () => brightnessPopover(sunBtn));
  const addBtn = iconBtn('plus', 'Add page', () => addPageAfterCurrent());
  const moreBtn = iconBtn('more', 'More', () => moreMenu());
  const pageNum = el('div', { class: 'page-num' });

  const toolbar = el('header', { class: 'toolbar editor-bar' },
    el('div', { class: 'tb-left' }, iconBtn('back', 'Back to notes', () => closeEditor()), title),
    el('div', { class: 'tb-tools' },
      el('div', { class: 'seg' }, penBtn, ...sizeBtns),
      el('div', { class: 'seg' }, ...colorBtns),
      el('div', { class: 'seg' }, eraserBtn),
      el('div', { class: 'seg' }, undoBtn, redoBtn),
      el('div', { class: 'seg' }, sunBtn, addBtn, moreBtn)));

  const pagesEl = el('div', { class: 'pages', tabindex: '-1' });
  const root = el('section', { class: 'editor' }, toolbar, pagesEl, pageNum);
  document.getElementById('app').append(root);

  S.root = root; S.pagesEl = pagesEl; S.pageNum = pageNum;
  S.btns = { penBtn, eraserBtn, sizeBtns, colorBtns, undoBtn, redoBtn };
  S.live = el('canvas', { class: 'live' });

  pagesEl.addEventListener('pointerdown', onDown);
  pagesEl.addEventListener('pointermove', onMove);
  pagesEl.addEventListener('pointerup', onUp);
  pagesEl.addEventListener('pointercancel', onCancel);
  pagesEl.addEventListener('touchstart', onTouchStart, { passive: false });
  pagesEl.addEventListener('touchmove', onTouchMove, { passive: false });
  pagesEl.addEventListener('touchend', onTouchEnd);
  pagesEl.addEventListener('scroll', () => requestAnimationFrame(updateCurrentPage), { passive: true });

  S.observer = new IntersectionObserver(onIntersect, { root: pagesEl, rootMargin: '120% 0px' });
  S.onResize = () => { clearTimeout(S.resizeT); S.resizeT = setTimeout(layoutPages, 120); };
  window.addEventListener('resize', S.onResize);
  S.onHide = () => { if (document.visibilityState === 'hidden') flushSave(); };
  document.addEventListener('visibilitychange', S.onHide);
  applyLook();
  refreshToolUI();
}

function refreshToolUI() {
  if (!S) return;
  const { penBtn, eraserBtn, sizeBtns, colorBtns, undoBtn, redoBtn } = S.btns;
  penBtn.classList.toggle('on', prefs.tool === 'pen');
  eraserBtn.classList.toggle('on', prefs.tool === 'eraser');
  sizeBtns.forEach((b, i) => b.classList.toggle('on', prefs.tool === 'pen' && prefs.size === i));
  colorBtns.forEach((b) => b.classList.toggle('on', b.classList.contains(`c-${prefs.color}`)));
  undoBtn.disabled = !S.undo.length;
  redoBtn.disabled = !S.redo.length;
}

function setTool(t) { prefs.tool = t; savePrefs(); refreshToolUI(); }

function applyLook() {
  S.pagesEl.style.setProperty('--dim', prefs.dim);
  S.pagesEl.classList.toggle('darkpaper', !!prefs.darkPaper);
}

function brightnessPopover(anchor) {
  const val = el('span', { class: 'muted' }, Math.round(prefs.dim * 100) + '%');
  const slider = el('input', { type: 'range', min: '35', max: '100', value: String(Math.round(prefs.dim * 100)), class: 'slider', 'aria-label': 'Page brightness' });
  slider.addEventListener('input', () => { prefs.dim = slider.value / 100; val.textContent = slider.value + '%'; applyLook(); });
  slider.addEventListener('change', savePrefs);
  const toggle = el('input', { type: 'checkbox', class: 'switch', checked: prefs.darkPaper });
  toggle.addEventListener('change', () => { prefs.darkPaper = toggle.checked; applyLook(); savePrefs(); });
  popover(anchor, el('div', { class: 'pop-body' },
    el('div', { class: 'pop-row' }, el('strong', {}, 'Page brightness'), val), slider,
    el('label', { class: 'pop-row switch-row' }, el('span', {}, el('strong', {}, 'Dark paper'), el('br'), el('small', { class: 'muted' }, 'Flips light pages to dark. Your ink flips too.')), toggle),
    el('p', { class: 'muted small' }, "Only changes how pages look on screen — nothing saved is changed.")));
}

// ---------------------------------------------------------------- pages layout + virtualization
function pageCssSize(page) {
  const w = S.cssW;
  return { w, h: (w * page.h) / page.w };
}

function layoutPages() {
  if (!S) return;
  const avail = S.pagesEl.clientWidth - 24;
  S.cssW = Math.max(280, Math.min(avail, 1100));
  const keep = new Set(S.note.pageIds);
  // remove wraps for deleted pages
  for (const wrap of [...S.pagesEl.querySelectorAll('.page')]) if (!keep.has(wrap.dataset.id)) { unmount(wrap.dataset.id); S.observer.unobserve(wrap); wrap.remove(); }
  let prev = null;
  S.note.pageIds.forEach((id, idx) => {
    const page = S.pages.get(id);
    if (!page) return;
    let wrap = S.pagesEl.querySelector(`.page[data-id="${id}"]`);
    if (!wrap) {
      wrap = el('div', { class: 'page', 'data-id': id });
      S.observer.observe(wrap);
    }
    const { w, h } = pageCssSize(page);
    wrap.style.width = w + 'px';
    wrap.style.height = h + 'px';
    wrap.dataset.index = idx + 1;
    if (prev) prev.after(wrap); else S.pagesEl.prepend(wrap);
    prev = wrap;
    const m = S.mounted.get(id);
    if (m) { renderInk(id); renderTabs(id); }
  });
  let endBtn = S.pagesEl.querySelector('.add-page-end');
  if (!endBtn) {
    endBtn = el('button', { class: 'add-page-end', html: icon('plus') + '<span>Add page</span>', onclick: () => addPage(S.note.pageIds.length - 1) });
  }
  S.pagesEl.append(endBtn);
  updateCurrentPage();
}

function onIntersect(entries) {
  for (const e of entries) {
    const id = e.target.dataset.id;
    if (e.isIntersecting) mount(id, e.target); else unmount(id);
  }
}

async function mount(id, wrap) {
  if (!S || S.mounted.has(id)) return;
  const page = S.pages.get(id);
  if (!page) return;
  const m = { wrap, img: el('img', { class: 'bg', alt: '', decoding: 'async', draggable: 'false' }), canvas: el('canvas', { class: 'ink' }) };
  S.mounted.set(id, m);
  wrap.append(m.img, m.canvas);
  setBackground(id);
  renderInk(id);
  renderTabs(id);
}

async function setBackground(id) {
  const m = S && S.mounted.get(id);
  const page = S && S.pages.get(id);
  if (!m || !page) return;
  const tab = page.tabId && S.note.tabs ? S.note.tabs.find((t) => t.id === page.tabId) : null;
  const url = await tpl.bgURL(page.bg, page, { accent: tab ? tab.color : undefined });
  if (url) m.img.src = url;
  m.wrap.classList.toggle('is-dark', await tpl.isDarkBg(page.bg));
}

function unmount(id) {
  const m = S && S.mounted.get(id);
  if (!m) return;
  if (S.active && S.active.page.id === id) return; // never unmount mid-stroke
  m.canvas.width = 0; m.canvas.height = 0;
  m.wrap.replaceChildren();
  S.mounted.delete(id);
}

function renderInk(id) {
  const m = S.mounted.get(id);
  const page = S.pages.get(id);
  if (!m || !page) return;
  const ctx = ink.prepCanvas(m.canvas, page, S.cssW);
  ink.renderStrokes(ctx, page);
}

function updateCurrentPage() {
  if (!S) return;
  const box = S.pagesEl.getBoundingClientRect();
  const mid = box.top + box.height / 2;
  let best = null, bestD = Infinity;
  for (const wrap of S.pagesEl.querySelectorAll('.page')) {
    const r = wrap.getBoundingClientRect();
    const d = mid < r.top ? r.top - mid : mid > r.bottom ? mid - r.bottom : 0;
    if (d < bestD) { bestD = d; best = wrap; }
  }
  if (best) {
    S.currentPageId = best.dataset.id;
    S.pageNum.textContent = `Page ${best.dataset.index} of ${S.note.pageIds.length}`;
  }
}

function scrollToPage(id, smooth = true) {
  const wrap = S && S.pagesEl.querySelector(`.page[data-id="${id}"]`);
  if (!wrap) return;
  S.pagesEl.scrollTo({ top: wrap.offsetTop - 12, behavior: smooth ? 'smooth' : 'auto' });
}

// ---------------------------------------------------------------- tabs (tabbed notebooks)
function renderTabs(id) {
  const m = S.mounted.get(id);
  const page = S.pages.get(id);
  if (!m || !page) return;
  m.wrap.querySelector('.tabs')?.remove();
  if (!S.note.tabs || !page.tabId) return;
  const tabs = el('div', { class: 'tabs', style: { width: (130 / page.w) * 100 + '%' } },
    S.note.tabs.map((t) => {
      const b = el('button', { class: `tab ${t.id === page.tabId ? 'current' : ''}`, style: { background: t.color }, 'aria-label': `Jump to ${t.label}` }, el('span', {}, t.label));
      let pressT = null, long = false;
      b.addEventListener('pointerdown', () => { long = false; pressT = setTimeout(() => { long = true; editTab(t); }, 550); });
      const cancel = () => clearTimeout(pressT);
      b.addEventListener('pointerup', cancel); b.addEventListener('pointerleave', cancel); b.addEventListener('pointercancel', cancel);
      b.addEventListener('click', (e) => { e.stopPropagation(); if (!long) jumpToTab(t.id); });
      return b;
    }));
  m.wrap.append(tabs);
}

function jumpToTab(tabId) {
  const id = S.note.pageIds.find((pid) => S.pages.get(pid)?.tabId === tabId);
  if (id) scrollToPage(id);
}

async function editTab(t) {
  const label = await promptBox('Tab name', t.label, { placeholder: 'e.g. Ideas' });
  if (label === null) return;
  t.label = label.trim().slice(0, 14) || t.label;
  await store.saveItem(S.note);
  for (const id of S.mounted.keys()) renderTabs(id);
}

async function manageTabs() {
  const list = el('div', { class: 'tab-list' });
  const draw = () => {
    list.replaceChildren(...S.note.tabs.map((t, i) => el('div', { class: 'tab-row' },
      el('span', { class: 'swatch', style: { background: t.color } }),
      el('span', { class: 'grow' }, t.label),
      el('button', { class: 'btn small', onclick: async () => { await editTab(t); draw(); } }, 'Rename'),
      i > 0 ? el('button', { class: 'btn small', onclick: async () => { S.note.tabs.splice(i, 1); S.note.tabs.splice(i - 1, 0, t); await store.saveItem(S.note); draw(); refreshAllTabs(); } }, '↑') : null,
      S.note.tabs.length > 1 ? el('button', { class: 'btn small danger', onclick: async () => {
        const pagesIn = S.note.pageIds.filter((pid) => S.pages.get(pid)?.tabId === t.id);
        if (!(await confirmBox(`Delete the "${t.label}" tab and its ${pagesIn.length} page(s)?`, { ok: 'Delete', danger: true }))) return;
        for (const pid of pagesIn) { await store.removePage(S.note, pid); S.pages.delete(pid); }
        S.note.tabs = S.note.tabs.filter((x) => x.id !== t.id);
        await store.saveItem(S.note);
        layoutPages(); refreshAllTabs(); draw();
      } }, 'Delete') : null)));
  };
  draw();
  const addTab = el('button', { class: 'btn primary', onclick: async () => {
    if (S.note.tabs.length >= 12) { toast('12 tabs is the max.'); return; }
    const used = new Set(S.note.tabs.map((t) => t.color));
    const color = store.TAB_COLORS.find((c) => !used.has(c)) || store.TAB_COLORS[0];
    const t = { id: store.uid(), label: String(S.note.tabs.length + 1).padStart(2, '0'), color };
    S.note.tabs.push(t);
    const last = S.pages.get(S.note.pageIds[S.note.pageIds.length - 1]);
    const page = store.newPage(S.note.id, last ? last.bg : { kind: 'template', id: 'tabbed' }, await store.pageSize(), { tabId: t.id });
    S.pages.set(page.id, page);
    await store.insertPages(S.note, [page]);
    layoutPages(); refreshAllTabs(); draw();
  } }, '+ Add tab');
  sheet({ title: 'Tabs', content: el('div', {}, el('p', { class: 'muted small' }, 'Tip: press and hold a tab on the page to rename it.'), list, el('div', { class: 'row-end' }, addTab)) });
}

function refreshAllTabs() { for (const id of S.mounted.keys()) { renderTabs(id); setBackground(id); } }

// ---------------------------------------------------------------- pointer input
function pagePoint(e, a) {
  const x = ((e.clientX - a.rect.left) / a.rect.width) * a.page.w;
  const y = ((e.clientY - a.rect.top) / a.rect.height) * a.page.h;
  const p = e.pointerType === 'pen' ? Math.max(5, Math.round((e.pressure || 0.5) * 100)) : 50;
  return [Math.round(x), Math.round(y), p];
}

function onDown(e) {
  if (!S || e.pointerType === 'touch') return;
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  if (e.target.closest('.tabs, button')) return;
  const wrap = e.target.closest('.page');
  if (!wrap) return;
  const page = S.pages.get(wrap.dataset.id);
  if (!page || !S.mounted.has(page.id)) return;
  e.preventDefault();
  try { S.pagesEl.setPointerCapture(e.pointerId); } catch {}
  const a = S.active = { id: e.pointerId, page, wrap, rect: wrap.getBoundingClientRect(), tool: prefs.tool, removed: [] };
  const first = pagePoint(e, a);
  if (a.tool === 'eraser') { eraseAt(first[0], first[1]); return; }
  a.stroke = { c: prefs.color, s: ink.SIZES[prefs.size], pts: first.slice() };
  if (e.pointerType !== 'pen') a.stroke.m = true;
  a.anchor = first;
  armHold();
  const ctx = ink.prepCanvas(S.live, page, S.cssW);
  a.liveCtx = ctx;
  wrap.append(S.live);
  drawLive();
}

function onMove(e) {
  const a = S && S.active;
  if (!a || e.pointerId !== a.id) return;
  e.preventDefault();
  const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
  const list = evs.length ? evs : [e];
  for (const ev of list) {
    const [x, y, p] = pagePoint(ev, a);
    if (a.tool === 'eraser') { eraseAt(x, y); continue; }
    if (a.snapped) continue;
    const pts = a.stroke.pts;
    const lx = pts[pts.length - 3], ly = pts[pts.length - 2];
    if (Math.abs(x - lx) + Math.abs(y - ly) < 1) continue;
    pts.push(x, y, p);
    if (Math.hypot(x - a.anchor[0], y - a.anchor[1]) > 9) { a.anchor = [x, y]; armHold(); }
  }
  if (a.tool === 'pen' && !a.raf) a.raf = requestAnimationFrame(drawLive);
}

function armHold() {
  const a = S.active;
  clearTimeout(a.holdT);
  a.holdT = setTimeout(() => {
    if (!S || S.active !== a || a.snapped || a.stroke.pts.length < 18) return;
    const shape = recognize(a.stroke.pts);
    if (shape) {
      a.snapped = { c: a.stroke.c, s: a.stroke.s, shape: true, pts: fromXY(shape.points) };
      drawLive();
    }
  }, HOLD_MS);
}

function drawLive() {
  const a = S && S.active;
  if (!a || !a.liveCtx) return;
  a.raf = 0;
  ink.clear(a.liveCtx, a.page);
  ink.drawStroke(a.liveCtx, a.snapped || a.stroke, { live: true });
}

function onUp(e) {
  const a = S && S.active;
  if (!a || e.pointerId !== a.id) return;
  finishStroke(a);
}

function onCancel(e) {
  const a = S && S.active;
  if (!a || e.pointerId !== a.id) return;
  // Treat a cancelled pen stroke as finished rather than losing it.
  finishStroke(a);
}

function finishStroke(a) {
  clearTimeout(a.holdT);
  cancelAnimationFrame(a.raf);
  S.active = null;
  S.live.remove();
  const page = a.page;
  if (a.tool === 'eraser') {
    if (a.removed.length) pushUndo({ type: 'remove', pageId: page.id, items: a.removed });
    return;
  }
  const stroke = a.snapped || a.stroke;
  if (!a.snapped && looksLikeScratch(stroke.pts)) {
    const hits = scratchTargets(stroke.pts, page.strokes);
    if (hits.length) {
      const items = hits.map((i) => ({ s: page.strokes[i], i }));
      page.strokes = page.strokes.filter((_, i) => !hits.includes(i));
      pushUndo({ type: 'remove', pageId: page.id, items });
      renderInk(page.id);
      markDirty(page.id);
      return;
    }
  }
  page.strokes.push(stroke);
  const m = S.mounted.get(page.id);
  if (m) ink.drawStroke(m.canvas.getContext('2d'), stroke);
  pushUndo({ type: 'add', pageId: page.id, strokes: [stroke] });
  markDirty(page.id);
}

function eraseAt(x, y) {
  const a = S.active;
  const page = a.page;
  const r = 14;
  let changed = false;
  for (let i = page.strokes.length - 1; i >= 0; i--) {
    const st = page.strokes[i];
    const b = st._box || (st._box = strokeBox(st.pts));
    const pad = r + st.s;
    if (x < b.minX - pad || x > b.maxX + pad || y < b.minY - pad || y > b.maxY + pad) continue;
    if (distToStroke(x, y, st.pts) <= pad) {
      a.removed.push({ s: st, i });
      page.strokes.splice(i, 1);
      changed = true;
    }
  }
  if (changed) { renderInk(page.id); markDirty(page.id); }
}

// Pencil touches must not scroll the page; finger touches should.
function onTouchStart(e) {
  for (const t of e.changedTouches) {
    if (t.touchType === 'stylus' && !e.target.closest('.tabs, button')) { e.preventDefault(); return; }
  }
  // two-finger tap = undo
  if (e.touches.length === 2) S.twoTap = { t: Date.now(), x: e.touches[0].clientX, y: e.touches[0].clientY };
  else if (e.touches.length > 2) S.twoTap = null;
}

function onTouchMove(e) {
  if (S.active) { e.preventDefault(); return; }
  for (const t of e.changedTouches) if (t.touchType === 'stylus') { e.preventDefault(); return; }
  if (S.twoTap && e.touches[0] && Math.hypot(e.touches[0].clientX - S.twoTap.x, e.touches[0].clientY - S.twoTap.y) > 12) S.twoTap = null;
}

function onTouchEnd(e) {
  if (S && S.twoTap && e.touches.length === 0) {
    if (Date.now() - S.twoTap.t < 300) undo();
    S.twoTap = null;
  }
}

// ---------------------------------------------------------------- undo / redo
function pushUndo(action) {
  S.undo.push(action);
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  refreshToolUI();
}

function apply(action, reverse) {
  const page = S.pages.get(action.pageId);
  if (!page) return;
  if (action.type === 'add') {
    if (reverse) page.strokes = page.strokes.filter((s) => !action.strokes.includes(s));
    else page.strokes.push(...action.strokes);
  } else if (reverse) {
    // undo a removal: put strokes back where they were
    for (const { s, i } of [...action.items].sort((x, y) => x.i - y.i)) page.strokes.splice(Math.min(i, page.strokes.length), 0, s);
  } else {
    const gone = new Set(action.items.map((x) => x.s));
    page.strokes = page.strokes.filter((s) => !gone.has(s));
  }
  renderInk(page.id);
  markDirty(page.id);
  if (!S.mounted.has(page.id)) scrollToPage(page.id);
}

function undo() {
  if (!S || !S.undo.length) return;
  const a = S.undo.pop();
  apply(a, true);
  S.redo.push(a);
  refreshToolUI();
}

function redo() {
  if (!S || !S.redo.length) return;
  const a = S.redo.pop();
  apply(a, false);
  S.undo.push(a);
  refreshToolUI();
}

// ---------------------------------------------------------------- saving
function markDirty(pageId) {
  S.dirty.add(pageId);
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushSave, 700);
}

async function flushSave() {
  if (!S) return;
  clearTimeout(S.saveTimer);
  const ids = [...S.dirty];
  S.dirty.clear();
  for (const id of ids) {
    const page = S.pages.get(id);
    if (!page) continue;
    await store.savePage(page, { ink: true });
  }
  if (ids.length) await store.saveItem(S.note);
}

// ---------------------------------------------------------------- pages: add / change / delete
async function addPage(afterIndex, bg) {
  const ref = S.pages.get(S.note.pageIds[afterIndex]) || S.pages.get(S.note.pageIds[S.note.pageIds.length - 1]);
  const useBg = bg || (ref && ref.bg.kind !== 'image' ? ref.bg : S.note.lastBg) || { kind: 'template', id: 'lined' };
  const size = await store.sizeForBg(useBg);
  const extra = {};
  if (ref && ref.tabId) {
    extra.tabId = ref.tabId;
    // add at the end of this tab's section
    let last = afterIndex;
    S.note.pageIds.forEach((pid, i) => { if (S.pages.get(pid)?.tabId === ref.tabId) last = i; });
    afterIndex = Math.max(afterIndex, last);
  }
  const page = store.newPage(S.note.id, useBg, size, extra);
  S.pages.set(page.id, page);
  await store.insertPages(S.note, [page], afterIndex);
  layoutPages();
  scrollToPage(page.id);
}

function addPageAfterCurrent() {
  const idx = S.note.pageIds.indexOf(S.currentPageId);
  addPage(idx < 0 ? S.note.pageIds.length - 1 : idx);
}

async function moreMenu() {
  const idx = S.note.pageIds.indexOf(S.currentPageId);
  const choice = await actions('This page & note', [
    { label: 'Add page with a different template…', value: 'add-tpl', icon: 'page' },
    { label: 'Add scanned pages / photos here…', value: 'add-scan', icon: 'scan' },
    { label: "Change this page's template…", value: 'change', icon: 'page' },
    S.note.tabs ? { label: 'Edit tabs…', value: 'tabs', icon: 'notes' } : null,
    idx > 0 ? { label: 'Move page up', value: 'up' } : null,
    idx < S.note.pageIds.length - 1 ? { label: 'Move page down', value: 'down' } : null,
    { label: 'Delete this page', value: 'delete', icon: 'trash', danger: true },
  ]);
  if (!choice || !S) return;
  const page = S.pages.get(S.currentPageId);
  if (choice === 'add-tpl') {
    const bg = await pickTemplate({ title: 'New page' });
    if (bg) addPage(idx, bg);
  } else if (choice === 'add-scan') {
    const pages = await importAsPages(S.note.id);
    if (pages && pages.length) {
      if (page && page.tabId) pages.forEach((p) => { p.tabId = page.tabId; });
      for (const p of pages) S.pages.set(p.id, p);
      await store.insertPages(S.note, pages, idx);
      layoutPages();
      scrollToPage(pages[0].id);
    }
  } else if (choice === 'change') {
    const bg = await pickTemplate({ title: "This page's template" });
    if (bg && page) {
      page.bg = bg;
      if (!page.strokes.length) Object.assign(page, await store.sizeForBg(bg));
      S.note.lastBg = bg;
      await store.savePage(page);
      await store.saveItem(S.note);
      layoutPages();
      setBackground(page.id);
    }
  } else if (choice === 'tabs') {
    manageTabs();
  } else if (choice === 'up' || choice === 'down') {
    const j = choice === 'up' ? idx - 1 : idx + 1;
    const ids = S.note.pageIds;
    [ids[idx], ids[j]] = [ids[j], ids[idx]];
    await store.saveItem(S.note);
    layoutPages();
    scrollToPage(S.currentPageId);
  } else if (choice === 'delete') {
    if (S.note.pageIds.length <= 1) { toast("A note needs at least one page. Delete the note from the list instead."); return; }
    if (page.strokes.length && !(await confirmBox('Delete this page and everything on it?', { ok: 'Delete page', danger: true }))) return;
    await store.removePage(S.note, page.id);
    S.pages.delete(page.id);
    S.undo = S.undo.filter((a) => a.pageId !== page.id);
    S.redo = S.redo.filter((a) => a.pageId !== page.id);
    layoutPages();
    refreshToolUI();
  }
}
