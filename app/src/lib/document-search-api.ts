import type { DocumentRecord } from "@/document-search/core/types";
import type { RootKey } from "@/lib/config";
import { workspaceStore } from "@/stores/workspace-store";

const DB_NAME = "dotnote-search";
const STORE = "snapshots";

export type RecentEntry = {
  root: RootKey;
  path: string;
  title: string;
  openedAt: string;
};

export type RecentsSnapshot = {
  entries: RecentEntry[];
};

export type IndexingSnapshot = {
  version: 1;
  builtAt: string;
  records: DocumentRecord[];
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    tx.oncomplete = () => db.close();
  });
}

async function idbPut<T>(key: string, value: T): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    const req = tx.objectStore(STORE).put(value, key);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve();
    tx.oncomplete = () => db.close();
  });
}

function workspaceKey(kind: "index" | "recents"): string {
  const id = workspaceStore.activeId;
  if (!id) throw new Error("no workspace");
  return `${kind}:${id}`;
}

function isRecord(value: unknown): value is DocumentRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DocumentRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.root === "string" &&
    typeof record.path === "string" &&
    typeof record.title === "string" &&
    typeof record.body === "string"
  );
}

export async function fetchIndexingSnapshot(): Promise<IndexingSnapshot | null> {
  const snapshot = await idbGet<IndexingSnapshot>(workspaceKey("index"));
  if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.records)) return null;
  if (!snapshot.records.every(isRecord)) return null;
  return snapshot;
}

export async function saveIndexingSnapshot(records: DocumentRecord[]): Promise<IndexingSnapshot> {
  const snapshot: IndexingSnapshot = {
    version: 1,
    builtAt: new Date().toISOString(),
    records,
  };
  await idbPut(workspaceKey("index"), snapshot);
  return snapshot;
}

export async function fetchRecentsSnapshot(): Promise<RecentsSnapshot> {
  const snapshot = await idbGet<RecentsSnapshot>(workspaceKey("recents"));
  return { entries: snapshot?.entries ?? [] };
}

export async function saveRecentsSnapshot(entries: RecentEntry[]): Promise<RecentsSnapshot> {
  const snapshot = { entries };
  await idbPut(workspaceKey("recents"), snapshot);
  return snapshot;
}
