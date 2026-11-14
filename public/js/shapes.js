// Geometry helpers: shape snapping ("draw and hold") and scratch-out detection.
// Points are flat arrays [x, y, p, x, y, p, ...] in page units.

export function toXY(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i += 3) out.push({ x: pts[i], y: pts[i + 1] });
  return out;
}

export function fromXY(list, p = 50) {
  const out = [];
  for (const q of list) out.push(Math.round(q.x), Math.round(q.y), p);
  return out;
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

function pathLength(P) {
  let L = 0;
  for (let i = 1; i < P.length; i++) L += dist(P[i - 1], P[i]);
  return L;
}

function bbox(P) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of P) {
    if (q.x < minX) minX = q.x; if (q.y < minY) minY = q.y;
    if (q.x > maxX) maxX = q.x; if (q.y > maxY) maxY = q.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function resample(P, n) {
  const L = pathLength(P);
  if (L === 0 || P.length < 2) return P.slice();
  const step = L / (n - 1);
  const out = [P[0]];
  let acc = 0;
  const pts = P.slice();
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (acc + d >= step && d > 0) {
      const t = (step - acc) / d;
      const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
      out.push(q);
      pts.splice(i, 0, q);
      acc = 0;
    } else acc += d;
  }
  while (out.length < n) out.push(P[P.length - 1]);
  return out.slice(0, n);
}

function perpDist(p, a, b) {
  const L = dist(a, b);
  if (L === 0) return dist(p, a);
  return Math.abs((b.x - a.x) * (a.y - p.y) - (a.x - p.x) * (b.y - a.y)) / L;
}

function rdp(P, eps) {
  if (P.length < 3) return P.slice();
  let maxD = 0, idx = 0;
  for (let i = 1; i < P.length - 1; i++) {
    const d = perpDist(P[i], P[0], P[P.length - 1]);
    if (d > maxD) { maxD = d; idx = i; }
  }
  if (maxD > eps) {
    const left = rdp(P.slice(0, idx + 1), eps);
    const right = rdp(P.slice(idx), eps);
    return left.slice(0, -1).concat(right);
  }
  return [P[0], P[P.length - 1]];
}

function segIntersect(a, b, c, d) {
  const o = (p, q, r) => Math.sign((q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y));
  return o(a, b, c) !== o(a, b, d) && o(c, d, a) !== o(c, d, b) && o(a, b, c) !== 0 && o(c, d, a) !== 0;
}

function selfIntersections(poly) {
  let n = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    for (let j = i + 2; j < poly.length - 1; j++) {
      if (i === 0 && j === poly.length - 2) continue;
      if (segIntersect(poly[i], poly[i + 1], poly[j], poly[j + 1])) n++;
    }
  }
  return n;
}

function centroid(P) {
  let x = 0, y = 0;
  for (const q of P) { x += q.x; y += q.y; }
  return { x: x / P.length, y: y / P.length };
}

function snapAngle(a, b) {
  // Nudge nearly-horizontal/vertical/45° lines onto the exact angle.
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const L = dist(a, b);
  const step = Math.PI / 4;
  const snapped = Math.round(ang / step) * step;
  if (Math.abs(snapped - ang) < (6 * Math.PI) / 180) return { x: a.x + Math.cos(snapped) * L, y: a.y + Math.sin(snapped) * L };
  return b;
}

function ellipsePoints(cx, cy, rx, ry, n = 72) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry });
  }
  return out;
}

function starPoints(c, R, r, rot, n = 5) {
  const out = [];
  for (let i = 0; i <= n * 2; i++) {
    const rad = i % 2 === 0 ? R : r;
    const t = rot + (i * Math.PI) / n;
    out.push({ x: c.x + Math.cos(t) * rad, y: c.y + Math.sin(t) * rad });
  }
  return out;
}

/**
 * Try to turn a hand-drawn stroke into a clean shape.
 * Returns {kind, points:[{x,y}]} or null when it doesn't look like a shape.
 */
