// Built-in page templates, drawn as SVG at page size (1640 units wide).
// All artwork here is original; layouts were inspired by the pages the owner picked.
import * as store from './store.js';
import * as db from './db.js';

const HAND = "Noteworthy, 'Chalkboard SE', 'Bradley Hand', 'Segoe Print', 'Comic Sans MS', cursive";
const SANS = "-apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif";

const svg = (w, h, bg, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<rect width="${w}" height="${h}" fill="${bg}"/>${body}</svg>`;

const line = (x1, y1, x2, y2, color, width = 2.5, extra = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${width}" ${extra}/>`;

const dotted = (x1, y, x2, color = '#8f8f8f') =>
  line(x1, y, x2, y, color, 3.2, 'stroke-linecap="round" stroke-dasharray="0.1 11"');

function rules(x1, x2, yStart, yEnd, gap, draw) {
  let out = '';
  for (let y = yStart; y <= yEnd; y += gap) out += draw(x1, y, x2);
  return out;
}

function mix(hex, toward = '#ffffff', amount = 0.85) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const a = p(hex); const b = p(toward);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * amount).toString(16).padStart(2, '0')).join('');
}

// ---------- decorations ----------
function flower(cx, cy, scale = 1, flip = false) {
  const ink = '#4e3f8f';
  const petal = 'M0,0 C-30,-38 -24,-96 0,-120 C24,-96 30,-38 0,0Z';
  let petals = '';
  for (let k = 0; k < 5; k++) petals += `<path d="${petal}" transform="rotate(${k * 72})" fill="#cbc1e8" stroke="${ink}" stroke-width="3.5"/>`;
  for (let k = 0; k < 5; k++) petals += `<path d="M0,-22 L0,-78" transform="rotate(${k * 72 + 4})" stroke="${ink}" stroke-width="2" opacity=".55"/>`;
  const curls =
    `<path d="M38,52 C80,104 150,82 150,36 C150,8 118,4 112,26 C108,40 124,46 130,36" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<path d="M-52,40 C-110,70 -132,140 -100,176 C-82,196 -54,184 -62,162" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>` +
    `<path d="M-60,-70 C-100,-110 -150,-90 -146,-54 C-144,-34 -120,-30 -114,-46" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M70,128 C96,118 124,130 132,154 C108,160 82,152 70,128Z" fill="#b3a6dd" stroke="${ink}" stroke-width="2.5"/>` +
    `<circle cx="160" cy="112" r="7" fill="${ink}"/><circle cx="-128" cy="104" r="5" fill="${ink}"/>`;
  const center = `<circle r="15" fill="${ink}"/><circle r="6" fill="#e8e2f7"/>`;
  return `<g transform="translate(${cx},${cy}) scale(${flip ? -scale : scale},${scale})">${curls}${petals}${center}</g>`;
}

function web(cx, cy, sx, sy, R, color) {
  // A corner cobweb: threads fanning from the corner, sagging rings between them.
  const n = 6; const rings = 6;
  const angles = Array.from({ length: n + 1 }, (_, i) => (Math.PI / 2) * (i / n));
  const pt = (a, r) => [cx + sx * Math.cos(a) * r, cy + sy * Math.sin(a) * r];
  let d = '';
  for (const a of angles) { const [x, y] = pt(a, R); d += `M${cx},${cy} L${x.toFixed(1)},${y.toFixed(1)} `; }
  for (let k = 1; k <= rings; k++) {
    const r = (R * k) / (rings + 0.6);
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pt(angles[i], r); const [x2, y2] = pt(angles[i + 1], r);
      const [mx, my] = pt((angles[i] + angles[i + 1]) / 2, r * 0.86);
      d += `M${x1.toFixed(1)},${y1.toFixed(1)} Q${mx.toFixed(1)},${my.toFixed(1)} ${x2.toFixed(1)},${y2.toFixed(1)} `;
    }
  }
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.8" opacity=".8"/>`;
}

