import { filenameStem } from "./build-record";

/**
 * Path-derived name fields indexed alongside `title`/`body` so Cmd+K can
 * rank filename and folder matches above body hits.
 *
 * All three are tokenized by the same `/ - _ whitespace` splitter as the
 * query, so `products/duck-launcher` is searchable as `product duck`.
 */

/** `duck-launcher.md` → `duck-launcher` (extension stripped). */
export function filenameField(path: string): string {
  return filenameStem(path);
}

/** Parent folder segments joined by space: `products/duck-launcher/readme.md` → `products duck-launcher`. */
export function foldernameField(path: string): string {
  const segments = path.split("/").slice(0, -1);
  return segments.filter(Boolean).join(" ");
}

/** Combined name bag: title + filename + foldername, for AND matching. */
export function namesField(title: string, path: string): string {
  return [title, filenameField(path), foldernameField(path)]
    .filter(Boolean)
    .join(" ");
}
