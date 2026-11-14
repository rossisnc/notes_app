// Turning stored strokes into ink on a canvas.
// A stroke: {id, c:'k'|'w', s:size, pts:[x,y,pressure0-100,...], m?:true (mouse/no pressure), shape?:true}
import { getStroke } from '../vendor/perfect-freehand.mjs';

export const COLORS = { k: '#1c1b1f', w: '#f6f4f8' };
// The owner's ink colours: black, white + five picks. Strokes store 'k'/'w' or the hex itself.
export const PALETTE = [
  { c: 'k', label: 'Black' }, { c: 'w', label: 'White' },
  { c: '#3ddbe1', label: 'Aqua' }, { c: '#6ed144', label: 'Green' }, { c: '#bea1f7', label: 'Lavender' },
  { c: '#ffa1d5', label: 'Pink' }, { c: '#ff23aa', label: 'Hot pink' },
];
export const colorOf = (c) => COLORS[c] || (typeof c === 'string' && /^#[0-9a-f]{3,8}$/i.test(c) ? c : COLORS.k);
export const SIZES = [2.5, 5, 9]; // fine / medium / thick, in page units (page is 1640 wide)

const pathCache = new WeakMap();

function pathFromOutline(points) {
  if (!points.length) return new Path2D();
  const d = ['M', points[0][0].toFixed(1), points[0][1].toFixed(1), 'Q'];
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    d.push(x0.toFixed(1), y0.toFixed(1), ((x0 + x1) / 2).toFixed(1), ((y0 + y1) / 2).toFixed(1));
  }
  d.push('Z');
  return new Path2D(d.join(' '));
}

function freehandOutline(stroke, last = true) {
  const input = [];
  for (let i = 0; i < stroke.pts.length; i += 3) input.push([stroke.pts[i], stroke.pts[i + 1], stroke.pts[i + 2] / 100]);
  return getStroke(input, {
    size: stroke.s * 1.6,
    thinning: 0.5,
    smoothing: 0.55,
    streamline: 0.4,
    easing: (t) => Math.sqrt(t),
    simulatePressure: !!stroke.m,
    start: { taper: 0, cap: true },
    end: { taper: 0, cap: true },
    last,
  });
}

function shapePath(stroke) {
  const p = new Path2D();
  const pts = stroke.pts;
  p.moveTo(pts[0], pts[1]);
  for (let i = 3; i < pts.length; i += 3) p.lineTo(pts[i], pts[i + 1]);
  return p;
}

export function strokePath(stroke) {
  let p = pathCache.get(stroke);
  if (!p) {
    p = stroke.shape ? shapePath(stroke) : pathFromOutline(freehandOutline(stroke));
    pathCache.set(stroke, p);
  }
  return p;
}

export function drawStroke(ctx, stroke, { live = false } = {}) {
  const color = colorOf(stroke.c);
  if (stroke.shape) {
    ctx.strokeStyle = color;
    ctx.lineWidth = stroke.s * 1.1;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke(live ? shapePath(stroke) : strokePath(stroke));
  } else {
    ctx.fillStyle = color;
    ctx.fill(live ? pathFromOutline(freehandOutline(stroke, false)) : strokePath(stroke));
  }
}

/** Size a canvas for a page shown at `cssW` CSS pixels wide and get it ready to draw in page units. */
export function prepCanvas(canvas, page, cssW) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssH = (cssW * page.h) / page.w;
  const W = Math.round(cssW * dpr), H = Math.round(cssH * dpr);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(W / page.w, 0, 0, H / page.h, 0, 0);
  return ctx;
}

export function clear(ctx, page) {
  ctx.clearRect(0, 0, page.w, page.h);
}

export function renderStrokes(ctx, page, skip = null) {
  clear(ctx, page);
  for (const s of page.strokes) if (!skip || !skip.has(s)) drawStroke(ctx, s);
}
