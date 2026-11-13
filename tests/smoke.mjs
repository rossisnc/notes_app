// End-to-end smoke test against a running `npm run dev` server (iPad-sized browser).
// Usage: node tests/smoke.mjs [baseURL] [screenshotDir]
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:8787';
const SHOTS = process.argv[3] || 'test-results';
mkdirSync(SHOTS, { recursive: true });

const results = [];
const check = (name, ok, extra = '') => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 820, height: 1180 }, deviceScaleFactor: 1, hasTouch: false });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto(BASE);
await page.waitForSelector('.library');
await page.screenshot({ path: `${SHOTS}/01-empty-library.png` });
check('library loads', true);

// --- make a folder + sub-folder
async function prompt(text) {
  await page.waitForSelector('.sheet .text-input');
  await page.fill('.sheet .text-input', text);
  await page.click('.sheet .btn.primary');
  await page.waitForTimeout(250);
}
await page.click('text=New folder');
await prompt('Business ideas');
await page.click('.row:has-text("Business ideas") .row-more');
await page.click('.action:has-text("New sub-folder")');
await prompt('Etsy');
check('folder + sub-folder', await page.locator('.row:has-text("Etsy")').count() === 1);

// --- new note with the lined template
async function newNoteWith(templateName) {
  await page.click('text=New note');
  await page.waitForSelector('.tpl-grid');
  await page.click(`.tpl-tile[aria-label="${templateName}"]`);
  await page.waitForSelector('.editor .page canvas.ink');
  await page.waitForTimeout(300);
}
await newNoteWith('Lined');
check('editor opens', await page.locator('.editor').count() === 1);

async function pageBox(i = 0) { return page.locator('.page').nth(i).boundingBox(); }
async function draw(points, { hold = 0 } = {}) {
  await page.mouse.move(points[0][0], points[0][1]);
  await page.mouse.down();
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 2 });
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
  await page.waitForTimeout(120);
}
const strokeCount = () => page.evaluate(async () => {
  const req = indexedDB.open('braindump');
  const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
  const pages = await new Promise((r) => { const q = db.transaction('pages').objectStore('pages').getAll(); q.onsuccess = () => r(q.result); });
  return pages.reduce((n, p) => n + (p.strokes || []).length, 0);
});

const b = await pageBox();
// write a "word" (a wiggle)
const word = [];
for (let i = 0; i <= 40; i++) word.push([b.x + 120 + i * 5, b.y + 240 + Math.sin(i / 2) * 12]);
await draw(word);
const word2 = word.map(([x, y]) => [x + 260, y]);
await draw(word2);
await page.waitForTimeout(900);
check('pen writes strokes', (await strokeCount()) === 2, `count=${await strokeCount()}`);

// scratch out the second word
const scratch = [];
for (let k = 0; k < 6; k++) { scratch.push([b.x + 375, b.y + 230 + (k % 2) * 8]); scratch.push([b.x + 590, b.y + 236 + (k % 2) * 8]); }
await draw(scratch);
await page.waitForTimeout(900);
check('scratch-out erases', (await strokeCount()) === 1, `count=${await strokeCount()}`);

// undo brings it back, redo removes again
await page.click('[aria-label="Undo"]');
await page.waitForTimeout(900);
check('undo restores', (await strokeCount()) === 2);
await page.click('[aria-label="Redo"]');
await page.waitForTimeout(900);
check('redo re-applies', (await strokeCount()) === 1);

// draw a wobbly circle and hold → snaps to a circle
const circle = [];
for (let i = 0; i <= 60; i++) { const t = (i / 60) * Math.PI * 2; circle.push([b.x + 250 + Math.cos(t) * (80 + Math.sin(t * 5) * 4), b.y + 520 + Math.sin(t) * (78 + Math.cos(t * 3) * 4)]); }
await draw(circle, { hold: 800 });
// wobbly rectangle
const rect = [];
const R = [[b.x + 420, b.y + 450], [b.x + 640, b.y + 455], [b.x + 636, b.y + 600], [b.x + 418, b.y + 596], [b.x + 421, b.y + 452]];
for (let s = 0; s < 4; s++) for (let i = 0; i < 12; i++) { const t = i / 12; rect.push([R[s][0] + (R[s + 1][0] - R[s][0]) * t + Math.random() * 3, R[s][1] + (R[s + 1][1] - R[s][1]) * t + Math.random() * 3]); }
rect.push(R[4]);
await draw(rect, { hold: 800 });
// star (pentagram in one stroke)
const star = [];
for (let k = 0; k <= 5; k++) { const a = -Math.PI / 2 + (k * 4 * Math.PI) / 5; star.push([b.x + 250 + Math.cos(a) * 90, b.y + 800 + Math.sin(a) * 90]); }
const starPts = [];
for (let s = 0; s < 5; s++) for (let i = 0; i < 10; i++) { const t = i / 10; starPts.push([star[s][0] + (star[s + 1][0] - star[s][0]) * t, star[s][1] + (star[s + 1][1] - star[s][1]) * t]); }
starPts.push(star[5]);
await draw(starPts, { hold: 800 });
// a straight-ish line
const ln = [];
for (let i = 0; i <= 30; i++) ln.push([b.x + 420 + i * 8, b.y + 800 + Math.sin(i) * 2]);
await draw(ln, { hold: 800 });
await page.waitForTimeout(900);
const shapes = await page.evaluate(async () => {
  const req = indexedDB.open('braindump');
  const db = await new Promise((r) => { req.onsuccess = () => r(req.result); });
  const pages = await new Promise((r) => { const q = db.transaction('pages').objectStore('pages').getAll(); q.onsuccess = () => r(q.result); });
  return pages.flatMap((p) => p.strokes).filter((s) => s.shape).map((s) => s.pts.length / 3);
});
check('shapes snap (circle, rectangle, star, line)', shapes.length === 4, `snapped=${JSON.stringify(shapes)}`);
await page.screenshot({ path: `${SHOTS}/02-editor-ink.png` });

