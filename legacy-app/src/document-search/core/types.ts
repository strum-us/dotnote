import type { RootKey } from "@/lib/config";

/** A single indexed Markdown document. */
export type DocumentRecord = {
  /** Stable composite id: `${root}:${path}`. */
  id: string;
  root: RootKey;
  /** Path relative to root, e.g. `notes/hello.md`. */
  path: string;
  /** First `#`/`##` heading, or the filename stem when no heading exists. */
  title: string;
  /** Normalized plain text used for full-body search. */
  body: string;
};

/** A search hit returned by the index. */
export type SearchResult = {
  id: string;
  root: RootKey;
  path: string;
  title: string;
  /** Relevance score from MiniSearch (higher is better). */
  score: number;
  /** Body snippet around the first matched term, for preview rendering. */
  snippet: string | null;
};

export type IndexStatus = "idle" | "building" | "ready" | "error";
