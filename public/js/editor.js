// The note editor: a vertical stack of pages you write on with Apple Pencil.
// Pencil (or mouse) writes; fingers scroll. Scribble over ink to erase it; draw a shape and hold to snap it.
import * as store from './store.js';
import * as db from './db.js';
import * as ink from './ink.js';
import * as tpl from './templates.js';
import { recognize, looksLikeScratch, scratchTargets, distToStroke, strokeBox, fromXY, lassoSelect } from './shapes.js';
import { el, icon, iconBtn, popover, actions, confirmBox, promptBox, toast, sheet } from './ui.js';
import { pickTemplate } from './picker.js';
import { CHECKBOXES } from './checkboxes.js';
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
    const p = store.newPage(note.id, note.lastBg || tpl.DEFAULT_BG, size);
    await store.insertPages(note, [p]);
    pageList.push(p);
  }
  S = {
    note, pages: new Map(pageList.map((p) => [p.id, p])), mounted: new Map(),
    undo: [], redo: [], dirty: new Set(), inkDirty: new Set(), saveTimer: null, active: null, currentPageId: pageList[0].id,
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
  const selectBtn = iconBtn('lasso', 'Select', () => setTool('select'));
  const sizeBtns = ink.SIZES.map((s, i) => el('button', { class: 'size-btn', 'aria-label': ['Fine', 'Medium', 'Thick'][i], onclick: () => { prefs.size = i; setTool('pen'); } },
    el('span', { class: 'dot', style: { width: [3, 6, 10][i] + 'px', height: [3, 6, 10][i] + 'px' } })));
  const colorBtn = el('button', { class: 'color-btn', 'aria-label': 'Ink color', onclick: () => colorPopover(colorBtn) });
  const undoBtn = iconBtn('undo', 'Undo', () => undo());
  const redoBtn = iconBtn('redo', 'Redo', () => redo());
  const sunBtn = iconBtn('sun', 'Page brightness', () => brightnessPopover(sunBtn));
  const addBtn = iconBtn('plus', 'Add page', () => addPagePopover(addBtn));
  const moreBtn = iconBtn('more', 'More', () => moreMenu());
  const pageNum = el('div', { class: 'page-num' });

  const toolbar = el('header', { class: 'toolbar editor-bar' },
    el('div', { class: 'tb-left' }, iconBtn('back', 'Back to notes', () => closeEditor()), title),
    el('div', { class: 'tb-tools' },
      el('div', { class: 'seg' }, penBtn, ...sizeBtns),
      el('div', { class: 'seg' }, colorBtn),
      el('div', { class: 'seg' }, selectBtn, eraserBtn),
      el('div', { class: 'seg' }, undoBtn, redoBtn),
      el('div', { class: 'seg' }, sunBtn, addBtn, moreBtn)));

  const pagesEl = el('div', { class: 'pages', tabindex: '-1' });
  const root = el('section', { class: 'editor' }, toolbar, pagesEl, pageNum);
  document.getElementById('app').append(root);

  S.root = root; S.pagesEl = pagesEl; S.pageNum = pageNum;
  S.btns = { penBtn, eraserBtn, selectBtn, sizeBtns, colorBtn, undoBtn, redoBtn };
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
  const { penBtn, eraserBtn, selectBtn, sizeBtns, colorBtn, undoBtn, redoBtn } = S.btns;
  penBtn.classList.toggle('on', prefs.tool === 'pen');
  eraserBtn.classList.toggle('on', prefs.tool === 'eraser');
  selectBtn.classList.toggle('on', prefs.tool === 'select');
  sizeBtns.forEach((b, i) => b.classList.toggle('on', prefs.tool === 'pen' && prefs.size === i));
  colorBtn.style.setProperty('--swatch', ink.colorOf(prefs.color));
  undoBtn.disabled = !S.undo.length;
  redoBtn.disabled = !S.redo.length;
}

function setTool(t) {
  if (t !== 'select') clearSelection();
  prefs.tool = t;
  savePrefs();
  refreshToolUI();
}

