const CACHE_DB = "dotnote-cache";
const DRAFT_DB = "dotnote-drafts";
const SYNC_DB = "dotnote-sync";

const CACHE_STORES = ["notes", "trees"];
const DRAFT_STORES = ["drafts"];
const SYNC_STORES = ["ops"];

type CacheStore = "notes" | "trees";

/** One connection per database for the page's lifetime; opening is the slow part. */
const connections = new Map<string, Promise<IDBDatabase>>();

function openDb(name: string, stores: string[]): Promise<IDBDatabase> {
  const existing = connections.get(name);
  if (existing) return existing;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        connections.delete(name);
      };
      resolve(db);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of stores) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
  });
  connections.set(name, opening);
  opening.catch(() => connections.delete(name));
  return opening;
}

async function run<T>(
  dbName: string,
  stores: string[],
  store: string,
  mode: IDBTransactionMode,
  body: (objectStore: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb(dbName, stores);
  return new Promise((resolve, reject) => {
    const req = body(db.transaction(store, mode).objectStore(store));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbGet<T>(dbName: string, stores: string[], store: string, key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  const value = await run<T | undefined>(dbName, stores, store, "readonly", (s) => s.get(key));
  return value ?? null;
}

async function idbPut<T>(dbName: string, stores: string[], store: string, key: string, value: T): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run(dbName, stores, store, "readwrite", (s) => s.put(value, key));
}

async function idbDelete(dbName: string, stores: string[], store: string, key: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run(dbName, stores, store, "readwrite", (s) => s.delete(key));
}

async function idbEntries<T>(dbName: string, stores: string[], store: string): Promise<Array<{ key: string; value: T }>> {
  if (typeof indexedDB === "undefined") return [];
  const [keys, values] = await Promise.all([
    run<IDBValidKey[]>(dbName, stores, store, "readonly", (s) => s.getAllKeys()),
    run<T[]>(dbName, stores, store, "readonly", (s) => s.getAll()),
  ]);
  return keys.map((key, i) => ({ key: String(key), value: values[i]! }));
}

export function readCache<T>(key: string, store: CacheStore): Promise<T | null> {
  return idbGet(CACHE_DB, CACHE_STORES, store, key);
}

export function writeCache<T>(key: string, value: T, store: CacheStore): Promise<void> {
  return idbPut(CACHE_DB, CACHE_STORES, store, key, value);
}

export function deleteCache(key: string, store: CacheStore): Promise<void> {
  return idbDelete(CACHE_DB, CACHE_STORES, store, key);
}

/** Durable sync queue: one record per pending op, keyed by op id. */
export async function readSyncOps<T>(): Promise<T[]> {
  return (await idbEntries<T>(SYNC_DB, SYNC_STORES, "ops")).map((entry) => entry.value);
}

export function writeSyncOp<T>(opId: string, op: T): Promise<void> {
  return idbPut(SYNC_DB, SYNC_STORES, "ops", opId, op);
}

export function deleteSyncOp(opId: string): Promise<void> {
  return idbDelete(SYNC_DB, SYNC_STORES, "ops", opId);
}

/** Drafts written by builds before the sync queue. Read once to migrate them, then removed. */
export type LegacyDraft = {
  content: string;
  updatedAt: number;
  contentHash?: string;
};

export function readLegacyDrafts(): Promise<Array<{ key: string; value: LegacyDraft }>> {
  return idbEntries<LegacyDraft>(DRAFT_DB, DRAFT_STORES, "drafts");
}

export function deleteLegacyDraft(key: string): Promise<void> {
  return idbDelete(DRAFT_DB, DRAFT_STORES, "drafts", key);
}
