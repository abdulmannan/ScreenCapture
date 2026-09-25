// IndexedDB store for finished captures. The service worker and the preview
// page share the extension origin, so both see the same database; this avoids
// pushing multi-megabyte images through runtime messages.
// Loaded via importScripts() in background.js and a <script> tag in preview.html.

const CaptureDB = (() => {
  const DB_NAME = 'screencapture';
  const STORE = 'captures';
  const VERSION = 1;
  let dbPromise = null;

  function open() {
    dbPromise ??= new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function request(mode, makeRequest) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = makeRequest(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error || req.error);
    });
  }

  return {
    put: (record) => request('readwrite', (store) => store.put(record)),
    get: (id) => request('readonly', (store) => store.get(id)),
    delete: (id) => request('readwrite', (store) => store.delete(id)),
    keys: () => request('readonly', (store) => store.getAllKeys()),
  };
})();
