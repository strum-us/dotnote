import { resolveMarkdownAssetPath } from "@shared/page-assets";

export {
  classifyPageFile,
  extensionFromFilename,
  humanizeAssetFilename,
  pageAssetFilename,
  pageAssetMarkdownUrl,
  pageAssetRelativePath,
  resolveMarkdownAssetPath,
  type PageAssetKind,
} from "@shared/page-assets";

export function assetApiUrl(workspaceId: string, relativePath: string): string {
  const params = new URLSearchParams({ path: relativePath });
  return `/api/workspaces/${encodeURIComponent(workspaceId)}/assets?${params}`;
}

export function resolveMarkdownAssetHref(
  workspaceId: string,
  notePath: string,
  href: string,
): string | null {
  const normalized = resolveMarkdownAssetPath(notePath, href);
  if (!normalized) return null;
  return assetApiUrl(workspaceId, normalized);
}
