/**
 * Minimal IndexedDB key-value storage for data too large for localStorage: the card catalog,
 * prices and AI conversations. Every call fails soft (null / no-op) so the app keeps working
 * when IndexedDB is unavailable (private mode, blocked storage).
 */

const DB_NAME = 'folio';
const STORES = ['catalog', 'kv', 'conversations'];

let dbPromise = null;

const openDb = () => {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of STORES) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch(() => null);
  return dbPromise;
};

const run = async (store, mode, fn) => {
  try {
    const db = await openDb();
    if (!db) return null;
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const request = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(request?.result ?? null);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    return null;
  }
};

export const idbGet = (store, key) => run(store, 'readonly', (s) => s.get(key));

export const idbSet = (store, key, value) => run(store, 'readwrite', (s) => s.put(value, key));

export const idbDelete = (store, key) => run(store, 'readwrite', (s) => s.delete(key));

/** All values of a store. */
export const idbGetAll = async (store) => (await run(store, 'readonly', (s) => s.getAll())) ?? [];
