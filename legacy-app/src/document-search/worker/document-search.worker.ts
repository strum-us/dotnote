/// <reference lib="webworker" />

import { DocumentIndexes } from "../core/document-indexes";
import { handleWorkerRequest } from "./worker-core";
import type { SearchWorkerRequest, SearchWorkerResponse } from "./protocol";

const indexes = new DocumentIndexes();

self.onmessage = (event: MessageEvent<SearchWorkerRequest>): void => {
  let response: SearchWorkerResponse;
  try {
    response = handleWorkerRequest(indexes, event.data);
  } catch (error) {
    response = {
      type: "error",
      id: event.data.id,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  (self as unknown as Worker).postMessage(response);
};
