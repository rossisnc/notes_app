// Bringing in pictures and PDFs: scanned paper notes become pages; Canva designs become templates.
import * as store from './store.js';
import { pickFiles, promptBox, toast } from './ui.js';

const PAGE_W = 1640;
const MAX_BYTES = 1_400_000; // stays under the cloud backup's 2 MB-per-item limit once base64-encoded

function canvasToBlob(canvas, q) {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', q));
}

async function encode(canvas) {
  for (const q of [0.85, 0.72, 0.6, 0.48]) {
    const blob = await canvasToBlob(canvas, q);
    if (blob && blob.size <= MAX_BYTES) return blob;
  }
  // still too big: shrink and try again
  const c2 = document.createElement('canvas');
  c2.width = Math.round(canvas.width * 0.7); c2.height = Math.round(canvas.height * 0.7);
  c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
  return canvasToBlob(c2, 0.6);
}

function isDarkCanvas(canvas) {
  const s = document.createElement('canvas');
  s.width = 24; s.height = 24;
  const ctx = s.getContext('2d');
  ctx.drawImage(canvas, 0, 0, 24, 24);
  const d = ctx.getImageData(0, 0, 24, 24).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
  return sum / (d.length / 4) / 255 < 0.42;
}

async function canvasToAsset(canvas) {
  const blob = await encode(canvas);
  const dark = isDarkCanvas(canvas);
  const asset = await store.saveAsset({ blob, mime: 'image/jpeg', w: canvas.width, h: canvas.height });
  return { assetId: asset.id, w: PAGE_W, h: Math.round((PAGE_W * canvas.height) / canvas.width), dark };
}

async function imageFileToCanvas(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const scale = Math.min(1, PAGE_W / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, 0, 0, c.width, c.height);
    return c;
  } finally {
    URL.revokeObjectURL(url);
  }
}

let pdfjsPromise;
function loadPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import('../vendor/pdf.min.mjs').then((pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
      return pdfjs;
    });
  }
  return pdfjsPromise;
}

async function* pdfFileToCanvases(file, maxPages = Infinity) {
  const pdfjs = await loadPdfJs();
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const pg = await doc.getPage(i);
    const v1 = pg.getViewport({ scale: 1 });
    const vp = pg.getViewport({ scale: PAGE_W / v1.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, c.width, c.height);
    await pg.render({ canvasContext: ctx, viewport: vp }).promise;
    yield { canvas: c, index: i, total: n };
    pg.cleanup();
  }
  await doc.destroy();
}

const isPdf = (f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name);

/** Turn picked files into stored images. Returns [{assetId, w, h, dark}] in order. */
export async function filesToImages(files, { maxPdfPages = Infinity } = {}) {
  const out = [];
  for (const f of files) {
    try {
      if (isPdf(f)) {
        for await (const { canvas, index, total } of pdfFileToCanvases(f, maxPdfPages)) {
          toast(`Importing page ${index} of ${total}…`, 4000);
          out.push(await canvasToAsset(canvas));
          canvas.width = 0;
        }
      } else {
        toast(`Importing ${out.length + 1} of ${files.length}…`, 4000);
        const c = await imageFileToCanvas(f);
        out.push(await canvasToAsset(c));
        c.width = 0;
      }
    } catch (err) {
      console.error(err);
      toast(`Couldn't read ${f.name}`);
    }
  }
  return out;
}

const ACCEPT = 'image/*,application/pdf,.pdf';

/** Ask for files and return new (unsaved) pages for a note. */
export async function importAsPages(noteId) {
  const files = await pickFiles(ACCEPT, true);
  if (!files.length) return [];
  const images = await filesToImages(files);
  if (images.length) toast(`Added ${images.length} page${images.length > 1 ? 's' : ''}`);
  return images.map((img) => store.newPage(noteId, { kind: 'image', assetId: img.assetId }, { w: img.w, h: img.h }));
}

/** Ask for files and make a new note out of them. */
export async function importScansAsNote(parentId = null) {
  const files = await pickFiles(ACCEPT, true);
  if (!files.length) return null;
  const images = await filesToImages(files);
  if (!images.length) return null;
  const base = files.length === 1 ? files[0].name.replace(/\.[^.]+$/, '') : '';
  const title = base && !/^(IMG|image|scan)[_ -]?\d*/i.test(base) ? base : `Scan ${store.niceDate()}`;
  toast(`Imported ${images.length} page${images.length > 1 ? 's' : ''}`);
  return store.createNoteFromImages({ parentId, title, images });
}

/** Add a custom template from a PNG/JPG/PDF (first page). */
export async function importTemplate() {
  const files = await pickFiles(ACCEPT, false);
  if (!files.length) return null;
  const [img] = await filesToImages([files[0]], { maxPdfPages: 1 });
  if (!img) return null;
  const name = (await promptBox('Name this template', files[0].name.replace(/\.[^.]+$/, '').slice(0, 40))) || 'My template';
  return store.saveTemplate({ id: store.uid(), name: name.trim() || 'My template', assetId: img.assetId, w: img.w, h: img.h, dark: img.dark });
}
