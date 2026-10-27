import type { WorkspaceManifest } from "@shared/types";
import {
  addFolderEntry,
  addNoteEntry,
  folderPathById,
  moveEntry,
  removeEntry,
  renameEntry,
} from "@shared/manifest";
import { titleFromMarkdown } from "@shared/title";

export type HistoryTrigger = "manual" | "auto";

/** A mutation recorded locally and replayed to the server in order. */
export type SyncOpBody =
  | { kind: "createWorkspace"; name: string }
  | {
      kind: "createNote";
      noteId: string;
      parentId: string | null;
      content: string;
      historyTrigger?: HistoryTrigger;
      at?: string;
    }
  | { kind: "createFolder"; folderId: string; parentId: string | null; name: string; at?: string }
  | { kind: "rename"; entryId: string; name: string }
  | { kind: "delete"; entryId: string }
  | { kind: "move"; entryId: string; parentId: string | null }
  | {
      kind: "saveNote";
      noteId: string;
      content: string;
      /** Hash of the server copy these edits build on; `undefined` skips the conflict check. */
      baseHash?: string;
      historyTrigger?: HistoryTrigger;
      at?: string;
    };

export type SyncOp = SyncOpBody & {
  opId: string;
  workspaceId: string;
  /** User who recorded the op; another account's ops wait in the queue untouched. */
  ownerId: string;
  /** Queue position; ops are sent in ascending order. */
  seq: number;
  createdAt: number;
  attempts: number;
  nextAttemptAt: number;
};

/** The tree entry an op changes. Workspace ops target the workspace itself. */
export function opTarget(op: SyncOp): string {
  switch (op.kind) {
    case "createWorkspace":
      return op.workspaceId;
    case "createNote":
    case "saveNote":
      return op.noteId;
    case "createFolder":
      return op.folderId;
    case "rename":
    case "delete":
    case "move":
      return op.entryId;
  }
}

export function isCreate(op: SyncOp): boolean {
  return op.kind === "createNote" || op.kind === "createFolder" || op.kind === "createWorkspace";
}

/**
 * Apply one op to a manifest the way the worker will. Every case is
 * idempotent, so replaying an op the server already applied is harmless.
 */
export function applyOp(manifest: WorkspaceManifest, op: SyncOpBody): void {
  switch (op.kind) {
    case "createWorkspace":
      return;
    case "createNote":
      addNoteEntry(manifest, {
        id: op.noteId,
        parentPath: folderPathById(manifest.entries, op.parentId),
        name: titleFromMarkdown(op.content),
        createdAt: op.at,
        updatedAt: op.at,
      });
      return;
    case "createFolder":
      addFolderEntry(manifest, {
        id: op.folderId,
        parentPath: folderPathById(manifest.entries, op.parentId),
        name: op.name,
        createdAt: op.at,
        updatedAt: op.at,
      });
      return;
    case "rename":
      renameEntry(manifest, op.entryId, op.name);
      return;
    case "delete":
      removeEntry(manifest, op.entryId);
      return;
    case "move":
      moveEntry(manifest, op.entryId, folderPathById(manifest.entries, op.parentId));
      return;
    case "saveNote": {
      const entry = manifest.entries.find((e) => e.id === op.noteId && e.type === "note");
      if (entry) {
        entry.name = titleFromMarkdown(op.content);
        if (op.at) entry.updatedAt = op.at;
      }
      return;
    }
  }
}

/** Server snapshot plus pending ops: what the user should see right now. */
export function replayOps(base: WorkspaceManifest, ops: SyncOpBody[]): WorkspaceManifest {
  if (ops.length === 0) return base;
  const manifest: WorkspaceManifest = { ...base, entries: base.entries.map((e) => ({ ...e })) };
  for (const op of ops) applyOp(manifest, op);
  return manifest;
}