function spider(x, yTop, len, color) {
  const y = yTop + len;
  let legs = '';
  for (const s of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      const ly = y - 6 + i * 6;
      legs += `<path d="M${x},${ly} q${s * 16},${-10 + i * 4} ${s * 26},${4 + i * 7}" fill="none" stroke="${color}" stroke-width="2.4" stroke-linecap="round"/>`;
    }
  }
  return line(x, yTop, x, y - 10, color, 1.4) + legs +
    `<ellipse cx="${x}" cy="${y + 8}" rx="11" ry="15" fill="${color}"/><circle cx="${x}" cy="${y - 10}" r="7" fill="${color}"/>`;
}

function sparkle(x, y, r, color) {
  const q = r * 0.22;
  return `<path d="M${x},${y - r} Q${x + q},${y - q} ${x + r},${y} Q${x + q},${y + q} ${x},${y + r} Q${x - q},${y + q} ${x - r},${y} Q${x - q},${y - q} ${x},${y - r}Z" fill="${color}"/>`;
}

function leafSprig(x, y, flip, color) {
  const leaf = (lx, ly, rot, s = 1) =>
    `<path d="M0,0 C10,-22 10,-50 0,-70 C-10,-50 -10,-22 0,0Z" transform="translate(${lx},${ly}) rotate(${rot}) scale(${s})" fill="${color}" opacity=".85"/>`;
  return `<g transform="translate(${x},${y}) scale(${flip ? -1 : 1},1)">` +
    `<path d="M0,0 C60,-10 130,-6 220,-34" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round"/>` +
    leaf(30, -4, -30) + leaf(70, -6, 40, 0.9) + leaf(115, -10, -25, 1.05) + leaf(160, -18, 50, 0.85) + leaf(205, -30, -10, 0.9) +
    `<circle cx="248" cy="-44" r="6" fill="${color}"/></g>`;
}

// ---------- templates ----------
const T = {};

T.blank = { name: 'Blank', dark: false, draw: (w, h) => svg(w, h, '#fbfaf6', '') };

T.lined = {
  name: 'Lined', dark: false,
  draw(w, h) {
    const c = '#cdc7ba';
    const body =
      line(0, 92, w, 92, c, 2) +
      line(w * 0.24, 232, w * 0.76, 232, c, 2.5) +
      rules(0, w, 330, h - 80, 76, (x1, y, x2) => line(x1, y, x2, y, c, 2.2)) +
      line(124, 0, 124, h, c, 2) + line(w - 112, 0, w - 112, h, c, 2);
    return svg(w, h, '#faf8f1', body);
  },
};

T.lavender = {
  name: 'Lavender', dark: false,
  draw(w, h) {
    const ink = '#5b4c99';
    const body =
      `<rect x="${w * 0.32}" y="78" width="${w * 0.36}" height="150" rx="75" fill="#a99dcb"/>` +
      flower(150, 175, 0.95) + flower(w - 150, 175, 0.95, true) +
      rules(130, w - 130, 372, h - 100, 78, (x1, y, x2) => line(x1, y, x2, y, ink, 3)) +
      `<g opacity=".7">${flower(w - 120, h - 70, 0.42, true)}</g>`;
    return svg(w, h, '#dcd5ea', body);
  },
};

