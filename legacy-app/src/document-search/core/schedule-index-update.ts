import { isMarkdownPath } from "@/lib/config";
import type { RootKey } from "@/lib/config";

/**
 * Trailing debounce window after the last fs change for a given file before
 * the index is re-fetched and upserted. Matches the editor autosave window
 * so a burst of chokidar `change` events (autosave + write echo) collapses
 * into a single index update.
 */
export const INDEX_UPDATE_DEBOUNCE_MS = 400;

export type IndexFsEvent = {
  event?: string;
  root?: RootKey;
  path?: string;
};

export type IndexUpdateScheduler = {
  /** Queue an fs event. Deletes apply immediately; changes are debounced per file. */
  enqueue(event: IndexFsEvent): void;
  /** Drop a pending debounce for one file (used after an in-app save). */
  cancelFile(root: RootKey, path: string): void;
  /** Apply every pending change immediately and clear timers. */
  flush(): void;
  /** Cancel all pending timers without applying them. */
  dispose(): void;
  /** Number of files waiting for their debounce window to close. */
  pendingCount(): number;
};

/**
 * Per-file debounce for incremental index updates.
 *
 * `change`/`add` events reset a trailing timer keyed by `${root}:${path}`.
 * When the window closes, `apply` is invoked once with the latest event for
 * that file. `unlink`/`unlinkDir` apply immediately and cancel any pending
 * upsert so a just-deleted file is not re-indexed.
 */
export function createIndexUpdateScheduler(
  apply: (event: IndexFsEvent) => void | Promise<void>,
  delayMs = INDEX_UPDATE_DEBOUNCE_MS,
): IndexUpdateScheduler {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const pending = new Map<string, IndexFsEvent>();

  const eventKey = (root: string, path: string) => `${root}:${path}`;

  const cancel = (id: string) => {
    const timer = timers.get(id);
    if (timer != null) clearTimeout(timer);
    timers.delete(id);
    pending.delete(id);
  };

  const cancelMatching = (predicate: (id: string) => boolean) => {
    for (const id of [...timers.keys()]) {
      if (predicate(id)) cancel(id);
    }
  };

  const fire = (id: string) => {
    const event = pending.get(id);
    timers.delete(id);
    pending.delete(id);
    if (event) void apply(event);
  };

  return {
    enqueue(event) {
      if (!event.root || !event.path) return;
      const type = event.event;
      const id = eventKey(event.root, event.path);

      if (type === "unlink") {
        cancel(id);
        void apply(event);
        return;
      }

      if (type === "unlinkDir") {
        const prefix = `${event.root}:${event.path.endsWith("/") ? event.path : `${event.path}/`}`;
        cancelMatching((pendingId) => pendingId === id || pendingId.startsWith(prefix));
        void apply(event);
        return;
      }

      if (!isMarkdownPath(event.path)) return;

      pending.set(id, event);
      const existing = timers.get(id);
      if (existing != null) clearTimeout(existing);
      timers.set(
        id,
        setTimeout(() => {
          fire(id);
        }, delayMs),
      );
    },
    cancelFile(root, path) {
      cancel(eventKey(root, path));
    },
    flush() {
      const ids = [...pending.keys()];
      for (const id of ids) {
        const timer = timers.get(id);
        if (timer != null) clearTimeout(timer);
        fire(id);
      }
    },
    dispose() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      pending.clear();
    },
    pendingCount() {
      return pending.size;
    },
  };
}
