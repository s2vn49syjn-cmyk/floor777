let database;
function open() {
  if (database) return database;
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open('floor777-layout-review-v1', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('drafts', {keyPath: 'id'});
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return database;
}
async function transaction(mode, action) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', mode);
    const request = action(tx.objectStore('drafts'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || Error('Draft storage aborted'));
  });
}
export const loadDraft = id => transaction('readonly', store => store.get(id));
export const saveDraft = record => transaction('readwrite', store => store.put(record));
export const deleteDraft = id => transaction('readwrite', store => store.delete(id));