export function recognize(pts) {
  const raw = toXY(pts);
  if (raw.length < 4) return null;
  const box = bbox(raw);
  const diag = Math.hypot(box.w, box.h);
  if (diag < 40) return null;
  const P = resample(raw, 96);
  const len = pathLength(P);
  const a = P[0], b = P[P.length - 1];
  const gap = dist(a, b);
  const closed = gap < Math.max(0.18 * len, 0) && gap < 0.4 * diag;

  if (!closed) {
    const straight = Math.max(...P.map((q) => perpDist(q, a, b)));
    if (straight < 0.055 * dist(a, b) + 3) return { kind: 'line', points: [a, snapAngle(a, b)] };
    const poly = rdp(P, 0.06 * diag);
    if (poly.length <= 5 && poly.length >= 3) {
      // open polyline (like an L or a zig): straighten each segment
      const ok = poly.every((q, i) => i === 0 || dist(poly[i - 1], q) > 0.12 * diag);
      if (ok) return { kind: 'polyline', points: poly };
    }
    return null;
  }

  // Closed shapes. First, is it an ellipse?
  const c = { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
  const rx = box.w / 2, ry = box.h / 2;
  if (rx > 5 && ry > 5) {
    let err = 0;
    for (const q of P) err += Math.abs(Math.hypot((q.x - c.x) / rx, (q.y - c.y) / ry) - 1);
    err /= P.length;
    if (err < 0.085) {
      if (Math.abs(rx - ry) / Math.max(rx, ry) < 0.14) {
        const r = (rx + ry) / 2;
        return { kind: 'circle', points: ellipsePoints(c.x, c.y, r, r) };
      }
      return { kind: 'ellipse', points: ellipsePoints(c.x, c.y, rx, ry) };
    }
  }

  // Polygons. Close the path and simplify to its corners.
  const closedP = P.concat([P[0]]);
  let poly = rdp(closedP, 0.075 * diag);
  if (dist(poly[0], poly[poly.length - 1]) < 0.15 * diag) poly = poly.slice(0, -1);
  const corners = poly.length;
  const crossings = selfIntersections(closedP.filter((_, i) => i % 3 === 0));

  // One-stroke 5-point star (pentagram): 5 tips and lots of crossings.
  if (corners >= 5 && corners <= 6 && crossings >= 3) {
    const tips = poly.slice(0, 5);
    const ctr = centroid(tips);
    const R = tips.reduce((s, q) => s + dist(q, ctr), 0) / tips.length;
    const top = tips.reduce((m, q) => (q.y < m.y ? q : m), tips[0]);
    const rot = Math.atan2(top.y - ctr.y, top.x - ctr.x);
    const pts5 = Array.from({ length: 5 }, (_, i) => ({ x: ctr.x + Math.cos(rot + (i * 2 * Math.PI) / 5) * R, y: ctr.y + Math.sin(rot + (i * 2 * Math.PI) / 5) * R }));
    const order = [0, 2, 4, 1, 3, 0].map((i) => pts5[i]);
    return { kind: 'star', points: order };
  }
  // Outline star: ~10 corners alternating far/near from the centre.
  if (corners >= 9 && corners <= 11) {
    const ctr = centroid(poly);
    const radii = poly.map((q) => dist(q, ctr));
    const sorted = radii.slice().sort((x, y) => x - y);
    const inner = sorted.slice(0, Math.floor(sorted.length / 2));
    const outer = sorted.slice(Math.ceil(sorted.length / 2));
    const r = inner.reduce((s, v) => s + v, 0) / inner.length;
    const R = outer.reduce((s, v) => s + v, 0) / outer.length;
    if (R > r * 1.5) {
      const top = poly.reduce((m, q) => (q.y < m.y ? q : m), poly[0]);
      return { kind: 'star', points: starPoints(ctr, R, r, Math.atan2(top.y - ctr.y, top.x - ctr.x)) };
    }
  }
  if (corners === 3) return { kind: 'triangle', points: poly.concat([poly[0]]) };
  if (corners === 4) {
    const axis = poly.every((q, i) => {
      const n = poly[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(n.y - q.y, n.x - q.x)) % (Math.PI / 2);
      return Math.min(ang, Math.PI / 2 - ang) < (14 * Math.PI) / 180;
    });
    if (axis) {
      const bb = bbox(poly);
      const rect = [{ x: bb.minX, y: bb.minY }, { x: bb.maxX, y: bb.minY }, { x: bb.maxX, y: bb.maxY }, { x: bb.minX, y: bb.maxY }];
      return { kind: 'rectangle', points: rect.concat([rect[0]]) };
    }
    return { kind: 'quad', points: poly.concat([poly[0]]) };
  }
  if (corners >= 5 && corners <= 8) return { kind: 'polygon', points: poly.concat([poly[0]]) };
  return null;
}

// ---------- scratch-out ----------

/** Does this stroke look like a back-and-forth scribble (a scratch-out)? */
export function looksLikeScratch(pts) {
  const P = toXY(pts);
  if (P.length < 12) return false;
  const c = centroid(P);
  let sxx = 0, syy = 0, sxy = 0;
  for (const q of P) { const dx = q.x - c.x, dy = q.y - c.y; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy); // principal axis
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const s = P.map((q) => (q.x - c.x) * ux + (q.y - c.y) * uy);
  const range = Math.max(...s) - Math.min(...s);
  if (range < 24) return false;
  // Count direction reversals along the main axis that travel a decent distance.
  const T = 0.3 * range;
  let reversals = 0, dir = 0, hi = s[0], lo = s[0];
  for (let i = 1; i < s.length; i++) {
    const v = s[i];
    if (dir === 0) {
      hi = Math.max(hi, v); lo = Math.min(lo, v);
      if (hi - v > T) { dir = -1; lo = v; } else if (v - lo > T) { dir = 1; hi = v; }
    } else if (dir === 1) {
      if (v > hi) hi = v; else if (hi - v > T) { reversals++; dir = -1; lo = v; }
    } else if (v < lo) lo = v; else if (v - lo > T) { reversals++; dir = 1; hi = v; }
  }
  return reversals >= 3 && pathLength(P) > 3.2 * range;
}

function convexHull(P) {
  const pts = P.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  upper.pop(); lower.pop();
  return lower.concat(upper);
}

export function inPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Which existing strokes does this scribble cover? Returns indexes. */
export function scratchTargets(scratchPts, strokes) {
  const S = toXY(scratchPts);
  const hull = convexHull(S);
  const hb = bbox(S);
  const hullArea = Math.max(1, hb.w * hb.h);
  const hits = [];
  strokes.forEach((st, idx) => {
    const P = toXY(st.pts);
    const sb = bbox(P);
    if (sb.maxX < hb.minX - 10 || sb.minX > hb.maxX + 10 || sb.maxY < hb.minY - 10 || sb.minY > hb.maxY + 10) return;
    let inside = 0;
    for (const q of P) if (inPoly(q, hull)) inside++;
    const frac = inside / P.length;
    let crosses = false;
    outer: for (let i = 1; i < P.length; i += 1) {
      for (let j = 1; j < S.length; j += 1) {
        if (segIntersect(P[i - 1], P[i], S[j - 1], S[j])) { crosses = true; break outer; }
      }
    }
    const small = sb.w * sb.h <= 4 * hullArea;
    if (frac >= 0.5 || (crosses && (small || frac >= 0.3))) hits.push(idx);
  });
  return hits;
}

/** Shortest distance from point to a stroke polyline (for the eraser). */
export function distToStroke(x, y, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const ax = pts[i], ay = pts[i + 1];
    if (i + 3 >= pts.length) { best = Math.min(best, Math.hypot(x - ax, y - ay)); break; }
    const bx = pts[i + 3], by = pts[i + 4];
    const dx = bx - ax, dy = by - ay;
    const L2 = dx * dx + dy * dy;
    let t = L2 ? ((x - ax) * dx + (y - ay) * dy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return best;
}

export function strokeBox(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < pts.length; i += 3) {
    const x = pts[i], y = pts[i + 1];
    if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Indexes of strokes that are mostly (half or more) inside a lasso loop. */
export function lassoSelect(lassoPts, strokes) {
  const L = toXY(lassoPts);
  if (L.length < 3) return [];
  const out = [];
  strokes.forEach((st, idx) => {
    let inside = 0, n = 0;
    for (let i = 0; i < st.pts.length; i += 3) { n++; if (inPoly({ x: st.pts[i], y: st.pts[i + 1] }, L)) inside++; }
    if (n && inside / n >= 0.5) out.push(idx);
  });
  return out;
}
