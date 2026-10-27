const PREFIX = "/entry-sample";

export type ParsedEntrySamplePath = {
  workspaceId: string | null;
  noteId: string | null;
};

function normalizePath(pathname: string): string {
  return pathname.replace(/\/+$/, "") || "/";
}

export function parseEntrySamplePath(pathname: string): ParsedEntrySamplePath | null {
  const path = normalizePath(pathname);
  if (path === PREFIX) return { workspaceId: null, noteId: null };
  if (!path.startsWith(`${PREFIX}/`)) return null;

  const rest = path.slice(PREFIX.length + 1);
  const segments = rest.split("/").filter(Boolean);
  if (segments.length === 0) return { workspaceId: null, noteId: null };
  if (segments.length > 2) return null;

  const workspaceId = decodeURIComponent(segments[0]!);
  const noteId = segments.length === 2 ? decodeURIComponent(segments[1]!) : null;
  return { workspaceId, noteId };
}

export function isEntrySamplePath(pathname: string): boolean {
  return parseEntrySamplePath(pathname) !== null;
}
