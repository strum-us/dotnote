import type { ManifestEntry, TreeNode, WorkspaceManifest } from "./types";

export function emptyManifest(): WorkspaceManifest {
  return { version: 1, rev: 0, entries: [] };
}

export function manifestKey(workspaceId: string): string {
  return `workspaces/${workspaceId}/manifest.json`;
}

export function noteKey(workspaceId: string, noteId: string): string {
  return `workspaces/${workspaceId}/notes/${noteId}.md`;
}

/** Vault-relative page asset path (e.g. `folder/.noteId/image.webp`). */
export function pageAssetKey(workspaceId: string, relativePath: string): string {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return `workspaces/${workspaceId}/page-assets/${cleaned}`;
}

export function pageAssetPrefixForNote(workspaceId: string, notePath: string): string {
  const normalized = notePath.replace(/\\/g, "/").replace(/^\/+/, "");
  const dir = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
  const stem = normalized.split("/").pop()?.replace(/\.md$/i, "") ?? "untitled";
  const folder = `.${stem}`;
  const rel = dir ? `${dir}/${folder}/` : `${folder}/`;
  return pageAssetKey(workspaceId, rel);
}

export function historyIndexKey(workspaceId: string, noteId: string): string {
  return `workspaces/${workspaceId}/history/${noteId}/index.json`;
}

export function historySnapshotKey(
  workspaceId: string,
  noteId: string,
  backupId: string,
): string {
  return `workspaces/${workspaceId}/history/${noteId}/${backupId}.md`;
}

export function buildTree(entries: ManifestEntry[]): TreeNode[] {
  const folders = entries.filter((e) => e.type === "folder");
  const notes = entries.filter((e) => e.type === "note");
  const byParent = new Map<string, TreeNode[]>();

  const push = (parentPath: string, node: TreeNode) => {
    const list = byParent.get(parentPath) ?? [];
    list.push(node);
    byParent.set(parentPath, list);
  };

  for (const f of folders) {
    push(f.parentPath, {
      id: f.id,
      type: "folder",
      name: f.name,
      path: f.path,
      parentPath: f.parentPath,
      children: [],
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    });
  }
  for (const n of notes) {
    push(n.parentPath, {
      id: n.id,
      type: "note",
      name: n.name,
      path: n.path,
      parentPath: n.parentPath,
      createdAt: n.createdAt,
      updatedAt: n.updatedAt,
    });
  }

  const attach = (nodes: TreeNode[]): TreeNode[] =>
    nodes.map((node) => {
      if (node.type === "folder") {
        const kids = byParent.get(node.path) ?? [];
        return { ...node, children: attach(kids) };
      }
      return node;
    });

  return attach(byParent.get("") ?? []);
}

export function slugPath(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "untitled";
}

export function descendantsOf(entries: ManifestEntry[], folderPath: string): ManifestEntry[] {
  const prefix = `${folderPath}/`;
  return entries.filter((e) => e.path === folderPath || e.path.startsWith(prefix));
}

export function removeEntry(manifest: WorkspaceManifest, id: string): ManifestEntry[] {
  const entry = manifest.entries.find((e) => e.id === id);
  if (!entry) return [];
  const removed =
    entry.type === "folder" ? descendantsOf(manifest.entries, entry.path) : [entry];
  const removedIds = new Set(removed.map((e) => e.id));
  manifest.entries = manifest.entries.filter((e) => !removedIds.has(e.id));
  manifest.rev += 1;
  return removed;
}

export function renameEntry(manifest: WorkspaceManifest, id: string, name: string): ManifestEntry | null {
  const entry = manifest.entries.find((e) => e.id === id);
  if (!entry) return null;
  const trimmed = name.trim();
  if (entry.type === "note") {
    entry.name = trimmed.replace(/\.md$/i, "") || "Untitled";
    manifest.rev += 1;
    return entry;
  }
  const base = slugPath(trimmed);
  const others = manifest.entries.filter((e) => e.id !== id);
  const nextPath = uniquePath(others, entry.parentPath, base);
  const oldPath = entry.path;
  entry.name = trimmed;
  entry.path = nextPath;
  if (oldPath !== nextPath) {
    const prefix = `${oldPath}/`;
    for (const child of manifest.entries) {
      if (child.id === id) continue;
      if (child.path.startsWith(prefix)) child.path = nextPath + child.path.slice(oldPath.length);
      if (child.parentPath === oldPath || child.parentPath.startsWith(prefix)) {
        child.parentPath = nextPath + child.parentPath.slice(oldPath.length);
      }
    }
  }
  manifest.rev += 1;
  return entry;
}

/** True for the root (`""`) and for paths of existing folders. */
export function folderExists(entries: ManifestEntry[], path: string): boolean {
  return !path || entries.some((e) => e.type === "folder" && e.path === path);
}

/** Path of a folder by id. Unknown or missing parents resolve to the root. */
export function folderPathById(entries: ManifestEntry[], folderId: string | null): string {
  if (!folderId) return "";
  return entries.find((e) => e.id === folderId && e.type === "folder")?.path ?? "";
}