/** Ink colour palette. With something selected it recolours the selection; otherwise it sets the pen colour. */
function colorPopover(anchor) {
  const pop = popover(anchor, el('div', { class: 'pop-body' },
    el('strong', {}, S.sel ? 'Recolor selection' : 'Ink color'),
    el('div', { class: 'palette' }, ink.PALETTE.map((p) => el('button', {
      class: `swatch-btn ${!S.sel && prefs.color === p.c ? 'on' : ''}`, 'aria-label': p.label, title: p.label,
      style: { background: ink.colorOf(p.c) },
      onclick: () => { pop.close(); if (S.sel) recolorSelection(p.c); else { prefs.color = p.c; setTool('pen'); } },
    })))));
}

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
    endBtn = el('button', { class: 'add-page-end', html: icon('plus') + '<span>Add page</span>', onclick: () => addPageAtEnd() });
  }
  S.pagesEl.append(endBtn);
  updateCurrentPage();
  if (S.sel) positionSelection();
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
  renderChecks(id);
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
  if (S.selDrag && S.selDrag.page.id === id) return;
  if (S.sel && S.sel.pageId === id) S.sel = null;
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
  if (e.target.closest('.tabs, button, .sel-layer')) return;
  const wrap = e.target.closest('.page');
  if (!wrap) return;
  const page = S.pages.get(wrap.dataset.id);
  if (!page || !S.mounted.has(page.id)) return;
  e.preventDefault();
  try { S.pagesEl.setPointerCapture(e.pointerId); } catch {}
  const a = S.active = { id: e.pointerId, page, wrap, rect: wrap.getBoundingClientRect(), tool: prefs.tool, removed: [] };
  const first = pagePoint(e, a);
  if (a.tool === 'eraser') { eraseAt(first[0], first[1]); return; }
  if (a.tool === 'select') {
    clearSelection();
    a.lasso = first.slice();
    a.liveCtx = ink.prepCanvas(S.live, page, S.cssW);
    wrap.append(S.live);
    return;
  }
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
    if (a.tool === 'select') { a.lasso.push(x, y, 50); continue; }
    if (a.snapped) continue;
    const pts = a.stroke.pts;
    const lx = pts[pts.length - 3], ly = pts[pts.length - 2];
    if (Math.abs(x - lx) + Math.abs(y - ly) < 1) continue;
    pts.push(x, y, p);
    if (Math.hypot(x - a.anchor[0], y - a.anchor[1]) > 9) { a.anchor = [x, y]; armHold(); }
  }
  if (a.tool === 'pen' && !a.raf) a.raf = requestAnimationFrame(drawLive);
  if (a.tool === 'select' && !a.raf) a.raf = requestAnimationFrame(drawLasso);
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
  if (a.tool === 'select') { finishLasso(a); return; }
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

// ---------------------------------------------------------------- tick boxes on the owner's Canva pages
// Tap a printed box or circle (Pencil or finger) to tick it; tap again to clear it.
const TICK_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 12.8l4.6 4.7L19.6 6.4" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

function boxesFor(page) {
  return page && page.bg && page.bg.kind === 'template' ? CHECKBOXES[page.bg.id] : null;
}

function renderChecks(id) {
  const m = S.mounted.get(id);
  const page = S.pages.get(id);
  if (!m || !page) return;
  m.wrap.querySelector('.ticks')?.remove();
  const spec = boxesFor(page);
  if (!spec) return;
  const checks = page.checks || {};
  const pct = (v, total) => (v / total) * 100 + '%';
  const layer = el('div', { class: `ticks ${spec.shape}` }, spec.boxes.map(([x, y, w, h], i) => {
    const on = !!checks[i];
    // the tap target is a little bigger than the printed box so it's easy to hit
    const pad = Math.max(0, (88 - w) / 2);
    const b = el('button', {
      class: `tick ${on ? 'on' : ''}`, role: 'checkbox', 'aria-checked': String(on), 'aria-label': `Tick box ${i + 1}`,
      style: { left: pct(x - pad, page.w), top: pct(y - pad, page.h), width: pct(w + 2 * pad, page.w), height: pct(h + 2 * pad, page.h) },
      html: TICK_SVG,
      onclick: (e) => { e.stopPropagation(); toggleCheck(page, i); },
    });
    b.style.setProperty('--box', pct(w, w + 2 * pad)); // custom properties need setProperty
    return b;
  }));
  m.wrap.append(layer);
}

function toggleCheck(page, i) {
  const before = { ...(page.checks || {}) };
  const after = { ...before };
  if (after[i]) delete after[i]; else after[i] = 1;
  page.checks = after;
  pushUndo({ type: 'checks', changes: [{ pageId: page.id, before, after }] });
  renderChecks(page.id);
  markDirty(page.id, { ink: false });
}

