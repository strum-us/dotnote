export type OpenNoteHistory = "push" | "replace" | "none";

export type OpenNoteOptions = {
  skipHistory?: boolean;
  history?: OpenNoteHistory;
};

export type ParsedNotePath =
  | { kind: "workspace"; workspaceId: string }
  | { kind: "note"; workspaceId: string; noteId: string };

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

function isReservedAppPath(path: string): boolean {
  return path === "/settings" || path.startsWith("/settings/") || path.startsWith("/s/");
}

export function parseNotePath(pathname: string): ParsedNotePath | null {
  const path = normalizePath(pathname);
  if (path === "/" || isReservedAppPath(path)) return null;

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > 2) return null;

  const workspaceId = decodeURIComponent(segments[0]!);
  if (segments.length === 1) return { kind: "workspace", workspaceId };

  const noteId = decodeURIComponent(segments[1]!);
  return { kind: "note", workspaceId, noteId };
}

export function notePath(workspaceId: string, noteId?: string | null): string {
  const ws = encodeURIComponent(workspaceId);
  if (!noteId) return `/${ws}`;
  return `/${ws}/${encodeURIComponent(noteId)}`;
}

