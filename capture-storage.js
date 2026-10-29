// Receipt queues outgrow localStorage's small per-origin allowance. IndexedDB
// keeps the complete offline queue, including photos, without discarding history.
window.captureStorage = (() => {
  const LEGACY_KEY = 'eh_mobile_queue_v1';
  let database;
  let queue = [];
  const baselines = new WeakMap();
  const clone = (value) => JSON.parse(JSON.stringify(value));

  function transact(mode, action) {
    return new Promise((resolve, reject) => {
      const transaction = database.transaction('captures', mode);
      const store = transaction.objectStore('captures');
      let result;
      transaction.oncomplete = () => resolve(result);
      transaction.onabort = () => reject(transaction.error || new Error('Phone storage could not save the expense.'));
      transaction.onerror = () => {}; // onabort reports the failed transaction.
      action(store, (value) => { result = value; });
    });
  }

  async function initialize() {
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open('expense-hub-mobile', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('captures');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Expense Hub tabs and reload.'));
    });
    const stored = await transact('readonly', (store, done) => {
      store.get('queue').onsuccess = (event) => done(event.target.result);
    });
    if (stored !== undefined && !Array.isArray(stored)) throw new Error('The saved phone queue could not be read.');
    const legacyText = localStorage.getItem(LEGACY_KEY);
    if (legacyText !== null) {
      const legacy = JSON.parse(legacyText);
      if (!Array.isArray(legacy)) throw new Error('The saved phone queue could not be read.');
      // Retrying an interrupted migration must not duplicate or replace newer
      // IndexedDB records. The original stays untouched until the commit succeeds.
      queue = await transact('readwrite', (store, done) => {
        store.get('queue').onsuccess = (event) => {
          const merged = new Map((event.target.result || []).map((item) => [item.localId, item]));
          legacy.forEach((item) => { if (!merged.has(item.localId)) merged.set(item.localId, item); });
          const result = Array.from(merged.values());
          store.put(result, 'queue');
          done(result);
        };
      });
      if (localStorage.getItem(LEGACY_KEY) === legacyText) localStorage.removeItem(LEGACY_KEY);
    } else {
      queue = stored || [];
    }
  }

  function load() {
    const snapshot = clone(queue);
    baselines.set(snapshot, clone(snapshot));
    return snapshot;
  }

  async function save(list, source = list) {
    const proposed = clone(list);
    const before = baselines.get(source) || clone(queue);
    const prior = new Map(before.map((item) => [item.localId, item]));
    const incoming = new Map(proposed.map((item) => [item.localId, item]));
    const committed = await transact('readwrite', (store, done) => {
      store.get('queue').onsuccess = (event) => {
        const current = new Map((event.target.result || []).map((item) => [item.localId, item]));
        prior.forEach((old, id) => {
          if (!incoming.has(id) && current.get(id)?.syncToken === old.syncToken) current.delete(id);
        });
        incoming.forEach((item, id) => {
          const old = prior.get(id);
          const latest = current.get(id);
          if (!old) { current.set(id, item); return; }
          // A completed network request must never resurrect a deleted capture
          // or overwrite a newer edit made while that request was in flight.
          if (!latest || (latest.syncToken !== old.syncToken && item.syncToken === old.syncToken)) return;
          const merged = { ...latest };
          new Set([...Object.keys(old), ...Object.keys(item)]).forEach((key) => {
            if (JSON.stringify(old[key]) === JSON.stringify(item[key])) return;
            if (Object.prototype.hasOwnProperty.call(item, key)) merged[key] = item[key];
            else delete merged[key];
          });
          current.set(id, merged);
        });
        const result = Array.from(current.values());
        store.put(result, 'queue');
        done(result);
      };
    });
    queue = committed;
    baselines.set(list, proposed);
  }

  return { ready: initialize(), load, save };
})();