function hasTicks(page) {
  return !!(page && page.checks && Object.keys(page.checks).length);
}

function uncheckAll(pages) {
  const changes = pages.filter(hasTicks).map((p) => ({ pageId: p.id, before: { ...p.checks }, after: {} }));
  if (!changes.length) return;
  for (const ch of changes) {
    const p = S.pages.get(ch.pageId);
    p.checks = {};
    renderChecks(p.id);
    markDirty(p.id, { ink: false });
  }
  pushUndo({ type: 'checks', changes });
  toast(changes.length > 1 ? `Unchecked boxes on ${changes.length} pages` : 'Unchecked all boxes');
}

// ---------------------------------------------------------------- select tool
// Circle ink with the lasso (or tap one stroke) to select it. Then drag the box to move it,
// drag a corner to resize it, or use the little bar to recolour or delete it.
const SEL_PAD = 12;

function selBox(strokes) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const s of strokes) {
    const b = strokeBox(s.pts);
    const r = s.s;
    minX = Math.min(minX, b.minX - r); minY = Math.min(minY, b.minY - r);
    maxX = Math.max(maxX, b.maxX + r); maxY = Math.max(maxY, b.maxY + r);
  }
  return { minX, minY, maxX, maxY };
}

function drawLasso() {
  const a = S && S.active;
  if (!a || !a.liveCtx) return;
  a.raf = 0;
  const ctx = a.liveCtx;
  ink.clear(ctx, a.page);
  const p = a.lasso;
  if (p.length < 6) return;
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  for (let i = 3; i < p.length; i += 3) ctx.lineTo(p[i], p[i + 1]);
  ctx.closePath();
  ctx.fillStyle = 'rgba(139,108,240,0.12)';
  ctx.fill();
  ctx.setLineDash([14, 10]);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#8b6cf0';
  ctx.stroke();
  ctx.setLineDash([]);
}

function finishLasso(a) {
  const page = a.page;
  const p = a.lasso;
  let len = 0;
  for (let i = 3; i < p.length; i += 3) len += Math.hypot(p[i] - p[i - 3], p[i + 1] - p[i - 2]);
  if (len < 24) {
    // a tap: pick the single stroke under the Pencil
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const st = page.strokes[i];
      if (distToStroke(p[0], p[1], st.pts) <= 18 + st.s) { setSelection(page, [st]); return; }
    }
    return;
  }
  setSelection(page, lassoSelect(p, page.strokes).map((i) => page.strokes[i]));
}

function clearSelection() {
  if (!S || !S.sel) return;
  S.sel.layer.remove();
  S.sel = null;
  S.selDrag = null;
}

function setSelection(page, strokes) {
  clearSelection();
  const m = S.mounted.get(page.id);
  if (!m || !strokes.length) return;
  const box = el('div', { class: 'sel-box', 'aria-label': 'Selection — drag to move' },
    ...['nw', 'ne', 'sw', 'se'].map((c) => el('div', { class: `sel-handle ${c}`, 'data-corner': c, 'aria-label': 'Drag to resize' })));
  const bar = el('div', { class: 'sel-bar' },
    ...ink.PALETTE.map((p) => el('button', {
      class: 'sel-color', 'aria-label': p.label, title: p.label, style: { background: ink.colorOf(p.c) },
      onclick: (e) => { e.stopPropagation(); recolorSelection(p.c); },
    })),
    el('button', { class: 'sel-del', 'aria-label': 'Delete selection', title: 'Delete', html: icon('trash', 20), onclick: (e) => { e.stopPropagation(); deleteSelection(); } }));
  const layer = el('div', { class: 'sel-layer' }, box, bar);
  m.wrap.append(layer);
  S.sel = { pageId: page.id, strokes, box: selBox(strokes), layer, boxEl: box, bar };
  box.addEventListener('pointerdown', onSelDown);
  box.addEventListener('pointermove', onSelMove);
  box.addEventListener('pointerup', onSelUp);
  box.addEventListener('pointercancel', onSelUp);
  positionSelection();
}

