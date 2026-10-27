const SHARE_PREFIX = "/s/";

export function parsePublicSharePath(pathname: string): string | null {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (!path.startsWith(SHARE_PREFIX)) return null;
  const token = path.slice(SHARE_PREFIX.length).split("/")[0]?.trim();
  return token || null;
}

export function publicSharePath(token: string): string {
  return `${SHARE_PREFIX}${encodeURIComponent(token)}`;
}

export function publicShareUrl(token: string): string {
  if (typeof window === "undefined") return publicSharePath(token);
  return `${window.location.origin}${publicSharePath(token)}`;
}
