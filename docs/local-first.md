# Local-First Rules

Dotnote treats the browser as the primary copy of a workspace. The server is a replica the client catches up in the background. Every feature that reads or writes notes, folders or workspaces follows these rules.

## The rules

1. **Commit locally, then sync.** A user action updates the MobX stores in the same frame and is durably recorded in IndexedDB before any request starts. Event handlers and store commands never `await` the network before the UI reflects the action.
2. **The client mints identity.** New notes, folders and workspaces get a `crypto.randomUUID()` id on the client, so tabs, the editor and search can address them before the server has heard of them. Server create endpoints accept that id and are idempotent: a retried create returns the existing entry instead of duplicating it.
3. **Every mutation is an op in one queue.** Creates, renames, deletes and content saves are ops in the durable sync queue (`dotnote-sync` IndexedDB). One loop drains it in order, one request at a time, so the server never sees two writes from the same client race each other. A save of a note coalesces into that note's pending save or create instead of stacking up.
4. **What you see is the server snapshot plus pending ops.** The tree is derived by replaying pending ops over the last server manifest, using the same reducers the worker runs (`app/shared/manifest.ts`). A pending create never disappears because the server has not caught up, and a pending delete never comes back.
5. **Three sync states, derived from the queue.** Every entry is `local` (changed here, not on the server yet; this includes offline and retrying), `syncing` (its op is in flight) or `synced`. Sidebar rows and tabs show a marker for `local` and `syncing` only. There is no separate dirty flag to keep in step; the queue is the answer.
6. **Labels never go blank.** A note's label is its first heading, falling back to `Untitled`. The sidebar, tabs, editor header and search all derive it with the same helpers (`titleFromMarkdown`, `displayEntryName`), including for notes that exist only locally.
7. **Local edits win until the server proves otherwise.** Opening a note paints the newest local copy (pending op, then cache) first. A server response replaces it only when nothing is pending for that note. Transient failures (offline, 5xx, expired session) keep the op and retry with backoff, with no attempt limit. Only a definitive answer drops an op, and a `409` conflict parks that note's ops until the user chooses a side. A local copy is never discarded silently.
8. **Server writes are compare-and-swap.** The worker updates `manifest.json` with an R2 etag precondition and retries on contention, so concurrent requests from other tabs or devices cannot drop each other's entries. Saving content identical to the server copy always succeeds.

## Where the pieces live

| Concern | File |
|---|---|
| Op types and the replay reducer | `app/src/lib/sync-ops.ts` |
| Durable queue, sender, server snapshots, sync state | `app/src/stores/sync-store.ts` |
| Tree commands (create, rename, delete) and the derived tree | `app/src/stores/workspace-store.ts` |
| Editor content, autosave, note-level commands | `app/src/stores/note-store.ts` |
| Shared manifest reducers (client replay and worker) | `app/shared/manifest.ts` |
| Compare-and-swap manifest writes | `app/worker/storage.ts` (`mutateManifest`) |

## Adding a mutation

1. Add an op kind to `SyncOpBody` in `sync-ops.ts` and teach `applyOp` how it changes a manifest. Put the manifest change in `shared/manifest.ts` when the worker needs the same logic.
2. Make the endpoint accept client ids, succeed when replayed, and return the new manifest (or the changed entry for content saves).
3. Send it from `SyncStore.send`, and decide how a `4xx` for it is handled in `SyncStore.fail`.
4. Expose a store command that enqueues the op and returns synchronously. Components call that command and move on.
5. Check the three states in the UI: the entry shows `local` right after the action, `syncing` while its request is in flight, and nothing once it is acknowledged.
