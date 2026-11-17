// Almacenamiento local (IndexedDB). Todo se guarda aquí primero; la nube es secundaria.
const DB_NAME = 'rema-reportes';
const VERSION = 1;
const STORES = ['kv', 'records', 'photos', 'outbox'];
let dbp;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, VERSION);
    r.onupgradeneeded = () => {
      const d = r.result;
      for (const s of STORES) {
        if (!d.objectStoreNames.contains(s)) d.createObjectStore(s, s === 'kv' ? undefined : { keyPath: 'id' });
      }
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

function run(store, mode, fn) {
  return open().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const req = fn(t.objectStore(store));
    let out;
    if (req) req.onsuccess = () => { out = req.result; };
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

export const get = (store, key) => run(store, 'readonly', s => s.get(key));
export const all = (store) => run(store, 'readonly', s => s.getAll());
export const keys = (store) => run(store, 'readonly', s => s.getAllKeys());
export const put = (store, val, key) => run(store, 'readwrite', s => (key === undefined ? s.put(val) : s.put(val, key)));
export const del = (store, key) => run(store, 'readwrite', s => s.delete(key));
export const clear = (store) => run(store, 'readwrite', s => s.clear());

export const kvGet = (k, def) => get('kv', k).then(v => (v === undefined ? def : v));
export const kvSet = (k, v) => put('kv', v, k);

// Cola de subida: una entrada por objeto (se sobreescribe si se edita varias veces).
export const enqueue = (kind, refId, obraId) =>
  put('outbox', { id: `${kind}:${refId}`, kind, refId, obraId, ts: Date.now() });
