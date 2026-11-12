// App start-up and switching between the notes list and the editor.
import * as db from './db.js';
import * as sync from './sync.js';
import * as store from './store.js';
import { showLibrary, hideLibrary, updateStatus } from './library.js';
import { openEditor, isOpen } from './editor.js';
import { openSettings } from './settings.js';
import { toast } from './ui.js';

async function goLibrary() {
  hideLibrary();
  await showLibrary({ openNote, openSettings, syncStatus: sync.statusText });
}

async function openNote(id, pageId) {
  hideLibrary();
  await openEditor(id, { pageId, onClose: goLibrary });
}

async function boot() {
  try {
    await db.askPersistent();
    await store.pageSize();
    await sync.init();
    sync.onStatus(updateStatus);
    store.bus.addEventListener('remote-changed', () => { if (!isOpen()) goLibrary(); });
    await goLibrary();
  } catch (err) {
    console.error(err);
    document.getElementById('app').textContent = 'Something went wrong starting up: ' + err.message;
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }
  if (!navigator.standalone && /iPad|Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1 && !(await db.getMeta('installHintShown'))) {
    toast('Tip: tap the Share button → "Add to Home Screen" to install Brain Dump.', 7000);
    db.setMeta('installHintShown', true);
  }
}

boot();
