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

/** `window.location.pathname` with the Vite base removed. React Router already does this. */
export function locationAppPath(): string {
  if (typeof window === "undefined") return "/";
  const path = window.location.pathname;
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  if (!base) return path;
  if (path === base) return "/";
  if (path.startsWith(`${base}/`)) return path.slice(base.length) || "/";
  return path;
}

/** Full-page navigations ignore the router basename, so prefix the base ourselves. */
export function absoluteAppPath(path: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

