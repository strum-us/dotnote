import { resolveMarkdownAssetPath } from "@shared/page-assets";
import { apiUrl } from "@/lib/api-origin";

export function publicShareAssetApiUrl(token: string, notePath: string, href: string): string | null {
  const relative = resolveMarkdownAssetPath(notePath, href);
  if (!relative) return null;
  const params = new URLSearchParams({ path: relative });
  return apiUrl(`/api/public/shares/${encodeURIComponent(token)}/assets?${params}`);
}
