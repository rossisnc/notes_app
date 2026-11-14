# Catchall

One place for every note, list and scribble on your iPad. It replaces the pile of spiral notebooks and sticky notepads.

- **Handwriting pages** for Apple Pencil, with pen, highlighter, eraser, 5 colors, 3 sizes, undo/redo, and lined/grid/dot/blank paper. Once you use a Pencil, your finger scrolls instead of drawing.
- **Typing boxes.** Write in them with the Pencil and iPad converts it to text (Scribble), so it's searchable.
- **Checklists.** Paste a list and each line becomes an item. "Uncheck everything" lets you reuse a grocery list.
- **Mix all three in one note.** For example, a typed recipe with a handwritten sketch and an ingredient checklist.
- **Inbox** for quick jots. Sort them into notebooks later, or never: search finds them either way.
- **Notebooks** come preset: To-Do, To-Buy, Meal Planning, Recipes, Business Ideas, Travel Plans, Gift Ideas, Reminders, Remember This. Each one starts new notes the right way (checklist, recipe template, meal-plan template, and so on). Add, rename, reorder, or delete them.
- **Search** covers titles, typed text, and list items.
- **Pin** notes, give them a **date** (they show up under "Coming up"), **share** a note, **Trash** with Undo (30-day holding period).
- **Works offline.** No account, no subscription, no tracking.

## Where your notes live

On the iPad itself, in the app's private storage. Nothing goes to a server. That makes it private and offline, but **if the iPad is lost or reset, the notes go with it**. So:

> **Backup & settings → Back up now** → *Save to Files* → iCloud Drive. Do it weekly. The app nags you after 7 days.

**Restore from a backup file** merges: it adds missing notes and updates older copies, and never deletes anything. The same file also moves your notes to a new iPad.

## Install on the iPad

1. Open the app's web address in **Safari** on the iPad.
2. Tap **Share** (or the ••• menu → Share), then **Add to Home Screen**.
3. Open it from the Home Screen icon from now on, not from Safari tabs. That copy is the "real" app and keeps its own storage.

## Hosting

It's a plain static site: no build step, no server code. Any static host works:

- **Cloudflare Pages:** upload this folder (the `_headers` file keeps the offline cache fresh).
- **GitHub Pages:** Settings → Pages → deploy from this branch, root folder.

When you change any file, bump `VERSION` in `sw.js` so installed copies pick up the update on their next launch.

## Run locally

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

| File | What it does |
|---|---|
| `index.html` | Page shell |
| `styles.css` | Look and feel (follows light/dark mode) |
| `app.js` | Notebooks, notes, checklists, search, backup |
| `ink.js` | Handwriting engine (Pencil pressure, eraser, paper, image export) |
| `db.js` | On-device storage (IndexedDB) |
| `sw.js` | Offline support |
| `manifest.webmanifest`, `icons/` | Home Screen app name and icon |
