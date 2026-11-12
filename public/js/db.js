// Tiny IndexedDB wrapper. Everything the app knows lives here on the iPad first.
// Stores:
//   items     folders + notes  {id, type, parentId, title, createdAt, updatedAt, deletedAt?, ...}
//   pages     one per note page {id, noteId, w, h, bg, strokes, inkAt, ocrText, ocrAt, updatedAt}
//   assets    image blobs (scans, custom templates) {id, blob, mime, w, h, updatedAt}
//   templates custom templates {id, name, assetId, w, h, dark, updatedAt}
//   meta      settings {key, value}
//   dirty     records waiting to be backed up {key:'kind:id', kind, id, at}

const DB_NAME = 'braindump';
const VERSION = 1;
const STORES = ['items', 'pages', 'assets', 'templates', 'meta', 'dirty'];
let dbPromise;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const name of STORES) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: name === 'meta' || name === 'dirty' ? 'key' : 'id' });
          }
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Database blocked — close other tabs of this app.'));
    });
  }
  return dbPromise;
}

function wrap(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await open();
  return db.transaction(name, mode).objectStore(name);
}

export async function get(name, id) {
  return wrap((await store(name)).get(id));
}

export async function getAll(name) {
  return wrap((await store(name)).getAll());
}

export async function put(name, value) {
  return wrap((await store(name, 'readwrite')).put(value));
}

export async function del(name, id) {
  return wrap((await store(name, 'readwrite')).delete(id));
}

/** Write several records across stores in one transaction. ops: [{store, value}] or [{store, del: id}] */
export async function batch(ops) {
  if (!ops.length) return;
  const db = await open();
  const names = [...new Set(ops.map((o) => o.store))];
  const tx = db.transaction(names, 'readwrite');
  for (const op of ops) {
    const s = tx.objectStore(op.store);
    if ('del' in op) s.delete(op.del);
    else s.put(op.value);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

export async function getMeta(key, fallback = undefined) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export async function setMeta(key, value) {
  return put('meta', { key, value });
}

/** Ask Safari not to evict our data. Harmless if refused. */
export async function askPersistent() {
  try {
    if (navigator.storage && navigator.storage.persist) await navigator.storage.persist();
  } catch {}
}
