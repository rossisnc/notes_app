// Template picker: built-in pages + your own Canva templates + "Add your own".
import * as store from './store.js';
import * as tpl from './templates.js';
import { el, sheet, icon, confirmBox } from './ui.js';
import { importTemplate } from './importer.js';

export function pickTemplate({ title = 'Pick a page style' } = {}) {
  return new Promise(async (resolve) => {
    let chosen = null;
    const grid = el('div', { class: 'tpl-grid' });
    const s = sheet({ title, content: grid, wide: true, onClose: () => resolve(chosen) });
    const last = await store.pageSize();

    const tile = (name, url, bg, { dark = false } = {}) => el('button', {
      class: 'tpl-tile', 'aria-label': name,
      onclick: () => { chosen = bg; s.close(); },
    }, el('div', { class: `tpl-thumb ${dark ? 'dark' : ''}` }, el('img', { src: url, alt: '', loading: 'lazy' })), el('span', {}, name));

    const heading = (text) => el('h3', { class: 'tpl-group' }, text);
    let group = null;
    for (const t of tpl.builtinList()) {
      if (t.group !== group) {
        group = t.group;
        grid.append(heading(group === 'mine' ? 'My Canva pages' : 'Notebook with tabs'));
      }
      grid.append(tile(t.name, t.thumb || tpl.templateURL(t.id, last.w, last.h), { kind: 'template', id: t.id }, t));
    }
    const customs = await store.customTemplates();
    grid.append(heading(customs.length ? 'Added by you' : 'Add more'));
    for (const t of customs) {
      const url = await tpl.assetURL(t.assetId);
      grid.append(tile(t.name, url, { kind: 'custom', id: t.id }, t));
    }
    grid.append(el('button', {
      class: 'tpl-tile add',
      onclick: async () => {
        const t = await importTemplate();
        if (t) { chosen = { kind: 'custom', id: t.id }; s.close(); }
      },
    }, el('div', { class: 'tpl-thumb add-thumb', html: icon('plus', 34) + `<small>PNG, JPG or PDF<br>${last.w} × ${last.h} px</small>` }), el('span', {}, 'Add your own')));
  });
}

/** Settings list for removing custom templates. */
export async function manageTemplates(container) {
  container.replaceChildren();
  const list = await store.customTemplates();
  if (!list.length) { container.append(el('p', { class: 'muted small' }, 'No templates of your own yet.')); return; }
  for (const t of list) {
    const url = await tpl.assetURL(t.assetId);
    container.append(el('div', { class: 'tpl-row' },
      el('img', { src: url, alt: '' }),
      el('span', { class: 'grow' }, t.name),
      el('button', { class: 'btn small danger', onclick: async () => {
        if (await confirmBox(`Remove the "${t.name}" template? Pages already using it keep their look.`, { ok: 'Remove', danger: true })) {
          await store.deleteTemplate(t.id);
          manageTemplates(container);
        }
      } }, 'Remove')));
  }
}