/** Insert a note entry. Idempotent by id, so a replayed create never duplicates a note. */
export function addNoteEntry(
  manifest: WorkspaceManifest,
  note: {
    id: string;
    parentPath: string;
    name: string;
    contentHash?: string;
    createdAt?: string;
    updatedAt?: string;
  },
): ManifestEntry {
  const existing = manifest.entries.find((e) => e.id === note.id);
  if (existing) return existing;
  const parentPath = folderExists(manifest.entries, note.parentPath) ? note.parentPath : "";
  const now = note.updatedAt ?? note.createdAt;
  const entry: ManifestEntry = {
    id: note.id,
    type: "note",
    name: note.name,
    path: uniquePath(manifest.entries, parentPath, note.id, ".md"),
    parentPath,
    contentHash: note.contentHash,
    createdAt: note.createdAt ?? now,
    updatedAt: note.updatedAt ?? now,
  };
  manifest.entries.push(entry);
  manifest.rev += 1;
  return entry;
}

/** Insert a folder entry. Idempotent by id, like `addNoteEntry`. */
export function addFolderEntry(
  manifest: WorkspaceManifest,
  folder: { id: string; parentPath: string; name: string; createdAt?: string; updatedAt?: string },
): ManifestEntry {
  const existing = manifest.entries.find((e) => e.id === folder.id);
  if (existing) return existing;
  const parentPath = folderExists(manifest.entries, folder.parentPath) ? folder.parentPath : "";
  const name = folder.name.trim();
  const now = folder.updatedAt ?? folder.createdAt;
  const entry: ManifestEntry = {
    id: folder.id,
    type: "folder",
    name,
    path: uniquePath(manifest.entries, parentPath, slugPath(name)),
    parentPath,
    createdAt: folder.createdAt ?? now,
    updatedAt: folder.updatedAt ?? now,
  };
  manifest.entries.push(entry);
  manifest.rev += 1;
  return entry;
}

function noteFileParts(notePath: string): { base: string; ext: string } {
  const file = notePath.replace(/\\/g, "/").split("/").pop() ?? "";
  if (file.toLowerCase().endsWith(".md")) return { base: file.slice(0, -3) || "untitled", ext: ".md" };
  return { base: file || "untitled", ext: "" };
}

/** Vault-relative path of the hidden page-asset folder beside a note. */
export function noteAssetFolderPath(notePath: string): string {
  const normalized = notePath.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const dir = slash >= 0 ? normalized.slice(0, slash) : "";
  const folder = `.${noteFileParts(normalized).base}`;
  return dir ? `${dir}/${folder}` : folder;
}

function relocateSubtree(
  manifest: WorkspaceManifest,
  rootId: string,
  oldPath: string,
  newPath: string,
  newParentPath: string,
): void {
  const prefix = `${oldPath}/`;
  for (const entry of manifest.entries) {
    if (entry.id === rootId) {
      entry.path = newPath;
      entry.parentPath = newParentPath;
      continue;
    }
    if (entry.path === oldPath || entry.path.startsWith(prefix)) {
      entry.path = newPath + entry.path.slice(oldPath.length);
    }
    if (entry.parentPath === oldPath || entry.parentPath.startsWith(prefix)) {
      entry.parentPath = newPath + entry.parentPath.slice(oldPath.length);
    }
  }
}

/** Move an entry under `parentPath`. Idempotent when already there. */
export function moveEntry(manifest: WorkspaceManifest, id: string, parentPath: string): ManifestEntry | null {
  const entry = manifest.entries.find((e) => e.id === id);
  if (!entry) return null;
  const dest = folderExists(manifest.entries, parentPath) ? parentPath : "";
  if (entry.type === "folder") {
    if (!entry.path || dest === entry.path || dest.startsWith(`${entry.path}/`)) return entry;
    if (entry.parentPath === dest) return entry;
    const base = entry.path.split("/").pop() || slugPath(entry.name);
    const blocked = new Set(
      manifest.entries.filter((e) => e.path === entry.path || e.path.startsWith(`${entry.path}/`)).map((e) => e.id),
    );
    const nextPath = uniquePath(
      manifest.entries.filter((e) => !blocked.has(e.id)),
      dest,
      base,
    );
    relocateSubtree(manifest, entry.id, entry.path, nextPath, dest);
    manifest.rev += 1;
    return entry;
  }
  if (entry.parentPath === dest) return entry;
  const { base, ext } = noteFileParts(entry.path);
  const oldPath = entry.path;
  const nextPath = uniquePath(
    manifest.entries.filter((e) => e.id !== entry.id),
    dest,
    base,
    ext,
  );
  entry.path = nextPath;
  entry.parentPath = dest;
  const asset = manifest.entries.find((e) => e.type === "folder" && e.path === noteAssetFolderPath(oldPath));
  const newAsset = noteAssetFolderPath(nextPath);
  if (asset && asset.path !== newAsset) relocateSubtree(manifest, asset.id, asset.path, newAsset, dest);
  manifest.rev += 1;
  return entry;
}

export function uniquePath(entries: ManifestEntry[], parentPath: string, base: string, ext = ""): string {
  let candidate = parentPath ? `${parentPath}/${base}${ext}` : `${base}${ext}`;
  let i = 2;
  const exists = (p: string) => entries.some((e) => e.path === p);
  while (exists(candidate)) {
    candidate = parentPath ? `${parentPath}/${base}-${i}${ext}` : `${base}-${i}${ext}`;
    i++;
  }
  return candidate;
}
