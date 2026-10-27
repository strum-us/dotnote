import { ROOT_KEYS, type RootKey } from "@/lib/config";

import { DocumentIndex } from "./document-index";
import type { DocumentRecord, SearchResult } from "./types";

function toRecentResult(record: {
  id: string;
  root: RootKey;
  path: string;
  title: string;
}): SearchResult {
  return {
    id: record.id,
    root: record.root,
    path: record.path,
    title: record.title,
    score: 0,
    snippet: null,
  };
}

/**
 * Per-root container of `DocumentIndex` instances. Each root (`workspace`,
 * `skills`) owns its own MiniSearch so Cmd+K can search one root at a time
 * without mixing hits across roots. The worker and the in-process fallback
 * both wrap this container; the store asks for a specific root when
 * searching or listing recents.
 */
export class DocumentIndexes {
  private readonly byRoot: Record<RootKey, DocumentIndex>;

  constructor() {
    const byRoot = {} as Record<RootKey, DocumentIndex>;
    for (const root of ROOT_KEYS) byRoot[root] = new DocumentIndex();
    this.byRoot = byRoot;
  }

  /** Replace all records, routing each to its root's index. */
  replaceAll(records: DocumentRecord[]): void {
    for (const root of ROOT_KEYS) this.byRoot[root].replaceAll([]);
    for (const record of records) {
      this.byRoot[record.root].upsert(record);
    }
  }

  /** Add or update a single document in its root's index. */
  upsert(record: DocumentRecord): void {
    this.byRoot[record.root].upsert(record);
  }

  /** Remove a single file from its root's index. */
  removeFile(root: RootKey, path: string): void {
    this.byRoot[root].removeFile(root, path);
  }

  /** Remove a directory and its descendants from the given root's index. */
  removeDir(root: RootKey, path: string): void {
    const prefix = path.endsWith("/") ? path : `${path}/`;
    const index = this.byRoot[root];
    for (const doc of index.all()) {
      if (doc.path === path || doc.path.startsWith(prefix)) {
        index.removeFile(root, doc.path);
      }
    }
  }

  /** Remove every document for a root (used on vault disconnect). */
  removeByRoot(root: RootKey): void {
    this.byRoot[root].replaceAll([]);
  }

  /** Search only the given root's index. */
  search(query: string, root: RootKey): SearchResult[] {
    return this.byRoot[root].search(query);
  }

  /** Recent documents from the given root only. */
  recent(limit: number, root: RootKey): SearchResult[] {
    return this.byRoot[root]
      .all()
      .slice(-limit)
      .reverse()
      .map(toRecentResult);
  }

  /** All records for a root, or all records across both roots. */
  all(root?: RootKey): DocumentRecord[] {
    if (root) return this.byRoot[root].all();
    return ROOT_KEYS.flatMap((r) => this.byRoot[r].all());
  }

  /** Size of one root, or the total across both roots. */
  size(root?: RootKey): number {
    if (root) return this.byRoot[root].size;
    return ROOT_KEYS.reduce((sum, r) => sum + this.byRoot[r].size, 0);
  }
}