T.dark = {
  name: 'Dark night', dark: true,
  draw(w, h) {
    const silver = '#cfc7d8'; const lilac = '#9a86b6'; const lineC = '#4a4552';
    const midX = w / 2;
    let body =
      `<rect x="44" y="44" width="${w - 88}" height="${h - 88}" fill="none" stroke="#6f6778" stroke-width="2"/>` +
      `<rect x="60" y="60" width="${w - 120}" height="${h - 120}" fill="none" stroke="#38333f" stroke-width="1.5"/>` +
      web(60, 60, 1, 1, 300, silver) + web(w - 60, 60, -1, 1, 300, silver) +
      web(60, h - 60, 1, -1, 260, silver) + web(w - 60, h - 60, -1, -1, 260, silver) +
      spider(210, 60, 230, silver) + spider(w - 260, 60, 320, silver) +
      // crescent moon
      `<circle cx="${w - 400}" cy="200" r="54" fill="#ddd6e4"/><circle cx="${w - 376}" cy="184" r="50" fill="#141217"/>` +
      // top + bottom ornaments
      line(380, 112, midX - 70, 112, '#6f6778', 2) + line(midX + 70, 112, w - 380, 112, '#6f6778', 2) +
      sparkle(midX, 112, 34, silver) + sparkle(midX - 52, 112, 9, lilac) + sparkle(midX + 52, 112, 9, lilac) +
      line(380, h - 112, midX - 70, h - 112, '#6f6778', 2) + line(midX + 70, h - 112, w - 380, h - 112, '#6f6778', 2) +
      sparkle(midX, h - 112, 34, silver) + sparkle(midX - 52, h - 112, 9, lilac) + sparkle(midX + 52, h - 112, 9, lilac);
    for (const [x, y, r, c] of [[340, 210, 16, silver], [470, 300, 9, lilac], [w - 520, 300, 12, silver], [w - 300, 330, 8, lilac],
      [110, h * 0.42, 14, silver], [w - 110, h * 0.42, 14, silver], [110, h * 0.68, 9, lilac], [w - 110, h * 0.68, 9, lilac],
      [330, h - 220, 12, silver], [w - 330, h - 220, 12, silver]]) body += sparkle(x, y, r, c);
    // lilac flourishes along the sides
    for (const [x, s] of [[96, 1], [w - 96, -1]]) {
      for (const yy of [h * 0.3, h * 0.55, h * 0.8]) {
        body += `<path d="M${x},${yy} c${s * 34},-30 ${s * 30},-80 ${s * 4},-96 c${s * -16},-10 ${s * -34},4 ${s * -22},22" fill="none" stroke="${lilac}" stroke-width="3" stroke-linecap="round"/>`;
      }
    }
    body += rules(190, w - 190, 360, h - 250, 76, (x1, y, x2) => line(x1, y, x2, y, lineC, 2));
    return svg(w, h, '#141217', body);
  },
};

T.lists4 = {
  name: 'Four lists', dark: false,
  draw(w, h) {
    const m = 54; const gap = 30;
    const bw = (w - 2 * m - gap) / 2; const bh = (h - 2 * m - gap) / 2;
    const colors = [['#fbe3e7', '#f2c3cc'], ['#fdebe1', '#f7cdb5'], ['#fdf3d6', '#f2df9c'], ['#e1f1e7', '#b7dfc6']];
    let body = '';
    colors.forEach(([fill, head], i) => {
      const x = m + (i % 2) * (bw + gap); const y = m + Math.floor(i / 2) * (bh + gap);
      body += `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="36" fill="${fill}"/>` +
        `<rect x="${x + 22}" y="${y + 22}" width="${bw - 44}" height="108" rx="54" fill="${head}"/>` +
        rules(x + 42, x + bw - 42, y + 205, y + bh - 36, 72, (x1, yy, x2) => dotted(x1, yy, x2));
    });
    return svg(w, h, '#fffefb', body);
  },
};

