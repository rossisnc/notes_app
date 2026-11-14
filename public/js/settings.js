// Settings: backup, handwriting search, your own templates.
import * as sync from './sync.js';
import * as store from './store.js';
import { el, sheet, toast } from './ui.js';
import { manageTemplates } from './picker.js';

export async function openSettings() {
  const body = el('div', { class: 'settings' });
  sheet({ title: 'Settings', content: body, wide: true });
  const size = await store.pageSize();

  // ---------- backup ----------
  const backup = el('section', { class: 'set-card' }, el('h3', {}, 'Cloud backup'));
  const drawBackup = async () => {
    backup.replaceChildren(el('h3', {}, 'Cloud backup'));
    if (!sync.isOn()) {
      const pw = el('input', { class: 'text-input', type: 'password', placeholder: 'Choose a backup password', autocomplete: 'new-password' });
      const go = el('button', { class: 'btn primary', onclick: async () => {
        if (pw.value.length < 8) { toast('Use at least 8 characters — a few words works well.'); return; }
        go.disabled = true;
        try { await sync.setPassword(pw.value); toast('Backup is on'); drawBackup(); drawOcr(); }
        catch (e) { toast(e.message); }
        go.disabled = false;
      } }, 'Turn on backup');
      backup.append(
        el('p', { class: 'muted' }, 'Copies every note to your private Cloudflare database whenever you have signal. If the iPad dies, nothing is lost — and you can open your notes on your Mac.'),
        el('p', { class: 'muted small' }, 'Pick a password you\'ll remember (e.g. three random words). You\'ll type it once on each device. It can\'t be recovered, so jot it somewhere safe.'),
        pw, el('div', { class: 'row-end' }, go));
    } else {
      const st = sync.statusText();
      backup.append(
        el('p', {}, st.text),
        el('div', { class: 'row-end' }, el('button', { class: 'btn', onclick: async () => { await sync.syncNow(); drawBackup(); toast(sync.statusText().text); } }, 'Back up now')));
    }
  };
  drawBackup();

  // ---------- handwriting search ----------
  const ocr = el('section', { class: 'set-card' });
  const drawOcr = async () => {
    ocr.replaceChildren(el('h3', {}, 'Search inside handwriting'));
    if (!sync.isOn()) { ocr.append(el('p', { class: 'muted' }, 'Turn on cloud backup first — handwriting is read on your backup server.')); return; }
    const server = await sync.serverStatus();
    if (!server || !server.authed) { ocr.append(el('p', { class: 'muted' }, "Can't reach the backup server right now. Try again when you have signal.")); return; }
    ocr.append(el('p', { class: 'muted' }, 'Claude reads each page a minute or two after you stop writing on it, so search can find words inside your handwriting and scans. Uses your own Claude API key (billed by Anthropic, separate from your Claude Pro plan).'));
    if (server.ocrKey) {
      ocr.append(el('p', {}, '✓ Claude API key saved on your backup server.'),
        el('div', { class: 'row-end' }, el('button', { class: 'btn small danger', onclick: async () => { await sync.saveServerSettings({ anthropicKey: '' }); drawOcr(); } }, 'Remove key')));
    } else {
      const key = el('input', { class: 'text-input', type: 'password', placeholder: 'Paste your Claude API key (starts with sk-ant-)', autocomplete: 'off' });
      ocr.append(key, el('div', { class: 'row-end' }, el('button', { class: 'btn primary', onclick: async () => {
        if (!key.value.trim().startsWith('sk-ant-')) { toast("That doesn't look like a Claude API key."); return; }
        try { await sync.saveServerSettings({ anthropicKey: key.value.trim() }); toast('Key saved'); drawOcr(); sync.readHandwriting(); }
        catch (e) { toast(e.message); }
      } }, 'Save key')));
    }
    const model = server.ocrModel || 'accurate';
    const opt = (value, title, note) => {
      const r = el('input', { type: 'radio', name: 'ocr-model', value, checked: model === value });
      r.addEventListener('change', async () => { await sync.saveServerSettings({ ocrModel: value }); toast('Saved'); });
      return el('label', { class: 'radio-row' }, r, el('span', {}, el('strong', {}, title), el('br'), el('small', { class: 'muted' }, note)));
    };
    ocr.append(el('div', { class: 'radio-group' },
      opt('accurate', 'Most accurate — Claude Opus 5.5', 'Best with messy handwriting. About 1–1.5¢ per page read.'),
      opt('budget', 'Budget — Claude Haiku 5.5', 'About 0.03¢ per page (roughly 100× cheaper). May miss more scribbles.')));
    const waiting = (await sync.pagesWaiting()).length;
    if (server.ocrKey) {
      ocr.append(el('div', { class: 'row-end' },
        el('span', { class: 'muted small grow' }, waiting ? `${waiting} page(s) waiting to be read` : 'All pages are searchable.'),
        el('button', { class: 'btn small', onclick: async () => { toast('Reading pages…'); const n = await sync.readHandwriting({ force: true }); toast(n ? `Read ${n} page(s)` : 'Nothing to read right now'); drawOcr(); } }, 'Read now')));
    }
  };
  drawOcr();

  // ---------- templates ----------
  const tplList = el('div', { class: 'tpl-manage' });
  const templates = el('section', { class: 'set-card' },
    el('h3', {}, 'Your own templates'),
    el('p', { class: 'muted' }, `Design a page in Canva at ${size.w} × ${size.h} px (custom size, portrait) — that's your iPad's exact screen shape. Download it as PNG or PDF, then tap "New note" → "Add your own".`),
    tplList);
  manageTemplates(tplList);

  // ---------- tips + about ----------
  const tips = el('section', { class: 'set-card' },
    el('h3', {}, 'Handy tricks'),
    el('ul', { class: 'tips' },
      el('li', {}, el('strong', {}, 'Erase: '), 'scribble back and forth over ink to delete it — or use the eraser.'),
      el('li', {}, el('strong', {}, 'Perfect shapes: '), 'draw a line, circle, rectangle, triangle or star and keep the pencil still for a moment at the end.'),
      el('li', {}, el('strong', {}, 'Select: '), 'tap the lasso, then circle ink (or tap one stroke). Drag the box to move it, drag a corner to resize, or tap a colour / the trash on the little bar.'),
      el('li', {}, el('strong', {}, 'Tick boxes: '), 'on the checklist pages and Lemon Week, tap a printed box or circle to tick it. ⋯ → "Uncheck all" resets a list for reuse.'),
      el('li', {}, el('strong', {}, 'Undo: '), 'tap with two fingers, or use the arrow button.'),
      el('li', {}, el('strong', {}, 'Scroll: '), 'use your finger — the Pencil only writes.'),
      el('li', {}, el('strong', {}, 'Tabs: '), 'in a Tabbed notebook, tap a tab to jump; press and hold to rename.')));
  const est = navigator.storage && navigator.storage.estimate ? await navigator.storage.estimate().catch(() => null) : null;
  const about = el('section', { class: 'set-card' }, el('h3', {}, 'About'),
    el('p', { class: 'muted small' }, `Brain Dump · page size ${size.w}×${size.h}` + (est ? ` · using ${(est.usage / 1e6).toFixed(1)} MB on this device` : '')));

  body.append(backup, ocr, templates, tips, about);
}
