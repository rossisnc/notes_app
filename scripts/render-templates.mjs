// Dev helper: renders every built-in template to PNG so they can be eyeballed.
import { chromium } from 'playwright';
import { readFileSync, mkdirSync } from 'node:fs';
const out = process.argv[2] || 'template-previews';
mkdirSync(out, { recursive: true });
// templates.js imports browser-only modules; load a copy with those imports stubbed out
const src = readFileSync(new URL('../public/js/templates.js', import.meta.url), 'utf8')
  .replace(/^import .*$/gm, '').replace(/^/, 'const store = {}, db = {};\n');
const mod = await import('data:text/javascript,' + encodeURIComponent(src));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1640, height: 2360 } });
for (const id of mod.BUILTIN_IDS) {
  const svg = mod.templateSVG(id, 1640, 2360, {});
  await page.setContent(`<body style="margin:0">${svg}</body>`);
  await page.screenshot({ path: `${out}/${id}.png` });
  console.log('rendered', id);
}
await browser.close();