T.weekly = {
  name: 'Weekly planner', dark: false,
  draw(w, h) {
    const light = '#bcd2b5'; const mid = '#99b892'; const dark = '#6a8c64'; const white = '#ffffff';
    const m = 60; const top = 290; const bottom = h - m;
    const rx = 1150; const rw = w - m - rx;
    const lx = m; const lw = 500; const mx = lx + lw + 40; const mw = rx - 40 - mx;
    const label = (x, y, text, size = 58, anchor = 'middle', color = white) =>
      `<text x="${x}" y="${y}" font-family="${HAND}" font-size="${size}" fill="${color}" text-anchor="${anchor}">${text}</text>`;
    const faint = (x1, y, x2) => line(x1, y, x2, y, white, 2.5, 'opacity=".55"');
    let body =
      label(w / 2, 200, 'weekly planner', 118, 'middle', dark) +
      leafSprig(70, 190, false, mid) + leafSprig(w - 70, 190, true, mid) +
      label(w - m - 6, 262, 'week of ____________', 40, 'end', dark);
    // important (top-left)
    const impTop = top; const impBot = top + 560;
    body += `<rect x="${lx}" y="${impTop}" width="${lw}" height="${impBot - impTop}" rx="10" fill="${light}"/>` + label(lx + lw / 2, impTop + 78, 'important');
    for (let i = 0; i < 6; i++) {
      const y = impTop + 170 + i * 66;
      body += `<circle cx="${lx + 40}" cy="${y - 14}" r="8" fill="none" stroke="${white}" stroke-width="3"/>` + faint(lx + 62, y, lx + lw - 30);
    }
    // notes (below important)
    const notesTop = impBot + 36; const notesBot = 1440;
    body += `<rect x="${lx}" y="${notesTop}" width="${lw}" height="${notesBot - notesTop}" rx="10" fill="${mid}"/>` + label(lx + lw / 2, notesTop + 78, 'notes') +
      rules(lx + 30, lx + lw - 30, notesTop + 150, notesBot - 30, 62, faint);
    // spiral rings
    for (let y = impTop + 30; y < notesBot - 10; y += 46) body += `<path d="M${lx + 10},${y} a14,14 0 1,0 -18,8" fill="none" stroke="${dark}" stroke-width="3"/>`;
    // to-do (middle, tall)
    body += `<rect x="${mx}" y="${top}" width="${mw}" height="${notesBot - top}" rx="10" fill="${mid}"/>` + label(mx + mw / 2, top + 82, 'to-do') +
      `<rect x="${mx - 22}" y="${top - 26}" width="110" height="44" fill="${light}" opacity=".85" transform="rotate(-38 ${mx + 30} ${top})"/>` +
      `<rect x="${mx + mw - 88}" y="${top - 26}" width="110" height="44" fill="${light}" opacity=".85" transform="rotate(38 ${mx + mw - 30} ${top})"/>`;
    for (let y = top + 170; y <= notesBot - 30; y += 62) {
      body += `<rect x="${mx + 24}" y="${y - 38}" width="32" height="32" rx="6" fill="none" stroke="${white}" stroke-width="3"/>` + faint(mx + 70, y, mx + mw - 24);
    }
    // reminders | important dates (bottom-left, fills to the bottom)
    const rTop = notesBot + 40;
    body += `<rect x="${lx}" y="${rTop}" width="${mx + mw - lx}" height="${bottom - rTop}" rx="10" fill="${light}"/>` +
      label(lx + (mx + mw - lx) * 0.25, rTop + 84, 'reminders') + label(lx + (mx + mw - lx) * 0.75, rTop + 84, 'important dates') +
      line((lx + mx + mw) / 2, rTop + 40, (lx + mx + mw) / 2, bottom - 30, white, 3, 'stroke-dasharray="18 14"') +
      rules(lx + 30, (lx + mx + mw) / 2 - 30, rTop + 160, bottom - 30, 62, faint) +
      rules((lx + mx + mw) / 2 + 30, mx + mw - 30, rTop + 160, bottom - 30, 62, faint) +
      `<rect x="${(lx + mx + mw) / 2 - 60}" y="${rTop - 22}" width="120" height="44" fill="${mid}" opacity=".9"/>`;
    // days (right column, fills to the bottom)
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
    const g = 20; const dh = (bottom - top - g * 6) / 7;
    days.forEach((d, i) => {
      const y = top + i * (dh + g);
      body += `<rect x="${rx}" y="${y}" width="${rw}" height="${dh}" rx="10" fill="${i % 2 ? light : mid}"/>` + label(rx + 18, y + 52, d, 44, 'start');
    });
    return svg(w, h, '#fbfcf8', body);
  },
};

T.tabbed = {
  name: 'Tabbed notebook', dark: false,
  draw(w, h, opts = {}) {
    const accent = opts.accent || '#f39a8a';
    const soft = mix(accent, '#ffffff', 0.86);
    const right = w - 160; // the last 130 units are covered by the live tabs
    let body =
      `<rect x="0" y="0" width="30" height="${h}" fill="${accent}"/>` +
      `<rect x="112" y="150" width="${(right - 112) * 0.62}" height="96" rx="20" fill="${soft}"/>` +
      `<text x="140" y="211" font-family="${SANS}" font-size="30" font-weight="700" fill="#666" letter-spacing="2">TITLE</text>` +
      `<rect x="${112 + (right - 112) * 0.62 + 26}" y="150" width="${(right - 112) * 0.38 - 26}" height="96" rx="20" fill="${soft}"/>` +
      `<text x="${112 + (right - 112) * 0.62 + 54}" y="211" font-family="${SANS}" font-size="30" font-weight="700" fill="#666" letter-spacing="2">DATE</text>`;
    'MTWTFSS'.split('').forEach((d, i) => {
      body += `<text x="${right - 410 + i * 66}" y="330" font-family="${SANS}" font-size="34" fill="#555" text-anchor="middle">${d}</text>`;
    });
    body += rules(100, right, 440, h - 110, 72, (x1, y, x2) => dotted(x1, y, x2, '#7a7a7a'));
    return svg(w, h, '#ffffff', body);
  },
};