function positionSelection(box = S.sel && S.sel.box) {
  if (!S || !S.sel || !box) return;
  const page = S.pages.get(S.sel.pageId);
  const k = S.cssW / page.w; // page units → CSS pixels
  const L = (box.minX - SEL_PAD) * k, T = (box.minY - SEL_PAD) * k;
  const W = (box.maxX - box.minX + 2 * SEL_PAD) * k, H = (box.maxY - box.minY + 2 * SEL_PAD) * k;
  Object.assign(S.sel.boxEl.style, { left: L + 'px', top: T + 'px', width: W + 'px', height: H + 'px' });
  const bar = S.sel.bar;
  const bw = bar.offsetWidth || 320, bh = bar.offsetHeight || 46;
  let top = T - bh - 14;
  if (top < 6) top = T + H + 14;
  const pageH = (page.h * S.cssW) / page.w;
  if (top + bh > pageH - 6) top = Math.max(6, T + 10);
  const left = Math.max(6, Math.min(S.cssW - bw - 6, L + W / 2 - bw / 2));
  Object.assign(bar.style, { left: left + 'px', top: top + 'px' });
}

function transformPt(x, y, t) {
  return t.k !== 1 ? [t.ax + (x - t.ax) * t.k, t.ay + (y - t.ay) * t.k] : [x + t.dx, y + t.dy];
}

function transformStroke(s, t) {
  const pts = s.pts.slice();
  for (let i = 0; i < pts.length; i += 3) {
    const [x, y] = transformPt(pts[i], pts[i + 1], t);
    pts[i] = Math.round(x); pts[i + 1] = Math.round(y);
  }
  const { _box, ...rest } = s;
  const out = { ...rest, pts };
  if (t.k !== 1) out.s = Math.max(1.5, Math.min(80, Math.round(s.s * t.k * 100) / 100));
  return out;
}

function transformBox(b, t) {
  const [x1, y1] = transformPt(b.minX, b.minY, t);
  const [x2, y2] = transformPt(b.maxX, b.maxY, t);
  return { minX: Math.min(x1, x2), minY: Math.min(y1, y2), maxX: Math.max(x1, x2), maxY: Math.max(y1, y2) };
}

function onSelDown(e) {
  if (!S || !S.sel || S.selDrag) return;
  e.stopPropagation();
  e.preventDefault();
  const page = S.pages.get(S.sel.pageId);
  const m = S.mounted.get(page.id);
  if (!m) return;
  const rect = m.wrap.getBoundingClientRect();
  const toPage = (ev) => [((ev.clientX - rect.left) / rect.width) * page.w, ((ev.clientY - rect.top) / rect.height) * page.h];
  const [x, y] = toPage(e);
  const corner = e.target.dataset ? e.target.dataset.corner : null;
  const b = S.sel.box;
  const anchor = corner ? { x: corner.includes('w') ? b.maxX : b.minX, y: corner.includes('n') ? b.maxY : b.minY } : null;
  try { S.sel.boxEl.setPointerCapture(e.pointerId); } catch {}
  S.selDrag = { id: e.pointerId, page, toPage, start: [x, y], corner, anchor,
    startDist: anchor ? Math.max(1, Math.hypot(x - anchor.x, y - anchor.y)) : 0, t: { k: 1, dx: 0, dy: 0 } };
  // draw everything except the selection, and the selection on the live layer while it moves
  ink.renderStrokes(m.canvas.getContext('2d'), page, new Set(S.sel.strokes));
  ink.prepCanvas(S.live, page, S.cssW);
  m.wrap.append(S.live);
  drawSelDrag();
}

function onSelMove(e) {
  const d = S && S.selDrag;
  if (!d || e.pointerId !== d.id) return;
  e.preventDefault();
  e.stopPropagation();
  const [x, y] = d.toPage(e);
  if (d.corner) {
    const k = Math.max(0.15, Math.min(8, Math.hypot(x - d.anchor.x, y - d.anchor.y) / d.startDist));
    d.t = { k, ax: d.anchor.x, ay: d.anchor.y, dx: 0, dy: 0 };
  } else {
    d.t = { k: 1, dx: x - d.start[0], dy: y - d.start[1] };
  }
  if (!d.raf) d.raf = requestAnimationFrame(drawSelDrag);
}

function drawSelDrag() {
  const d = S && S.selDrag;
  if (!d || !S.sel) return;
  d.raf = 0;
  const ctx = S.live.getContext('2d');
  ink.clear(ctx, d.page);
  for (const s of S.sel.strokes) ink.drawStroke(ctx, transformStroke(s, d.t), { live: true });
  positionSelection(transformBox(S.sel.box, d.t));
}

