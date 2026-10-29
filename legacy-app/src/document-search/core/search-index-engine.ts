import type { RootKey } from "@/lib/config";
import { isMarkdownPath } from "@/lib/config";

import { DocumentIndexes } from "./document-indexes";
import { buildRecord } from "./build-record";
import type { DocumentRecord, SearchResult } from "./types";

/** A raw file to be normalized + indexed by the engine. */
export type RawDoc = {
  root: string;
  path: string;
  raw: string;
};

/**
 * Abstraction over the document search index. The store drives the engine
 * with raw file content so normalization + MiniSearch work happens behind
 * the implementation — in-process for tests, in a Web Worker in production.
 *
 * The index is partitioned by root: `search` and `recent` take a `root`
 * argument so Cmd+K only sees one root at a time. `size` accepts an optional
 * root for the same reason; omitting it returns the total across both roots
 * (used for rebuild progress).
 */
export interface SearchIndexEngine {
  reset(): Promise<void>;
  replaceRecords(records: DocumentRecord[]): Promise<void>;
  exportRecords(): Promise<DocumentRecord[]>;
  addChunk(docs: RawDoc[]): Promise<void>;
  upsertRaw(root: string, path: string, raw: string): Promise<void>;
  removeFile(root: RootKey, path: string): Promise<void>;
  removeDir(root: RootKey, path: string): Promise<void>;
  search(query: string, root: RootKey): Promise<SearchResult[]>;
  recent(limit: number, root: RootKey): Promise<SearchResult[]>;
  size(root?: RootKey): Promise<number>;
  dispose(): Promise<void>;
}

/**
 * Engine that runs entirely on the main thread. Used by tests and as a
 * fallback when Web Workers are unavailable.
 */
export class InProcessSearchIndexEngine implements SearchIndexEngine {
  private readonly indexes = new DocumentIndexes();

  async reset(): Promise<void> {
    this.indexes.replaceAll([]);
  }

  async replaceRecords(records: DocumentRecord[]): Promise<void> {
    this.indexes.replaceAll(records);
  }

  async exportRecords(): Promise<DocumentRecord[]> {
    return this.indexes.all();
  }

  async addChunk(docs: RawDoc[]): Promise<void> {
    for (const { root, path, raw } of docs) {
      const record = buildRecord(root, path, raw);
      if (record) this.indexes.upsert(record);
    }
  }

  async upsertRaw(root: string, path: string, raw: string): Promise<void> {
    if (!isMarkdownPath(path)) return;
    const record = buildRecord(root, path, raw);
    if (record) this.indexes.upsert(record);
  }

  async removeFile(root: RootKey, path: string): Promise<void> {
    this.indexes.removeFile(root, path);
  }

  async removeDir(root: RootKey, path: string): Promise<void> {
    this.indexes.removeDir(root, path);
  }

  async search(query: string, root: RootKey): Promise<SearchResult[]> {
    return this.indexes.search(query, root);
  }

  async recent(limit: number, root: RootKey): Promise<SearchResult[]> {
    return this.indexes.recent(limit, root);
  }

  async size(root?: RootKey): Promise<number> {
    return this.indexes.size(root);
  }

  async dispose(): Promise<void> {}
}
