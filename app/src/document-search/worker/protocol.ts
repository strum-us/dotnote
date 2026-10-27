import type { RootKey } from "@/lib/config";
import type { DocumentRecord, SearchResult } from "../core/types";

/** Raw document sent from the main thread for the worker to normalize + index. */
export type RawDoc = { root: string; path: string; raw: string };

export type SearchWorkerRequest =
  | { type: "reset"; id: number }
  | { type: "replaceRecords"; id: number; records: DocumentRecord[] }
  | { type: "exportRecords"; id: number }
  | { type: "addChunk"; id: number; docs: RawDoc[] }
  | { type: "upsertRaw"; id: number; root: string; path: string; raw: string }
  | { type: "removeFile"; id: number; root: RootKey; path: string }
  | { type: "removeDir"; id: number; root: RootKey; path: string }
  | { type: "search"; id: number; query: string; root: RootKey }
  | { type: "recent"; id: number; limit: number; root: RootKey }
  | { type: "size"; id: number; root?: RootKey }
  | { type: "dispose"; id: number };

export type SearchWorkerResponse =
  | { type: "ok"; id: number }
  | { type: "size"; id: number; size: number }
  | { type: "recordsResult"; id: number; records: DocumentRecord[] }
  | { type: "searchResult"; id: number; results: SearchResult[] }
  | { type: "recentResult"; id: number; results: SearchResult[] }
  | { type: "error"; id: number; message: string };
