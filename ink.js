// ink.js — handwriting pages for Apple Pencil (and finger, if you want).
//
// Strokes are stored as vectors in "page units": every page is 1000 units wide,
// so handwriting rescales cleanly when the iPad rotates. Points are packed into
// Uint16Arrays of [x*4, y*4, pressure*1000] triples to keep storage small.

export const INK_W = 1000;
export const INK_DEFAULT_H = 760;
export const INK_MAX_H = 4000;
export const GROW_STEP = 400;
export const PAPER_GAP = 44;           // ruled-line spacing in page units
const PT = 4;                          // coordinate precision: 1/4 unit
const MAX_CANVAS_PX = 9e6;             // per-canvas pixel budget (Safari caps canvas memory)

export const PEN_COLORS = {
  ink:    { light: '#1f2328', dark: '#ecebe8', name: 'Black' },
  blue:   { light: '#1f5fd1', dark: '#7aa7ff', name: 'Blue' },
  red:    { light: '#c92a2a', dark: '#ff8787', name: 'Red' },
  green:  { light: '#2b8a3e', dark: '#69db7c', name: 'Green' },
  purple: { light: '#7048e8', dark: '#b197fc', name: 'Purple' },
};
export const HL_COLORS = {
  yellow: { light: 'rgba(255, 208, 0, 0.40)',  dark: 'rgba(255, 214, 10, 0.34)', swatch: '#ffd43b', name: 'Yellow' },
  pink:   { light: 'rgba(255, 92, 170, 0.30)', dark: 'rgba(255, 110, 180, 0.34)', swatch: '#f783ac', name: 'Pink' },
  green:  { light: 'rgba(64, 192, 87, 0.32)',  dark: 'rgba(105, 219, 124, 0.32)', swatch: '#69db7c', name: 'Green' },
  blue:   { light: 'rgba(51, 154, 240, 0.30)', dark: 'rgba(116, 192, 252, 0.32)', swatch: '#74c0fc', name: 'Blue' },
};
export const SIZES = { s: 2.2, m: 3.6, l: 6.5 };
const ERASER_R = { s: 8, m: 16, l: 30 };

export function isDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function strokeColor(s, dark) {
  const table = s.tool === 'hl' ? HL_COLORS : PEN_COLORS;
  const c = table[s.color] || (s.tool === 'hl' ? HL_COLORS.yellow : PEN_COLORS.ink);
  return dark ? c.dark : c.light;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Draws one stroke. `s.pts` can be a Uint16Array or a plain array (while drawing).
export function drawStroke(g, s, dark) {
  const p = s.pts;
  const n = Math.floor(p.length / 3);
  if (!n) return;
  const base = SIZES[s.size] || SIZES.m;
  const X = (i) => p[i * 3] / PT;
  const Y = (i) => p[i * 3 + 1] / PT;
  const P = (i) => p[i * 3 + 2] / 1000;
  const color = strokeColor(s, dark);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.strokeStyle = color;
  g.fillStyle = color;

  if (s.tool === 'hl') {
    // One path at constant width so the translucent ink doesn't stack up on itself.
    g.lineWidth = base * 5;
    g.beginPath();
    g.moveTo(X(0), Y(0));
    if (n === 1) g.lineTo(X(0) + 0.1, Y(0));
    for (let i = 1; i < n - 1; i++) {
      g.quadraticCurveTo(X(i), Y(i), (X(i) + X(i + 1)) / 2, (Y(i) + Y(i + 1)) / 2);
    }
    if (n > 1) g.lineTo(X(n - 1), Y(n - 1));
    g.stroke();
    return;
  }

  // Pen: pressure-sensitive width, drawn as short smoothed segments.
  const w = (i) => base * (0.5 + P(i));
  if (n === 1) {
    g.beginPath();
    g.arc(X(0), Y(0), w(0) / 2, 0, Math.PI * 2);
    g.fill();
    return;
  }
  let sx = X(0), sy = Y(0);
  for (let i = 1; i < n - 1; i++) {
    const ex = (X(i) + X(i + 1)) / 2, ey = (Y(i) + Y(i + 1)) / 2;
    g.lineWidth = w(i);
    g.beginPath();
    g.moveTo(sx, sy);
    g.quadraticCurveTo(X(i), Y(i), ex, ey);
    g.stroke();
    sx = ex; sy = ey;
  }
  g.lineWidth = w(n - 1);
  g.beginPath();
  g.moveTo(sx, sy);
  g.lineTo(X(n - 1), Y(n - 1));
  g.stroke();
}

// ---------- geometry ----------
const bboxCache = new WeakMap();
function bbox(s) {
  let b = bboxCache.get(s);
  if (b) return b;
  const p = s.pts;
  b = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] / PT, y = p[i + 1] / PT;
    if (x < b.x0) b.x0 = x; if (x > b.x1) b.x1 = x;
    if (y < b.y0) b.y0 = y; if (y > b.y1) b.y1 = y;
  }
  bboxCache.set(s, b);
  return b;
}

