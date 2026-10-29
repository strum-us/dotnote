import type { RootKey } from "@/lib/config";

/**
 * In-app file writes (editor persist, create, restore) never produce a
 * chokidar event — the Vite plugin suppresses its own write echo for
 * `FS_WRITE_SUPPRESS_MS`. The document-search index (and any other
 * subscriber) listens here instead so it can update from the content we
 * just wrote, without waiting for a disk event that will never arrive.
 */
export type FileWriteEvent =
  | { type: "save"; root: RootKey; path: string; content: string }
  | { type: "delete"; root: RootKey; path: string }
  | { type: "move"; root: RootKey; oldPath: string; newPath: string };

type Listener = (event: FileWriteEvent) => void;

const listeners = new Set<Listener>();

export function emitFileWrite(event: FileWriteEvent): void {
  for (const listener of listeners) listener(event);
}

export function subscribeFileWrites(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
