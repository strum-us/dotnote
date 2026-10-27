import type { ImportPlan } from "@/lib/import-markdown";

const DB_NAME = "dotnote-import";
const DB_STORES = ["jobs", "handles"] as const;

export type ImportPhase = "staging" | "needs-permission" | "publishing" | "done" | "failed";

export type ImportJob = {
  id: string;
  ownerId: string;
  workspaceId: string;
  workspaceName: string;
  rootName: string;
  phase: ImportPhase;
  plan: ImportPlan | null;
  /** Markdown files copied into local storage. */
  notesStaged: number;
  notesTotal: number;
  bytesStaged: number;
  publishedNoteIds: string[];
  publishedAssetKeys: string[];
  currentPath: string;
  errors: { path: string; message: string }[];
  message: string | null;
  startedAt: number;
  updatedAt: number;
};

const connections = new Map<string, Promise<IDBDatabase>>();

function openDb(): Promise<IDBDatabase> {
  const existing = connections.get(DB_NAME);
  if (existing) return existing;
  const opening = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        connections.delete(DB_NAME);
      };
      resolve(db);
    };
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const store of DB_STORES) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
  });
  connections.set(DB_NAME, opening);
  opening.catch(() => connections.delete(DB_NAME));
  return opening;
}

async function run<T>(store: string, mode: IDBTransactionMode, body: (objectStore: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = body(db.transaction(store, mode).objectStore(store));
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

export async function readImportJob(ownerId: string): Promise<ImportJob | null> {
  if (typeof indexedDB === "undefined") return null;
  const value = await run<ImportJob | undefined>("jobs", "readonly", (store) => store.get(ownerId));
  return value ?? null;
}

export async function writeImportJob(job: ImportJob): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run("jobs", "readwrite", (store) => store.put(job, job.ownerId));
}

export async function deleteImportJob(ownerId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run("jobs", "readwrite", (store) => store.delete(ownerId));
}

export async function readImportHandle(ownerId: string): Promise<FileSystemDirectoryHandle | null> {
  if (typeof indexedDB === "undefined") return null;
  const value = await run<FileSystemDirectoryHandle | undefined>("handles", "readonly", (store) => store.get(ownerId));
  return value ?? null;
}

export async function writeImportHandle(ownerId: string, handle: FileSystemDirectoryHandle): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run("handles", "readwrite", (store) => store.put(handle, ownerId));
}

export async function deleteImportHandle(ownerId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  await run("handles", "readwrite", (store) => store.delete(ownerId));
}
