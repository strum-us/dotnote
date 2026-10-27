import type { TreeNode } from "@shared/types";
import { displayEntryName } from "@shared/title";
import type { DocsSortPreference } from "@/lib/docs-sort";
import { DEFAULT_DOCS_SORT } from "@/lib/docs-sort";

/** Dot-prefixed folders (page-asset dirs, import noise) stay in the manifest but not the Docs sidebar. */
export function isSidebarHiddenFolder(node: TreeNode): boolean {
  return node.type === "folder" && node.name.startsWith(".");
}

function sortKey(node: TreeNode, field: DocsSortPreference["field"]): string | number {
  if (field === "name") {
    const label = node.type === "note" ? displayEntryName(node.name) : node.name || "Untitled";
    return label.toLowerCase();
  }
  const raw = field === "created" ? node.createdAt ?? node.updatedAt : node.updatedAt ?? node.createdAt;
  if (!raw) return 0;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : 0;
}

function compareNodes(a: TreeNode, b: TreeNode, sort: DocsSortPreference): number {
  if (a.type !== b.type) return a.type === "folder" ? -1 : 1;
  const dir = sort.direction === "asc" ? 1 : -1;
  const av = sortKey(a, sort.field);
  const bv = sortKey(b, sort.field);
  let cmp = 0;
  if (typeof av === "number" && typeof bv === "number") cmp = av - bv;
  else cmp = String(av).localeCompare(String(bv));
  if (cmp !== 0) return cmp * dir;
  const nameCmp = displayEntryName(a.name).localeCompare(displayEntryName(b.name));
  if (nameCmp !== 0) return nameCmp;
  return a.id.localeCompare(b.id);
}

export function sortSidebarNodes(nodes: TreeNode[], sort: DocsSortPreference = DEFAULT_DOCS_SORT): TreeNode[] {
  return [...nodes].sort((a, b) => compareNodes(a, b, sort));
}

/** Drop hidden folders and hoist their children to the parent level. */
export function sidebarTree(nodes: TreeNode[], sort: DocsSortPreference = DEFAULT_DOCS_SORT): TreeNode[] {
  const out: TreeNode[] = [];
  for (const node of nodes) {
    if (isSidebarHiddenFolder(node)) {
      if (node.children?.length) out.push(...sidebarTree(node.children, sort));
      continue;
    }
    if (node.type === "folder") {
      out.push({ ...node, children: sidebarTree(node.children ?? [], sort) });
      continue;
    }
    out.push(node);
  }
  return sortSidebarNodes(out, sort);
}

export type FlatFolderRow = { id: string | null; name: string; depth: number; path: string };

/** Visible folders for move-to picker (root id is null). */
export function flattenSidebarFolders(nodes: TreeNode[], sort: DocsSortPreference = DEFAULT_DOCS_SORT): FlatFolderRow[] {
  const rows: FlatFolderRow[] = [{ id: null, name: "Docs", depth: 0, path: "" }];
  const walk = (list: TreeNode[], depth: number) => {
    for (const node of sidebarTree(list, sort)) {
      if (node.type !== "folder") continue;
      rows.push({ id: node.id, name: node.name || "Untitled", depth, path: node.path });
      if (node.children?.length) walk(node.children, depth + 1);
    }
  };
  walk(nodes, 1);
  return rows;
}

export function findTreeNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const child = node.children ? findTreeNode(node.children, id) : null;
    if (child) return child;
  }
  return null;
}

export function collectNoteIds(nodes: TreeNode[]): Set<string> {
  const ids = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const node of list) {
      if (node.type === "note") ids.add(node.id);
      if (node.children) walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

/** Expand folder paths so a note at `node.path` is visible in the tree. */
export function folderPathsToReveal(notePath: string): string[] {
  const parts = notePath.split("/").filter(Boolean);
  if (parts.length <= 1) return [];
  parts.pop();
  const paths: string[] = [];
  let acc = "";
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    paths.push(acc);
  }
  return paths;
}

export function noteLabelFromTree(nodes: TreeNode[], noteId: string): string | null {
  const node = findTreeNode(nodes, noteId);
  if (!node || node.type !== "note") return null;
  return node.name;
}

/** Ids of an entry and everything under it. */
export function subtreeIds(nodes: TreeNode[], id: string): string[] {
  const target = findTreeNode(nodes, id);
  if (!target) return [];
  const ids: string[] = [];
  const walk = (node: TreeNode) => {
    ids.push(node.id);
    node.children?.forEach(walk);
  };
  walk(target);
  return ids;
}

/** Note id → path for an entry and everything under it. */
export function notePathsUnder(nodes: TreeNode[], id: string): Map<string, string> {
  const target = findTreeNode(nodes, id);
  const paths = new Map<string, string>();
  if (!target) return paths;
  const walk = (node: TreeNode) => {
    if (node.type === "note") paths.set(node.id, node.path);
    node.children?.forEach(walk);
  };
  walk(target);
  return paths;
}

/** Replace one note's label, keeping every untouched node by reference. */
export function mapNoteTitle(nodes: TreeNode[], noteId: string, title: string): TreeNode[] {
  let changed = false;
  const next = nodes.map((node) => {
    if (node.id === noteId && node.type === "note") {
      if (node.name === title) return node;
      changed = true;
      return { ...node, name: title };
    }
    if (!node.children) return node;
    const children = mapNoteTitle(node.children, noteId, title);
    if (children === node.children) return node;
    changed = true;
    return { ...node, children };
  });
  return changed ? next : nodes;
}

/**
 * Reuse nodes from `prev` wherever `next` is unchanged, so rebuilding the
 * tree after every op only re-renders the rows that actually moved.
 */
export function shareTree(prev: TreeNode[], next: TreeNode[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  const index = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      byId.set(node.id, node);
      if (node.children) index(node.children);
    }
  };
  index(prev);
  const share = (nodes: TreeNode[], previous: TreeNode[] | undefined): TreeNode[] => {
    let same = previous?.length === nodes.length;
    const out = nodes.map((node, i) => {
      const old = byId.get(node.id);
      const children = node.children ? share(node.children, old?.children) : undefined;
      const reused =
        old &&
        old.type === node.type &&
        old.name === node.name &&
        old.path === node.path &&
        old.parentPath === node.parentPath &&
        old.createdAt === node.createdAt &&
        old.updatedAt === node.updatedAt &&
        old.children === children
          ? old
          : { ...node, ...(children ? { children } : {}) };
      if (reused !== previous?.[i]) same = false;
      return reused;
    });
    return same && previous ? previous : out;
  };
  return share(next, prev);
}