export function contentBounds(block) {
  if (!block.strokes || !block.strokes.length) return null;
  const out = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  for (const s of block.strokes) {
    const b = bbox(s);
    out.x0 = Math.min(out.x0, b.x0); out.y0 = Math.min(out.y0, b.y0);
    out.x1 = Math.max(out.x1, b.x1); out.y1 = Math.max(out.y1, b.y1);
  }
  return out;
}

function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = clamp(t, 0, 1);
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
}

function hitStroke(s, x, y, r) {
  const b = bbox(s);
  const pad = r + (SIZES[s.size] || SIZES.m) * (s.tool === 'hl' ? 2.5 : 0.8);
  if (x < b.x0 - pad || x > b.x1 + pad || y < b.y0 - pad || y > b.y1 + pad) return false;
  const p = s.pts, n = p.length / 3;
  if (n === 1) return Math.hypot(p[0] / PT - x, p[1] / PT - y) <= pad;
  for (let i = 1; i < n; i++) {
    const j = i * 3, k = (i - 1) * 3;
    if (segDist(x, y, p[k] / PT, p[k + 1] / PT, p[j] / PT, p[j + 1] / PT) <= pad) return true;
  }
  return false;
}

// ---------- paper + image export ----------
function drawPaper(g, kind, w, h, dark) {
  if (!kind || kind === 'blank') return;
  g.save();
  g.strokeStyle = g.fillStyle = dark ? '#3a3833' : '#d3dfeb';
  g.lineWidth = 1.2;
  const gap = PAPER_GAP;
  if (kind === 'lined' || kind === 'grid') {
    for (let y = gap; y < h; y += gap) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
  }
  if (kind === 'grid') {
    for (let x = gap; x < w; x += gap) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, h); g.stroke(); }
  }
  if (kind === 'dots') {
    for (let y = gap; y < h; y += gap) for (let x = gap; x < w; x += gap) {
      g.beginPath(); g.arc(x, y, 2, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
}

// Full-resolution image of a handwriting page, trimmed below the last stroke.
export function renderInkImage(block, { scale = 1.5, dark = false } = {}) {
  const b = contentBounds(block);
  const h = Math.min(block.h, Math.max(240, (b ? b.y1 : 0) + 60));
  const c = document.createElement('canvas');
  c.width = Math.round(INK_W * scale);
  c.height = Math.round(h * scale);
  const g = c.getContext('2d');
  g.fillStyle = dark ? '#23211e' : '#fffef9';
  g.fillRect(0, 0, c.width, c.height);
  g.setTransform(scale, 0, 0, scale, 0, 0);
  drawPaper(g, block.paper, INK_W, h, dark);
  for (const s of block.strokes) drawStroke(g, s, dark);
  return c;
}

// Small preview for note cards: fits the writing's width, shows the top of the page.
export function renderThumb(block, w, h, dark) {
  const b = contentBounds(block);
  if (!b) return null;
  const pad = 24;
  const bw = b.x1 - b.x0 + pad * 2, bh = b.y1 - b.y0 + pad * 2;
  const k = Math.min(w / bw, 0.5);
  const dpr = 2;
  const c = document.createElement('canvas');
  c.width = w * dpr; c.height = h * dpr;
  const g = c.getContext('2d');
  const ox = Math.max(0, (w - bw * k) / 2);
  const oy = bh * k < h ? (h - bh * k) / 2 : 0;
  g.setTransform(k * dpr, 0, 0, k * dpr, (ox - (b.x0 - pad) * k) * dpr, (oy - (b.y0 - pad) * k) * dpr);
  for (const s of block.strokes) drawStroke(g, s, dark);
  return c;
}

// ---------- backup encoding ----------
export function u16ToB64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function b64ToU16(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Uint16Array(bytes.buffer, 0, bytes.length >> 1);
}

// ---------- the drawing surface ----------
// ctx: { tool(), settings, onChange(), onPenSeen(), onStrokeCut(), scroller() }
export class InkSurface {
  constructor(block, ctx) {
    this.block = block;
    this.ctx = ctx;
    this.el = document.createElement('div');
    this.el.className = 'ink-surface';
    this.el.dataset.paper = block.paper || 'lined';
    this.el.style.aspectRatio = `${INK_W} / ${block.h}`;
    this.base = document.createElement('canvas');
    this.live = document.createElement('canvas');
    this.base.className = 'ink-base';
    this.live.className = 'ink-live';
    this.el.append(this.base, this.live);
    this.undoStack = [];
    this.redoStack = [];
    this.cur = null;
    this.pointerId = null;
    this.pan = null;
    this.cssW = 0;
    this.bind();
    this.updateMode();
    this.ro = new ResizeObserver(() => this.layout());
    this.ro.observe(this.el);
  }

  layout(force = false) {
    const w = this.el.clientWidth;
    if (!w) return;
    if (!force && w === this.cssW && this.block.h === this.laidH) return;
    this.cssW = w;
    this.laidH = this.block.h;
    this.scale = w / INK_W;
    const cssH = Math.round(this.block.h * this.scale);
    const dpr = Math.min(window.devicePixelRatio || 1, Math.sqrt(MAX_CANVAS_PX / (w * cssH)));
    this.dpr = dpr;
    for (const c of [this.base, this.live]) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = w + 'px';
      c.style.height = cssH + 'px';
    }
    // Snap ruled-line spacing to whole screen pixels so lines stay crisp.
    const sdpr = window.devicePixelRatio || 1;
    this.el.style.setProperty('--gap', Math.max(4, Math.round(PAPER_GAP * this.scale * sdpr)) / sdpr + 'px');
    this.redraw();
    this.drawLive();
  }

  redraw() {
    if (!this.scale) return;
    const g = this.base.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.base.width, this.base.height);
    const k = this.dpr * this.scale;
    g.setTransform(k, 0, 0, k, 0, 0);
    const dark = isDark();
    for (const s of this.block.strokes) drawStroke(g, s, dark);
  }

  drawLive() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      const g = this.live.getContext('2d');
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, this.live.width, this.live.height);
      if (!this.scale || (!this.cur && !this.eraser)) return;
      const k = this.dpr * this.scale;
      g.setTransform(k, 0, 0, k, 0, 0);
      if (this.cur) drawStroke(g, this.cur, isDark());
      if (this.eraser) {
        g.beginPath();
        g.arc(this.eraser.x, this.eraser.y, this.eraser.r, 0, Math.PI * 2);
        g.lineWidth = 1.5 / this.scale;
        g.strokeStyle = isDark() ? 'rgba(255,255,255,.6)' : 'rgba(0,0,0,.45)';
        g.stroke();
      }
    });
  }

  // Finger-vs-Pencil behaviour. Pencil always writes. Fingers either write,
  // or scroll the page (natively, or via a manual fallback if Safari keeps
  // interrupting Pencil strokes).
  updateMode() {
    const st = this.ctx.settings;
    this.live.style.touchAction = st.fingerDraws || st.manualScroll ? 'none' : 'pan-y';
  }

  bind() {
    const L = this.live;
    L.addEventListener('pointerdown', (e) => this.down(e));
    L.addEventListener('pointermove', (e) => this.move(e));
    L.addEventListener('pointerup', (e) => this.up(e));
    L.addEventListener('pointercancel', (e) => this.cancel(e));
    const guard = (e) => {
      const st = this.ctx.settings;
      if (st.fingerDraws || st.manualScroll) { e.preventDefault(); return; }
      for (const t of e.touches) if (t.touchType === 'stylus') { e.preventDefault(); return; }
    };
    L.addEventListener('touchstart', guard, { passive: false });
    L.addEventListener('touchmove', guard, { passive: false });
    L.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  pos(ev, rect) {
    return {
      x: clamp((ev.clientX - rect.left) / this.scale, 0, INK_W),
      y: clamp((ev.clientY - rect.top) / this.scale, 0, INK_MAX_H),
    };
  }

  down(e) {
    const st = this.ctx.settings;
    if (e.pointerType === 'pen') this.ctx.onPenSeen();
    const canDraw = e.pointerType !== 'touch' || st.fingerDraws;
    if (!canDraw) {
      if (st.manualScroll && !this.pan) this.startPan(e);
      return; // otherwise let Safari scroll natively
    }
    if (this.pointerId !== null) {
      // A second finger while finger-writing means "scroll", not "write".
      if (e.pointerType === 'touch' && this.curType === 'touch') { this.abortStroke(); this.startPan(e); }
      return;
    }
    if (e.button > 0) return;
    e.preventDefault();
    this.stopMomentum();
    this.pointerId = e.pointerId;
    this.curType = e.pointerType;
    try { this.live.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    const t = this.ctx.tool();
    this.pushUndo();
    if (t.tool === 'eraser') {
      this.erasing = true;
      this.erased = false;
      this.eraseAt(e);
      return;
    }
    this.cur = {
      tool: t.tool === 'hl' ? 'hl' : 'pen',
      color: t.tool === 'hl' ? t.hlColor : t.penColor,
      size: t.size,
      pts: [],
    };
    this.addPoints(e);
    this.drawLive();
  }

  addPoints(e) {
    const rect = this.live.getBoundingClientRect();
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const list = evs && evs.length ? evs : [e];
    const a = this.cur.pts;
    for (const ev of list) {
      const { x, y } = this.pos(ev, rect);
      let p = 0.5;
      if (ev.pointerType === 'pen') p = ev.pressure > 0 ? ev.pressure : 0.3;
      const n = a.length;
      if (n >= 3) {
        const dx = x - a[n - 3] / PT, dy = y - a[n - 2] / PT;
        if (dx * dx + dy * dy < 0.4) continue;
      }
      a.push(Math.round(x * PT), Math.round(y * PT), Math.round(clamp(p, 0.05, 1) * 1000));
    }
  }

  move(e) {
    if (this.pan && e.pointerId === this.pan.id) { this.panMove(e); return; }
    if (e.pointerId !== this.pointerId) return;
    e.preventDefault();
    if (this.erasing) { this.eraseAt(e); return; }
    if (!this.cur) return;
    this.addPoints(e);
    this.drawLive();
  }

  up(e) {
    if (this.pan && e.pointerId === this.pan.id) { this.panEnd(e); return; }
    if (e.pointerId !== this.pointerId) return;
    this.finish();
  }

  cancel(e) {
    if (this.pan && e.pointerId === this.pan.id) { this.pan = null; return; }
    if (e.pointerId !== this.pointerId) return;
    const wasPen = this.curType === 'pen' && !this.erasing;
    this.finish(); // keep whatever was drawn so far
    const st = this.ctx.settings;
    if (wasPen && !st.fingerDraws && !st.manualScroll) this.ctx.onStrokeCut();
  }

  finish() {
    this.pointerId = null;
    if (this.erasing) {
      this.erasing = false;
      this.eraser = null;
      this.drawLive();
      if (this.erased) this.changed(); else this.undoStack.pop();
      return;
    }
    const s = this.cur;
    this.cur = null;
    if (!s || !s.pts.length) { this.undoStack.pop(); this.drawLive(); return; }
    s.pts = Uint16Array.from(s.pts);
    this.block.strokes.push(s);
    const g = this.base.getContext('2d');
    const k = this.dpr * this.scale;
    g.setTransform(k, 0, 0, k, 0, 0);
    drawStroke(g, s, isDark());
    this.drawLive();
    // Writing near the bottom? Add more paper automatically.
    if (bbox(s).y1 > this.block.h - 110 && this.block.h < INK_MAX_H) this.setHeight(this.block.h + GROW_STEP);
    this.changed();
  }

  abortStroke() {
    if (this.pointerId !== null) { try { this.live.releasePointerCapture(this.pointerId); } catch { /* ignore */ } }
    this.pointerId = null;
    if (this.cur || this.erasing) this.undoStack.pop();
    this.cur = null;
    this.erasing = false;
    this.eraser = null;
    this.drawLive();
  }

  eraseAt(e) {
    const rect = this.live.getBoundingClientRect();
    const r = ERASER_R[this.ctx.tool().size] || ERASER_R.m;
    const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : null;
    const list = evs && evs.length ? evs : [e];
    let changed = false;
    for (const ev of list) {
      const { x, y } = this.pos(ev, rect);
      this.eraser = { x, y, r };
      const kept = this.block.strokes.filter((s) => !hitStroke(s, x, y, r));
      if (kept.length !== this.block.strokes.length) { this.block.strokes = kept; changed = true; }
    }
    if (changed) { this.erased = true; this.redraw(); }
    this.drawLive();
  }

  // ---- manual scrolling (fallback mode, and two-finger scroll while finger-writing)
  startPan(e) {
    e.preventDefault();
    this.stopMomentum();
    const sc = this.ctx.scroller();
    this.pan = { id: e.pointerId, y0: e.clientY, top0: sc.scrollTop, hist: [{ t: e.timeStamp, y: e.clientY }] };
    try { this.live.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  }
  panMove(e) {
    e.preventDefault();
    const sc = this.ctx.scroller();
    sc.scrollTop = this.pan.top0 - (e.clientY - this.pan.y0);
    this.pan.hist.push({ t: e.timeStamp, y: e.clientY });
    if (this.pan.hist.length > 6) this.pan.hist.shift();
  }
  panEnd(e) {
    const hist = this.pan.hist;
    this.pan = null;
    const last = hist[hist.length - 1], first = hist[0];
    const dt = last.t - first.t;
    if (dt <= 0 || e.timeStamp - last.t > 80) return;
    let v = -(last.y - first.y) / dt; // px per ms, in scroll direction
    const sc = this.ctx.scroller();
    let prev = performance.now();
    const step = (now) => {
      const d = now - prev; prev = now;
      sc.scrollTop += v * d;
      v *= Math.pow(0.95, d / 16);
      if (Math.abs(v) > 0.02) this.momentum = requestAnimationFrame(step);
    };
    this.momentum = requestAnimationFrame(step);
  }
  stopMomentum() { if (this.momentum) cancelAnimationFrame(this.momentum); this.momentum = 0; }

  // ---- editing commands
  pushUndo() {
    this.undoStack.push(this.block.strokes.slice());
    if (this.undoStack.length > 80) this.undoStack.shift();
  }
  changed() { this.redoStack = []; this.ctx.onChange(); }
  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }
  undo() {
    if (!this.undoStack.length) return;
    this.redoStack.push(this.block.strokes.slice());
    this.block.strokes = this.undoStack.pop();
    this.redraw();
    this.ctx.onChange();
  }
  redo() {
    if (!this.redoStack.length) return;
    this.undoStack.push(this.block.strokes.slice());
    this.block.strokes = this.redoStack.pop();
    this.redraw();
    this.ctx.onChange();
  }
  clear() {
    if (!this.block.strokes.length) return;
    this.pushUndo();
    this.block.strokes = [];
    this.redraw();
    this.changed();
  }
  setHeight(h) {
    this.block.h = clamp(Math.round(h), 300, INK_MAX_H);
    this.el.style.aspectRatio = `${INK_W} / ${this.block.h}`;
    this.layout(true);
  }
  grow() {
    if (this.block.h >= INK_MAX_H) return false;
    this.setHeight(this.block.h + GROW_STEP);
    this.ctx.onChange();
    return true;
  }
  setPaper(kind) {
    this.block.paper = kind;
    this.el.dataset.paper = kind;
    this.ctx.onChange();
  }
  destroy() {
    this.ro.disconnect();
    this.stopMomentum();
    if (this.raf) cancelAnimationFrame(this.raf);
    // Free canvas memory right away (iPad Safari is stingy about it).
    for (const c of [this.base, this.live]) { c.width = 0; c.height = 0; }
  }
}
