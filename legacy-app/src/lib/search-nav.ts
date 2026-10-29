import type { RootKey } from "@/lib/config";

/** Dotnote has a single document root. Workspace switching rebuilds the index. */
export function currentDocsRoot(): RootKey | null {
  return "notes";
}

type OpenNote = (noteId: string) => void;

let openNote: OpenNote | null = null;

export function setSearchNavigator(navigate: OpenNote | null): void {
  openNote = navigate;
}

export function navigate(_root: RootKey, path: string): void {
  const noteId = noteIdForPath(path);
  if (noteId) openNote?.(noteId);
}

type RecentRecorder = (root: RootKey, path: string, title: string) => void;

let recordRecent: RecentRecorder | null = null;

export function setRecentRecorder(record: RecentRecorder | null): void {
  recordRecent = record;
}

export function recordOpenedNote(path: string, title: string): void {
  recordRecent?.("notes", path, title);
}

const pathToId = new Map<string, string>();
const idToPath = new Map<string, string>();

type Node = {
  id: string;
  type: "folder" | "note";
  path: string;
  children?: Node[];
};

export function rememberSearchTree(nodes: Node[]): void {
  pathToId.clear();
  idToPath.clear();
  walk(nodes);
}

function walk(nodes: Node[]): void {
  for (const node of nodes) {
    if (node.type === "note") {
      pathToId.set(node.path, node.id);
      idToPath.set(node.id, node.path);
    }
    if (node.children) walk(node.children);
  }
}

export function noteIdForPath(path: string): string | null {
  return pathToId.get(path) ?? null;
}

export function pathForNoteId(noteId: string): string | null {
  return idToPath.get(noteId) ?? null;
}