export const BUILTIN_IDS = ['blank', 'lined', 'lavender', 'dark', 'lists4', 'weekly', 'tabbed'];
// Only these built-ins show in the picker (the owner's Canva pages cover the rest).
// Hidden ones still draw correctly on any page that already uses them.
const PICKER_BUILTINS = ['tabbed'];
export const DEFAULT_BG = { kind: 'template', id: 'lined-stone' };

// The owner's own Canva pages, shipped with the app in public/templates/ (1640 × 2360 PNGs).
const CANVA = [
  ['lined-stone', 'Lined · Stone'], ['lined-peach', 'Lined · Peach'], ['lined-lavender', 'Lined · Lavender'],
  ['lined-pink', 'Lined · Pink'], ['lined-black', 'Lined · Black', true], ['lined-charcoal', 'Lined · Charcoal', true],
  ['notes-checklist', 'Notes + Checklist'], ['checklists-bright', '4 Checklists · Bright'],
  ['checklists-soft', '4 Checklists · Soft'], ['lemon-week', 'Lemon Week'], ['five-boxes', 'Five Boxes'], ['blocks', 'Blocks'],
].map(([id, name, dark = false]) => ({ id, name, dark, file: `/templates/${id}.png`, thumb: `/templates/thumbs/${id}.jpg` }));
const CANVA_BY_ID = new Map(CANVA.map((t) => [t.id, t]));
export const CANVA_FILES = CANVA.flatMap((t) => [t.file, t.thumb]);

export function builtinList() {
  return [
    ...CANVA.map((t) => ({ id: t.id, name: t.name, dark: t.dark, kind: 'template', group: 'mine', thumb: t.thumb })),
    ...PICKER_BUILTINS.map((id) => ({ id, name: T[id].name, dark: T[id].dark, kind: 'template', group: 'builtin' })),
  ];
}

const urlCache = new Map();
export function templateURL(id, w, h, opts = {}) {
  const img = CANVA_BY_ID.get(id);
  if (img) return img.file;
  const t = T[id] || T.blank;
  const key = `${id}|${w}|${h}|${opts.accent || ''}`;
  if (!urlCache.has(key)) urlCache.set(key, 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(t.draw(w, h, opts)));
  return urlCache.get(key);
}

export function templateSVG(id, w, h, opts = {}) {
  return (T[id] || T.blank).draw(w, h, opts);
}

const blobURLs = new Map();
export async function assetURL(assetId) {
  if (blobURLs.has(assetId)) return blobURLs.get(assetId);
  const a = await store.getAsset(assetId);
  if (!a || !a.blob) return null;
  const url = URL.createObjectURL(a.blob);
  blobURLs.set(assetId, url);
  return url;
}

/** Resolve a page background description to an image URL. */
export async function bgURL(bg, page, opts = {}) {
  if (!bg) return templateURL('blank', page.w, page.h);
  if (bg.kind === 'template') return templateURL(bg.id, page.w, page.h, opts);
  if (bg.kind === 'image') return assetURL(bg.assetId);
  if (bg.kind === 'custom') {
    const t = await db.get('templates', bg.id); // even if removed from the list, old pages keep it
    return t ? assetURL(t.assetId) : templateURL('blank', page.w, page.h);
  }
  return templateURL('blank', page.w, page.h);
}

export async function isDarkBg(bg) {
  if (!bg) return false;
  if (bg.kind === 'template') return !!((CANVA_BY_ID.get(bg.id) || T[bg.id] || {}).dark);
  if (bg.kind === 'custom') {
    const t = await db.get('templates', bg.id);
    return !!(t && t.dark);
  }
  return false;
}
