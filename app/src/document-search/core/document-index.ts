import MiniSearch from "minisearch";

import type { RootKey } from "@/lib/config";
import type { DocumentRecord, SearchResult } from "./types";
import { extractSnippet } from "./snippet";
import { filenameField, foldernameField, namesField } from "./name-fields";

/**
 * Tokenizer shared by the index and the query: splits on `/`, `-`, `_`, and
 * whitespace so path segments (`products/duck-launcher`) and snake/kebab
 * names (`duck_launcher`) are searchable as individual tokens.
 */
export function tokenizePath(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[/\-_\s]+/)
    .filter((token) => token.length > 0);
}

/** MiniSearch document shape with derived name fields. */
type MiniDoc = DocumentRecord & {
  filename: string;
  foldername: string;
  names: string;
};

function toMiniDoc(record: DocumentRecord): MiniDoc {
  return {
    ...record,
    filename: filenameField(record.path),
    foldername: foldernameField(record.path),
    names: namesField(record.title, record.path),
  };
}

/**
 * Thin wrapper around MiniSearch that owns the in-memory document index for
 * the Cmd+K document search.
 *
 * The index is keyed by `${root}:${path}` and searches across `title`,
 * `filename`, `foldername`, `names`, `path`, and `body` fields. Name and
 * path matches are boosted so a `products/duck-launcher` hit ranks above a
 * body hit for the same query. Because MiniSearch does not expose its
 * document set for enumeration, this wrapper keeps a parallel `Map` of
 * records so the UI can list recent docs and remove by root/path.
 */
export class DocumentIndex {
  private readonly mini: MiniSearch;
  private readonly records = new Map<string, DocumentRecord>();

  constructor() {
    this.mini = new MiniSearch({
      idField: "id",
      fields: ["title", "filename", "foldername", "names", "path", "body"],
      storeFields: ["root", "path", "title", "body"],
      tokenize: tokenizePath,
      searchOptions: {
        boost: { filename: 6, foldername: 6, names: 5, title: 4, path: 2, body: 1 },
        prefix: true,
        combineWith: "AND",
      },
    });
  }

  get size(): number {
    return this.mini.documentCount;
  }

  /** Replace the entire index with `records` (used on initial build). */
  replaceAll(records: DocumentRecord[]): void {
    this.mini.removeAll();
    this.records.clear();
    if (records.length > 0) this.mini.addAll(records.map(toMiniDoc));
    for (const record of records) this.records.set(record.id, record);
  }

  /** Add or update a single document. */
  upsert(record: DocumentRecord): void {
    if (this.mini.has(record.id)) this.mini.replace(toMiniDoc(record));
    else this.mini.add(toMiniDoc(record));
    this.records.set(record.id, record);
  }

  /** Remove a document by composite id. */
  removeById(id: string): void {
    if (this.mini.has(id)) this.mini.discard(id);
    this.records.delete(id);
  }

  /** Remove every document for a given root (used on vault disconnect). */
  removeByRoot(root: RootKey): void {
    const prefix = `${root}:`;
    for (const id of [...this.records.keys()]) {
      if (id.startsWith(prefix)) this.removeById(id);
    }
  }

  /** Remove a single file by root + path. */
  removeFile(root: RootKey, path: string): void {
    this.removeById(`${root}:${path}`);
  }

  /**
   * Search the index and return `SearchResult`s with snippets attached.
   * Returns an empty array for blank queries (the UI shows recent docs instead).
   */
  search(query: string): SearchResult[] {
    const trimmed = query.trim();
    if (trimmed.length === 0) return [];
    const raw = this.mini.search(trimmed, {
      boost: { filename: 6, foldername: 6, names: 5, title: 4, path: 2, body: 1 },
      prefix: true,
      combineWith: "AND",
    });
    const terms = extractTerms(trimmed);
    return raw
      .map((hit) => {
        const record = this.records.get(hit.id as string);
        const path = (record?.path ?? hit.path) as string;
        const title = (record?.title ?? hit.title) as string;
        return {
          id: hit.id as string,
          root: hit.root as RootKey,
          path,
          title,
          score: hit.score,
          snippet: extractSnippet(hit.body as string, terms),
        };
      })
      .sort((a, b) => nameMatchScore(b, terms) - nameMatchScore(a, terms));
  }

  /** Return all stored records (used by the "recent docs" fallback). */
  all(): DocumentRecord[] {
    return [...this.records.values()];
  }
}

/**
 * Score how strongly a result's name fields (title, filename, foldername,
 * path) cover the query terms. Higher is better; used as a stable tie-break
 * above MiniSearch's relevance score so a path match like
 * `products/duck-launcher` outranks a body-only hit for `product duck`.
 */
export function nameMatchScore(result: { path: string; title: string }, terms: string[]): number {
  if (terms.length === 0) return 0;
  const haystack = [
    result.title.toLowerCase(),
    filenameField(result.path).toLowerCase(),
    foldernameField(result.path).toLowerCase(),
    result.path.toLowerCase(),
  ];
  let score = 0;
  for (const term of terms) {
    if (!term) continue;
    let termScore = 0;
    for (const field of haystack) {
      if (!field) continue;
      if (field === term) {
        termScore = Math.max(termScore, 4);
      } else if (field.startsWith(term)) {
        termScore = Math.max(termScore, 3);
      } else if (field.includes(term)) {
        termScore = Math.max(termScore, 2);
      } else if (field.split(/[/\-_\s]+/).some((token) => token.startsWith(term))) {
        termScore = Math.max(termScore, 1);
      }
    }
    score += termScore;
  }
  return score;
}

/** Split a query into the search terms the index tokenizer would produce. */
export function extractTerms(query: string): string[] {
  return tokenizePath(query.trim());
}