// eraser tool
await page.click('[aria-label="Eraser"]');
await draw([[b.x + 420, b.y + 800], [b.x + 520, b.y + 802]]);
await page.waitForTimeout(900);
check('eraser removes a stroke', (await strokeCount()) === 4, `count=${await strokeCount()}`);
await page.click('[aria-label="Pen"]');

// brightness + dark paper
await page.click('[aria-label="Page brightness"]');
await page.locator('.popover input[type=range]').fill('60');
await page.locator('.popover input[type=checkbox]').check();
await page.screenshot({ path: `${SHOTS}/03-dark-paper.png` });
await page.mouse.click(5, 1170);
const dark = await page.evaluate(() => getComputedStyle(document.querySelector('.page')).filter);
check('dark paper + dim applied', dark.includes('invert') && dark.includes('0.6'), dark);
await page.click('[aria-label="Page brightness"]');
await page.locator('.popover input[type=checkbox]').uncheck();
await page.locator('.popover input[type=range]').fill('100');
await page.mouse.click(5, 1170);

// add page, rename note
await page.click('[aria-label="Add page"]');
await page.waitForTimeout(500);
check('add page', await page.locator('.page').count() === 2);
await page.fill('.title-input', 'Grocery list');
await page.press('.title-input', 'Enter');
await page.waitForTimeout(300);
await page.click('[aria-label="Back to notes"]');
await page.waitForSelector('.library');
check('note listed with new title', await page.locator('.row:has-text("Grocery list")').count() === 1);

// tabbed notebook
await newNoteWith('Tabbed notebook');
const tabs = await page.locator('.page').first().locator('.tab').count();
check('tabbed notebook has 6 tabs + 6 pages', tabs === 6 && (await page.locator('.page').count()) === 6, `tabs=${tabs}`);
await page.locator('.page').first().locator('.tab').nth(3).click();
await page.waitForTimeout(900);
const num = await page.textContent('.page-num');
check('tab jumps to its section', /Page 4 of 6/.test(num), num);
await page.screenshot({ path: `${SHOTS}/04-tabbed.png` });
await page.click('[aria-label="Back to notes"]');