function onSelUp(e) {
  const d = S && S.selDrag;
  if (!d || e.pointerId !== d.id) return;
  e.stopPropagation();
  cancelAnimationFrame(d.raf);
  S.selDrag = null;
  S.live.remove();
  const changed = d.t.k !== 1 || Math.abs(d.t.dx) + Math.abs(d.t.dy) >= 1;
  if (!changed) { renderInk(d.page.id); positionSelection(); return; }
  replaceSelection(S.sel.strokes.map((s) => transformStroke(s, d.t)));
}

function swapStrokes(page, from, to) {
  for (let i = 0; i < from.length; i++) {
    const j = page.strokes.indexOf(from[i]);
    if (j >= 0) page.strokes[j] = to[i];
  }
}

function replaceSelection(newStrokes) {
  const page = S.pages.get(S.sel.pageId);
  const before = S.sel.strokes;
  swapStrokes(page, before, newStrokes);
  pushUndo({ type: 'replace', pageId: page.id, before, after: newStrokes });
  S.sel.strokes = newStrokes;
  S.sel.box = selBox(newStrokes);
  renderInk(page.id);
  positionSelection();
  markDirty(page.id);
}

function recolorSelection(c) {
  if (!S.sel) return;
  replaceSelection(S.sel.strokes.map(({ _box, ...s }) => ({ ...s, c })));
}

function deleteSelection() {
  if (!S.sel) return;
  const page = S.pages.get(S.sel.pageId);
  const gone = new Set(S.sel.strokes);
  const items = page.strokes.map((s, i) => ({ s, i })).filter((x) => gone.has(x.s));
  page.strokes = page.strokes.filter((s) => !gone.has(s));
  pushUndo({ type: 'remove', pageId: page.id, items });
  clearSelection();
  renderInk(page.id);
  markDirty(page.id);
}

// ---------------------------------------------------------------- undo / redo
function pushUndo(action) {
  S.undo.push(action);
  if (S.undo.length > 200) S.undo.shift();
  S.redo = [];
  refreshToolUI();
}

