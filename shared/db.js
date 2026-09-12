(() => {
  const DB_NAME = 'openscreen-studio';
  const DB_VERSION = 1;
  const STORE = 'media';

  function openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt');
          store.createIndex('kind', 'kind');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async function transact(mode, operation) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      let result;
      try { result = operation(store); } catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result?.result ?? result);
      tx.onerror = () => reject(tx.error);
    }).finally(() => db.close());
  }

  async function save(record) {
    const libraryRecord = { ...record, savedToLibrary: true };
    await transact('readwrite', store => store.put(libraryRecord));
    const { recentItems = [] } = await chrome.storage.local.get('recentItems');
    const meta = { id: libraryRecord.id, kind: libraryRecord.kind, name: libraryRecord.name, createdAt: libraryRecord.createdAt, size: libraryRecord.blob?.size || 0, width: libraryRecord.width, height: libraryRecord.height, duration: libraryRecord.duration };
    await chrome.storage.local.set({ recentItems: [meta, ...recentItems.filter(item => item.id !== libraryRecord.id)].slice(0, 100) });
    return libraryRecord.id;
  }

  // Drafts let the editor load a fresh capture without making it a library item.
  async function saveDraft(record) {
    await transact('readwrite', store => store.put({ ...record, savedToLibrary: false }));
    return record.id;
  }

  async function get(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  async function list() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      request.onsuccess = () => resolve(request.result.filter(record => record.savedToLibrary !== false).sort((a, b) => b.createdAt - a.createdAt));
      request.onerror = () => reject(request.error);
    }).finally(() => db.close());
  }

  async function remove(id) {
    await transact('readwrite', store => store.delete(id));
    const { recentItems = [] } = await chrome.storage.local.get('recentItems');
    await chrome.storage.local.set({ recentItems: recentItems.filter(item => item.id !== id) });
  }

  async function rename(id, name) {
    const record = await get(id);
    if (!record) return;
    record.name = name;
    await save(record);
  }

  async function markOpened(id) {
    const record = await get(id);
    if (!record) return;
    record.lastOpenedAt = Date.now();
    await transact('readwrite', store => store.put(record));
  }

  window.OpenScreenDB = { save, saveDraft, get, list, remove, rename, markOpened };
})();