// other templates render
for (const name of ['Weekly planner', 'Four lists', 'Lavender', 'Dark night']) {
  await newNoteWith(name);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${SHOTS}/05-${name.replace(/\s+/g, '-').toLowerCase()}.png` });
  await page.click('[aria-label="Back to notes"]');
  await page.waitForSelector('.library');
}

// the owner's Canva pages are in the picker and load as page backgrounds
await page.click('text=New note');
await page.waitForSelector('.tpl-grid');
const canvaTiles = await page.locator('.tpl-tile[aria-label^="Lined · "], .tpl-tile[aria-label="Lemon Week"], .tpl-tile[aria-label="Blocks"]').count();
await page.screenshot({ path: `${SHOTS}/09-picker.png` });
await page.click('.tpl-tile[aria-label="Lemon Week"]');
await page.waitForSelector('.editor .page img.bg');
await page.waitForFunction(() => { const i = document.querySelector('.page img.bg'); return i && i.complete && i.naturalWidth > 0; });
const lemon = await page.evaluate(() => { const i = document.querySelector('.page img.bg'); return { src: i.getAttribute('src'), w: i.naturalWidth }; });
check('Canva pages in picker and load (8 tiles checked)', canvaTiles === 8 && lemon.src === '/templates/lemon-week.png' && lemon.w === 1640, JSON.stringify({ canvaTiles, ...lemon }));
await page.screenshot({ path: `${SHOTS}/10-lemon.png` });
await page.click('[aria-label="Back to notes"]');
await page.waitForSelector('.library');
await newNoteWith('Lined · Black');
const blackDark = await page.evaluate(() => document.querySelector('.page').classList.contains('is-dark'));
check('black Canva page is treated as a dark page', blackDark);
await page.click('[aria-label="Back to notes"]');
await page.waitForSelector('.library');

// move "Grocery list" into Business ideas › Etsy, then search
await page.click('.row:has-text("Grocery list") .row-more');
await page.click('.action:has-text("Move to")');
await page.click('.move-row:has-text("Etsy")');
await page.waitForTimeout(400);
await page.fill('.search-input', 'grocery');
await page.waitForTimeout(500);
const res = await page.locator('.result').first().textContent();
check('search finds note with folder path', res.includes('Grocery list') && res.includes('Business ideas › Etsy'), res);
await page.fill('.search-input', '');
await page.waitForTimeout(300);

// delete + restore
await page.click('.row:has-text("Dark night") .row-more').catch(() => {});
const darkRow = page.locator('.row', { hasText: 'note' }).first();
await darkRow.locator('.row-more').click();
await page.click('.action:has-text("Delete")');
await page.click('.sheet .btn.danger');
await page.waitForTimeout(400);
await page.click('.trash-head');
await page.waitForTimeout(200);
const restoreBtns = await page.locator('.row.deleted button').count();
check('deleted note shows in Recently deleted', restoreBtns === 1);
await page.locator('.row.deleted button').first().click();
await page.waitForTimeout(400);
check('restore works', (await page.locator('.row.deleted').count()) === 0);
await page.screenshot({ path: `${SHOTS}/06-library.png` });

// import scans: one photo + a 2-page PDF become one note with 3 pages
const pdfMaker = await ctx.newPage();
await pdfMaker.setContent('<h1 style="font:48px serif">Vet: call Tues re: shots</h1><div style="page-break-after:always"></div><h1>Page two</h1>');
const pdfBuf = await pdfMaker.pdf({ format: 'Letter' });
await pdfMaker.close();
const pngBuf = await page.screenshot();
const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('text=Import scans')]);
await chooser.setFiles([{ name: 'scan.png', mimeType: 'image/png', buffer: pngBuf }, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: pdfBuf }]);
await page.waitForSelector('.editor .page img.bg', { timeout: 30000 });
await page.waitForTimeout(1500);
check('import scans (photo + 2-page PDF) → 3 pages', (await page.locator('.page').count()) === 3, `pages=${await page.locator('.page').count()}`);
const sb = await pageBox();
await draw([[sb.x + 100, sb.y + 100], [sb.x + 300, sb.y + 140]]);
await page.screenshot({ path: `${SHOTS}/08-scan.png` });
await page.click('[aria-label="Back to notes"]');
await page.waitForSelector('.library');

// custom template from a "Canva" PNG
const tplPage = await ctx.newPage();
await tplPage.setViewportSize({ width: 820, height: 1180 });
await tplPage.setContent('<body style="margin:0;background:#fde2c8;font:bold 60px sans-serif;display:flex;align-items:start;justify-content:center;padding-top:40px">MY CANVA PAGE</body>');
const tplPng = await tplPage.screenshot();
await tplPage.close();
await page.click('text=New note');
await page.waitForSelector('.tpl-grid');
const [chooser2] = await Promise.all([page.waitForEvent('filechooser'), page.click('.tpl-tile.add')]);
await chooser2.setFiles([{ name: 'Peach page.png', mimeType: 'image/png', buffer: tplPng }]);
await prompt('Peach page');
await page.waitForSelector('.editor .page img.bg', { timeout: 15000 });
await page.waitForTimeout(800);
const bgSrc = await page.locator('.page img.bg').first().getAttribute('src');
check('custom template used for new note', bgSrc && bgSrc.startsWith('blob:'), bgSrc && bgSrc.slice(0, 20));
await page.click('[aria-label="Back to notes"]');
await page.waitForSelector('.library');
await page.click('text=New note');
await page.waitForSelector('.tpl-grid');
await page.waitForSelector('.tpl-tile[aria-label="Peach page"]', { timeout: 5000 }).catch(() => {});
check('custom template appears in picker', (await page.locator('.tpl-tile[aria-label="Peach page"]').count()) === 1);
await page.keyboard.press('Escape');
await page.click('.sheet-head [aria-label="Close"]');
await page.waitForTimeout(300);

// backup: set password, push, then a second "device" pulls everything
await page.click('.sync-status');
await page.waitForSelector('.settings');
await page.fill('.settings input[type=password]', 'purple spider waffle');
await page.click('.settings .btn.primary');
await page.waitForTimeout(2500);
await page.screenshot({ path: `${SHOTS}/07-settings.png` });
const status = await page.textContent('.settings .set-card');
check('backup turns on', /Backed up|Backing up/.test(status), status.replace(/\s+/g, ' ').slice(0, 80));
await page.keyboard.press('Escape');

const ctx2 = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const mac = await ctx2.newPage();
await mac.goto(BASE);
await mac.waitForSelector('.library');
await mac.click('.sync-status');
await mac.fill('.settings input[type=password]', 'purple spider waffle');
await mac.click('.settings .btn.primary');
await mac.waitForTimeout(3000);
await mac.keyboard.press('Escape');
await mac.reload();
await mac.waitForSelector('.library');
await mac.waitForTimeout(800);
const macRows = await mac.locator('.row').count();
check('second device restores notes from backup', macRows >= 3, `rows=${macRows}`);
const wrong = await (await mac.request.post(`${BASE}/api/setup`, { data: { token: 'x'.repeat(64) } })).status();
check('wrong password rejected once set', wrong === 409);

check('no console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