function apply(action, reverse) {
  if (action.type === 'checks') {
    for (const ch of action.changes) {
      const p = S.pages.get(ch.pageId);
      if (!p) continue;
      p.checks = { ...(reverse ? ch.before : ch.after) };
      renderChecks(p.id);
      markDirty(p.id, { ink: false });
    }
    if (action.changes[0] && !S.mounted.has(action.changes[0].pageId)) scrollToPage(action.changes[0].pageId);
    return;
  }
  const page = S.pages.get(action.pageId);
  if (!page) return;
  clearSelection();
  if (action.type === 'replace') {
    // moved / resized / recoloured strokes swap places with their earlier versions
    if (reverse) swapStrokes(page, action.after, action.before);
    else swapStrokes(page, action.before, action.after);
  } else if (action.type === 'add') {
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
function markDirty(pageId, { ink = true } = {}) {
  S.dirty.add(pageId);
  if (ink) S.inkDirty.add(pageId);
  clearTimeout(S.saveTimer);
  S.saveTimer = setTimeout(flushSave, 700);
}

async function flushSave() {
  if (!S) return;
  clearTimeout(S.saveTimer);
  const ids = [...S.dirty];
  const inkIds = new Set(S.inkDirty);
  S.dirty.clear();
  S.inkDirty.clear();
  for (const id of ids) {
    const page = S.pages.get(id);
    if (!page) continue;
    await store.savePage(page, { ink: inkIds.has(id) });
  }
  if (ids.length) await store.saveItem(S.note);
}

// ---------------------------------------------------------------- pages: add / change / delete
// Planners read best newest-first, so new pages go on top by default there.
const NEWEST_FIRST = new Set(['lemon-week', 'weekly']);

/** Should new pages go before the current page? Remembered per note once chosen. */
function placeBefore() {
  if (typeof S.note.addBefore === 'boolean') return S.note.addBefore;
  const first = S.pages.get(S.note.pageIds[0]);
  return !!(first && first.bg.kind === 'template' && NEWEST_FIRST.has(first.bg.id));
}

/** A blank page in the same style (and tab section) as `ref`, or in style `bg`. */
async function newPageLike(ref, bg) {
  const useBg = bg || (ref && ref.bg.kind !== 'image' ? ref.bg : S.note.lastBg) || tpl.DEFAULT_BG;
  const size = await store.sizeForBg(useBg);
  return store.newPage(S.note.id, useBg, size, ref && ref.tabId ? { tabId: ref.tabId } : {});
}

/** Put new pages right before or right after the page you're looking at. */
async function insertNearCurrent(pages, before) {
  if (!S || !pages.length) return;
  const idx = Math.max(0, S.note.pageIds.indexOf(S.currentPageId));
  const cur = S.pages.get(S.note.pageIds[idx]);
  if (cur && cur.tabId) pages.forEach((p) => { p.tabId = cur.tabId; });
  for (const p of pages) S.pages.set(p.id, p);
  await store.insertPages(S.note, pages, before ? idx - 1 : idx);
  layoutPages();
  scrollToPage(pages[0].id);
}

/** The "Add page" button at the very bottom of a note. */
async function addPageAtEnd() {
  const last = S.pages.get(S.note.pageIds[S.note.pageIds.length - 1]);
  const page = await newPageLike(last);
  S.pages.set(page.id, page);
  await store.insertPages(S.note, [page]);
  layoutPages();
  scrollToPage(page.id);
}

/** The + button: choose before/after (remembered per note), then what kind of page. */
function addPagePopover(anchor) {
  let before = placeBefore();
  const seg = el('div', { class: 'place-seg', role: 'radiogroup', 'aria-label': 'Where the new page goes' });
  const option = (value, label, iconName) => el('button', {
    class: `place-opt ${before === value ? 'on' : ''}`, role: 'radio', 'aria-checked': String(before === value),
    html: icon(iconName, 18) + `<span>${label}</span>`,
    onclick: () => { before = value; S.note.addBefore = value; store.saveItem(S.note); draw(); },
  });
  const draw = () => seg.replaceChildren(option(true, 'Before', 'up'), option(false, 'After', 'down'));
  draw();
  const go = async (kind) => {
    pop.close();
    const cur = S.pages.get(S.currentPageId);
    if (kind === 'same') return insertNearCurrent([await newPageLike(cur)], before);
    if (kind === 'style') {
      const bg = await pickTemplate({ title: 'New page' });
      if (bg) await insertNearCurrent([await newPageLike(cur, bg)], before);
      return;
    }
    const pages = await importAsPages(S.note.id);
    if (pages && pages.length) await insertNearCurrent(pages, before);
  };
  const pop = popover(anchor, el('div', { class: 'pop-body add-pop' },
    el('strong', {}, 'Add a page'),
    seg,
    el('button', { class: 'btn primary', onclick: () => go('same') }, 'Same style as this page'),
    el('div', { class: 'row-2' },
      el('button', { class: 'btn', onclick: () => go('style') }, 'Different style…'),
      el('button', { class: 'btn', onclick: () => go('scan') }, 'Scan or photo…')),
    el('p', { class: 'muted small' }, 'Before or after the page you\'re on. Remembered for this note.')));
}

async function moreMenu() {
  const idx = S.note.pageIds.indexOf(S.currentPageId);
  const choice = await actions('This page & note', [
    hasTicks(S.pages.get(S.currentPageId)) ? { label: 'Uncheck all boxes on this page', value: 'uncheck-page', icon: 'check' } : null,
    S.note.pageIds.filter((pid) => hasTicks(S.pages.get(pid))).length > 1 ? { label: 'Uncheck all boxes in this note', value: 'uncheck-note', icon: 'check' } : null,
    { label: "Change this page's template…", value: 'change', icon: 'page' },
    S.note.tabs ? { label: 'Edit tabs…', value: 'tabs', icon: 'notes' } : null,
    idx > 0 ? { label: 'Move page up', value: 'up' } : null,
    idx < S.note.pageIds.length - 1 ? { label: 'Move page down', value: 'down' } : null,
    { label: 'Delete this page', value: 'delete', icon: 'trash', danger: true },
  ]);
  if (!choice || !S) return;
  const page = S.pages.get(S.currentPageId);
  if (choice === 'uncheck-page') { uncheckAll([page]); return; }
  if (choice === 'uncheck-note') { uncheckAll(S.note.pageIds.map((pid) => S.pages.get(pid)).filter(Boolean)); return; }
  if (choice === 'change') {
    const bg = await pickTemplate({ title: "This page's template" });
    if (bg && page) {
      page.bg = bg;
      if (!page.strokes.length) Object.assign(page, await store.sizeForBg(bg));
      S.note.lastBg = bg;
      await store.savePage(page);
      await store.saveItem(S.note);
      layoutPages();
      setBackground(page.id);
      renderChecks(page.id);
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
