import { resolveMarkdownAssetPath } from "@shared/page-assets";

export function publicShareAssetApiUrl(token: string, notePath: string, href: string): string | null {
  const relative = resolveMarkdownAssetPath(notePath, href);
  if (!relative) return null;
  const params = new URLSearchParams({ path: relative });
  return `/api/public/shares/${encodeURIComponent(token)}/assets?${params}`;
}
