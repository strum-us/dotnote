import type { TreeNode } from "@shared/types";
import { noteApi, workspaceApi } from "@/lib/api";
import type { RootKey } from "@/lib/config";
import { readCache } from "@/lib/idb-cache";
import { noteIdForPath, rememberSearchTree } from "@/lib/search-nav";
import { syncStore } from "@/stores/sync-store";
import { workspaceStore } from "@/stores/workspace-store";

export type { TreeNode };

export type FsEvent = {
  type: "fs";
  event?: string;
  root?: RootKey;
  path?: string;
};

/** Tree walk used by the Cmd+K index builder. */
export async function fetchTree(_root: RootKey): Promise<TreeNode[]> {
  const id = workspaceStore.activeId;
  if (!id) return [];
  if (workspaceStore.treeReady) {
    rememberSearchTree(workspaceStore.viewTree);
    return workspaceStore.viewTree;
  }
  const { tree } = await workspaceApi.tree(id);
  rememberSearchTree(tree);
  return tree;
}

/** Note body for one path. Pending local content first, then network, then IndexedDB. */
export async function fetchFile(
  _root: RootKey,
  path: string,
  _options?: { prefetchAssets?: boolean },
): Promise<string> {
  const workspaceId = workspaceStore.activeId;
  const noteId = noteIdForPath(path);
  if (!workspaceId || !noteId) return "";
  const local = syncStore.latestContent(workspaceId, noteId);
  if (local !== null) return local;
  try {
    const data = await noteApi.get(workspaceId, noteId);
    return data.content;
  } catch {
    const cached = await readCache<{ content: string }>(`note:${workspaceId}:${noteId}`, "notes");
    return cached?.content ?? "";
  }
}

/** Dotnote has no filesystem watcher. In-app saves update the index directly. */
export function subscribeFsEvents(_listener: (event: FsEvent) => void): () => void {
  return () => {};
}
