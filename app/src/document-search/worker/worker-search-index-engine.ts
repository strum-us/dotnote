import type { RootKey } from "@/lib/config";

import type { RawDoc, SearchIndexEngine } from "../core/search-index-engine";
import type { DocumentRecord, SearchResult } from "../core/types";
import type {
  SearchWorkerRequest,
  SearchWorkerResponse,
} from "./protocol";

/** Distributive `Omit` so discriminated-union members stay narrow. */
type DistributiveOmit<T, K extends keyof any> = T extends any ? Omit<T, K> : never;

type PendingEntry = {
  resolve: (response: SearchWorkerResponse) => void;
  reject: (error: unknown) => void;
};

/**
 * `SearchIndexEngine` backed by a Web Worker. All normalization + MiniSearch
 * work happens off the main thread; the main thread only orchestrates I/O
 * and posts raw file content.
 */
export class WorkerSearchIndexEngine implements SearchIndexEngine {
  private readonly worker: Worker;
  private nextId = 1;
  private readonly pending = new Map<number, PendingEntry>();
  private disposed = false;
  /** Set when the worker fails to load or crashes. Callers should fall back to InProcess. */
  failed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  constructor() {
    this.worker = new Worker(
      new URL("./document-search.worker.ts", import.meta.url),
      { type: "module" },
    );
    this.worker.onmessage = (event: MessageEvent<SearchWorkerResponse>) => {
      const response = event.data;
      const entry = this.pending.get(response.id);
      if (!entry) return;
      this.pending.delete(response.id);
      if (response.type === "error") {
        entry.reject(new Error(response.message));
      } else {
        entry.resolve(response);
      }
    };
    this.worker.onerror = (event) => {
      this.failed = true;
      const error = new Error(event.message ?? "Search worker error");
      for (const entry of this.pending.values()) entry.reject(error);
      this.pending.clear();
    };
  }

  private request(message: DistributiveOmit<SearchWorkerRequest, "id">): Promise<SearchWorkerResponse> {
    if (this.disposed) return Promise.reject(new Error("Engine disposed"));
    const id = this.nextId++;
    return new Promise<SearchWorkerResponse>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...message, id } as SearchWorkerRequest);
    });
  }

  async reset(): Promise<void> {
    await this.request({ type: "reset" });
  }

  async replaceRecords(records: DocumentRecord[]): Promise<void> {
    await this.request({ type: "replaceRecords", records });
  }

  async exportRecords(): Promise<DocumentRecord[]> {
    const response = await this.request({ type: "exportRecords" });
    return response.type === "recordsResult" ? response.records : [];
  }

  async addChunk(docs: RawDoc[]): Promise<void> {
    await this.request({ type: "addChunk", docs });
  }

  async upsertRaw(root: string, path: string, raw: string): Promise<void> {
    await this.request({ type: "upsertRaw", root, path, raw });
  }

  async removeFile(root: RootKey, path: string): Promise<void> {
    await this.request({ type: "removeFile", root, path });
  }

  async removeDir(root: RootKey, path: string): Promise<void> {
    await this.request({ type: "removeDir", root, path });
  }

  async search(query: string, root: RootKey): Promise<SearchResult[]> {
    const response = await this.request({ type: "search", query, root });
    return response.type === "searchResult" ? response.results : [];
  }

  async recent(limit: number, root: RootKey): Promise<SearchResult[]> {
    const response = await this.request({ type: "recent", limit, root });
    return response.type === "recentResult" ? response.results : [];
  }

  async size(root?: RootKey): Promise<number> {
    const response = await this.request({ type: "size", root });
    return response.type === "size" ? response.size : 0;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.worker.terminate();
    const error = new Error("Engine disposed");
    for (const entry of this.pending.values()) entry.reject(error);
    this.pending.clear();
  }
}
