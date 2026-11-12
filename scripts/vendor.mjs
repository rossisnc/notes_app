// Copies the few third-party browser files the app needs into public/vendor.
import { copyFileSync, mkdirSync } from 'node:fs';
const out = new URL('../public/vendor/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = [
  ['perfect-freehand/dist/esm/index.mjs', 'perfect-freehand.mjs'],
  ['pdfjs-dist/build/pdf.min.mjs', 'pdf.min.mjs'],
  ['pdfjs-dist/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
];
for (const [from, to] of files) {
  copyFileSync(new URL(`../node_modules/${from}`, import.meta.url), new URL(to, out));
  console.log('vendored', to);
}
