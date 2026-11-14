// Small UI helpers: element builder, sheets, dialogs, toasts, icons.

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v === true) node.setAttribute(k, '');
    else node.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === undefined || c === null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

// Simple line icons (24×24, currentColor)
const P = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  pen: '<path d="M4 20l4-1 11-11-3-3L5 16l-1 4z"/><path d="M14 6l3 3"/>',
  eraser: '<path d="M8 20h12"/><path d="M5 15l9-9 5 5-8 8H8l-3-3z"/><path d="M10 10l5 5"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-4"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  folder: '<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"/>',
  note: '<path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  notes: '<path d="M7 3h10v18H7z"/><path d="M4 6v12M10 8h4M10 12h4"/>',
  chevron: '<path d="M9 6l6 6-6 6"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  scan: '<path d="M4 8V5a1 1 0 011-1h3M16 4h3a1 1 0 011 1v3M20 16v3a1 1 0 01-1 1h-3M8 20H5a1 1 0 01-1-1v-3"/><path d="M7 12h10"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
  cloud: '<path d="M7 18h10a4 4 0 00.5-8 6 6 0 00-11.3 1.8A3.2 3.2 0 007 18z"/>',
  check: '<path d="M5 12l5 5 9-10"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  moon: '<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/>',
  restore: '<path d="M4 12a8 8 0 108-8 8 8 0 00-6 2.7"/><path d="M4 4v4h4"/>',
  page: '<rect x="5" y="3" width="14" height="18" rx="2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  lasso: '<path d="M6.5 14.2C4.4 13.3 3 11.8 3 10c0-3.3 4-6 9-6s9 2.7 9 6-4 6-9 6c-1 0-2-.1-2.9-.3"/><path d="M9.1 15.7c.4 1.5-.3 3-1.8 3.3-1.3.3-2.4-.6-2.4-1.8 0-1.4 1.4-2.2 2.8-1.7"/><path d="M6.2 18.8 5 21.5"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
};

export function icon(name, size = 22) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

export function iconBtn(name, label, onclick, extra = {}) {
  return el('button', { class: 'icon-btn', 'aria-label': label, title: label, html: icon(name), onclick, ...extra });
}

// ---------- overlays ----------
let layerCount = 0;

/** Bottom/centre sheet. Returns {close, body}. */
export function sheet({ title, content, wide = false, onClose } = {}) {
  layerCount++;
  const body = el('div', { class: 'sheet-body' });
  if (content) body.append(content);
  const panel = el('div', { class: `sheet ${wide ? 'wide' : ''}`, role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'sheet-head' },
      el('h2', {}, title || ''),
      iconBtn('close', 'Close', () => close())),
    body);
  const scrim = el('div', { class: 'scrim', onclick: (e) => { if (e.target === scrim) close(); } }, panel);
  document.body.append(scrim);
  requestAnimationFrame(() => scrim.classList.add('open'));
  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    layerCount--;
    scrim.classList.remove('open');
    setTimeout(() => scrim.remove(), 180);
    onClose && onClose();
  }
  return { close, body, panel };
}

/** Popover anchored under a button. */
export function popover(anchor, content, { onClose } = {}) {
  const r = anchor.getBoundingClientRect();
  const pop = el('div', { class: 'popover' }, content);
  const scrim = el('div', { class: 'scrim clear', onpointerdown: (e) => { if (e.target === scrim) close(); } }, pop);
  document.body.append(scrim);
  const pw = Math.min(320, window.innerWidth - 16);
  pop.style.width = pw + 'px';
  pop.style.left = Math.max(8, Math.min(window.innerWidth - pw - 8, r.left + r.width / 2 - pw / 2)) + 'px';
  pop.style.top = r.bottom + 8 + 'px';
  requestAnimationFrame(() => scrim.classList.add('open'));
  function close() { scrim.remove(); onClose && onClose(); }
  return { close, pop };
}

/** List of actions; resolves with the chosen action's value (or null). */
export function actions(title, items) {
  return new Promise((resolve) => {
    let chosen = null;
    const list = el('div', { class: 'action-list' },
      items.filter(Boolean).map((it) => el('button', {
        class: `action ${it.danger ? 'danger' : ''}`,
        html: (it.icon ? icon(it.icon) : '') + `<span>${escapeHTML(it.label)}</span>`,
        onclick: () => { chosen = it.value; s.close(); },
      })));
    const s = sheet({ title, content: list, onClose: () => resolve(chosen) });
  });
}

export function confirmBox(message, { ok = 'OK', danger = false } = {}) {
  return new Promise((resolve) => {
    let result = false;
    const content = el('div', {},
      el('p', { class: 'dialog-msg' }, message),
      el('div', { class: 'row-end' },
        el('button', { class: 'btn', onclick: () => s.close() }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => { result = true; s.close(); } }, ok)));
    const s = sheet({ title: '', content, onClose: () => resolve(result) });
  });
}

/** Text input dialog. Apple Pencil Scribble works in the field. */
export function promptBox(title, value = '', { ok = 'Save', placeholder = '', type = 'text' } = {}) {
  return new Promise((resolve) => {
    let result = null;
    const input = el('input', { class: 'text-input', type, value, placeholder, autocomplete: 'off', autocapitalize: 'sentences' });
    const submit = () => { result = input.value; s.close(); };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    const content = el('div', {}, input,
      el('div', { class: 'row-end' },
        el('button', { class: 'btn', onclick: () => s.close() }, 'Cancel'),
        el('button', { class: 'btn primary', onclick: submit }, ok)));
    const s = sheet({ title, content, onClose: () => resolve(result) });
    setTimeout(() => { input.focus(); input.select(); }, 60);
  });
}

let toastTimer;
export function toast(msg, ms = 2600) {
  let t = document.querySelector('.toast');
  if (!t) { t = el('div', { class: 'toast', role: 'status' }); document.body.append(t); }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

export function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function ago(ts) {
  if (!ts) return '';
  const d = Date.now() - ts;
  if (d < 60e3) return 'just now';
  if (d < 3600e3) return `${Math.round(d / 60e3)} min ago`;
  const date = new Date(ts);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const y = new Date(today); y.setDate(today.getDate() - 1);
  if (date.toDateString() === y.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined });
}

/** Ask for files (images / PDFs). Resolves with a FileList-like array. */
export function pickFiles(accept, multiple = true) {
  return new Promise((resolve) => {
    const input = el('input', { type: 'file', accept, multiple, style: { position: 'fixed', left: '-9999px' } });
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    document.body.append(input);
    input.click();
  });
}
