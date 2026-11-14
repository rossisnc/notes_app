# Brain Dump

A handwriting-first notes app for iPad: one place for to-do lists, to-buy lists, meal plans, business ideas, gift lists, scanned paper notes and everything else that used to live in three different spiral notebooks.

It's an installable web app (no App Store). It runs offline on the iPad and backs up to your own Cloudflare account.

## What it does

- **Notes & folders list.** A simple list of folders, sub-folders, notes and sub-notes. Notes can sit outside folders too. Deleted items stay in "Recently deleted" for 30 days.
- **One pen.** Three thicknesses and 7 ink colours (black, white, aqua, green, lavender, pink, hot pink). The Pencil writes and your finger scrolls.
- **Tap-to-tick boxes.** On the checklist pages and Lemon Week, tap a printed box or circle to tick it; ⋯ → "Uncheck all" resets a list for reuse.
- **Select tool.** Lasso ink (or tap one stroke), then drag to move, drag a corner to resize, or tap a colour / trash on the bar above it.
- **Scratch-out erase.** Scribble back and forth over ink to delete it. There's also an eraser button.
- **Shape snapping.** Draw a line, circle, rectangle, triangle or star and hold the Pencil still for a moment.
- **Undo / redo.** Use the buttons, or tap with two fingers.
- **Templates.** Blank, Lined, Lavender, Dark night, Four lists, Weekly planner, Tabbed notebook (tap a tab to jump to that section), plus your own.
- **Your own templates.** Design in Canva at **1640 × 2360 px**, export PNG or PDF, then New note → Add your own.
- **Scans.** Import photos or PDFs of paper notes. Each page becomes a page you can write on.
- **Easy on the eyes.** Dark app, a page-brightness slider, and a "dark paper" switch.
- **Search.** Searches titles, plus the words inside your handwriting and scans once handwriting search is on (Claude reads each page in the background).
- **Backup.** Changes copy to a private database on your Cloudflare account whenever there's signal, protected by a password you choose.

## Install on the iPad

1. Open the app's web address in **Safari**.
2. Tap **Share** (square with an arrow), then **Add to Home Screen**, then **Add**.
3. Open **Brain Dump** from the home screen icon. From here on, always use the icon. Safari tabs keep separate storage.
4. In the app, tap the line at the bottom ("Backup is off") and choose a backup password.
5. Optional: in Settings, paste a Claude API key to turn on handwriting search.

## For developers / future me

- `public/`: the app (plain ES modules, no build step). `worker/index.js`: Cloudflare Worker (serves `public/`, plus `/api/*` for backup and handwriting reading). D1 database `brain-dump`.
- `npm run vendor` copies perfect-freehand and pdf.js into `public/vendor/`.
- `npm run dev` runs locally on :8787 (local D1). `npm test` is the end-to-end smoke test (needs the dev server running).
- Deploys happen automatically: every push runs `.github/workflows/deploy.yml`, which uses the `CLOUDFLARE_API_TOKEN` repository secret (Workers + D1 edit), creates the `brain-dump` D1 database if needed, and runs `wrangler deploy`. The D1 schema creates itself on first request.
- Bump `CACHE` in `public/sw.js` when you change the list of core files. Otherwise new versions reach the iPad on the next launch after a deploy.
