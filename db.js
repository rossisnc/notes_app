// db.js — tiny IndexedDB wrapper. Everything is stored on this device only.
const NAME = 'catchall';
const VERSION = 1;
const STORES = { notes: 'id', notebooks: 'id', meta: 'key' };

let conn = null;

function openDb() {
  if (conn) return conn;
  conn = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!d.objectStoreNames.contains(name)) d.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => {
      const d = req.result;
      d.onclose = () => { conn = null; };
      d.onversionchange = () => { d.close(); conn = null; };
      resolve(d);
    };
    req.onerror = () => { conn = null; reject(req.error); };
  });
  return conn;
}

// Runs `work(store)` in a transaction. Retries once, because iPadOS Safari
// sometimes drops the IndexedDB connection after the app sits in the background.
async function run(storeName, mode, work) {
  for (let attempt = 0; ; attempt++) {
    try {
      const d = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = d.transaction(storeName, mode);
        const req = work(tx.objectStore(storeName));
        tx.oncomplete = () => resolve(req ? req.result : undefined);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Save was interrupted'));
      });
    } catch (err) {
      conn = null;
      if (attempt >= 1) throw err;
    }
  }
}

export const db = {
  getAll: (store) => run(store, 'readonly', (s) => s.getAll()),
  put: (store, value) => run(store, 'readwrite', (s) => { s.put(value); }),
  putMany: (store, values) => run(store, 'readwrite', (s) => { for (const v of values) s.put(v); }),
  delete: (store, key) => run(store, 'readwrite', (s) => { s.delete(key); }),
  deleteMany: (store, keys) => run(store, 'readwrite', (s) => { for (const k of keys) s.delete(k); }),
};
