import { isRootKey, type RootKey } from "@/lib/config";
import { extractFirstMarkdownHeading, normalizeContent } from "./normalize-content";
import type { DocumentRecord } from "./types";

/**
 * Derive a human-readable title for a document.
 *
 * Prefers the first Markdown heading (`#`–`######`) in the body after
 * frontmatter is removed. YAML `title:` and other property lines are never
 * used. Falls back to the filename stem (last path segment without extension).
 */
export function deriveTitle(rawContent: string, path: string): string {
  return extractFirstMarkdownHeading(rawContent) ?? displayStem(filenameStem(path));
}

const UUID_STEM = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-\d+)?$/i;

function displayStem(stem: string): string {
  return UUID_STEM.test(stem) ? "Untitled" : stem;
}

/** Last path segment with its extension removed. */
export function filenameStem(path: string): string {
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Build a `DocumentRecord` from raw file content.
 *
 * `root` is validated against `ROOT_KEYS`; an unknown value returns `null` so
 * a stray fs event for an unsupported root cannot poison the index.
 */
export function buildRecord(
  root: string,
  path: string,
  rawContent: string,
): DocumentRecord | null {
  if (!isRootKey(root)) return null;
  const rootKey = root as RootKey;
  return {
    id: `${rootKey}:${path}`,
    root: rootKey,
    path,
    title: deriveTitle(rawContent, path),
    body: normalizeContent(rawContent),
  };
}

export { normalizeContent };
