import { DocumentIndexes } from "../core/document-indexes";
import { buildRecord } from "../core/build-record";
import { isMarkdownPath } from "@/lib/config";
import type { SearchWorkerRequest, SearchWorkerResponse } from "./protocol";

/**
 * Pure handler that mutates a `DocumentIndexes` in response to a worker
 * request. Extracted so the protocol can be unit-tested without spinning
 * up a real `Worker`.
 */
export function handleWorkerRequest(
  indexes: DocumentIndexes,
  request: SearchWorkerRequest,
): SearchWorkerResponse {
  switch (request.type) {
    case "reset":
      indexes.replaceAll([]);
      return { type: "ok", id: request.id };

    case "replaceRecords":
      indexes.replaceAll(request.records);
      return { type: "ok", id: request.id };

    case "exportRecords":
      return {
        type: "recordsResult",
        id: request.id,
        records: indexes.all(),
      };

    case "addChunk": {
      for (const { root, path, raw } of request.docs) {
        const record = buildRecord(root, path, raw);
        if (record) indexes.upsert(record);
      }
      return { type: "ok", id: request.id };
    }

    case "upsertRaw": {
      if (!isMarkdownPath(request.path)) return { type: "ok", id: request.id };
      const record = buildRecord(request.root, request.path, request.raw);
      if (record) indexes.upsert(record);
      return { type: "ok", id: request.id };
    }

    case "removeFile":
      indexes.removeFile(request.root, request.path);
      return { type: "ok", id: request.id };

    case "removeDir":
      indexes.removeDir(request.root, request.path);
      return { type: "ok", id: request.id };

    case "search":
      return {
        type: "searchResult",
        id: request.id,
        results: indexes.search(request.query, request.root),
      };

    case "recent":
      return {
        type: "recentResult",
        id: request.id,
        results: indexes.recent(request.limit, request.root),
      };

    case "size":
      return { type: "size", id: request.id, size: indexes.size(request.root) };

    case "dispose":
      indexes.replaceAll([]);
      return { type: "ok", id: request.id };
  }
}
