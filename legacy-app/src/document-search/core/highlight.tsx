import type { ReactNode } from "react";

/**
 * Highlight occurrences of `terms` inside `text` by wrapping them in `<mark>`.
 *
 * Matching is case-insensitive and covers whole-word and prefix matches so
 * `product` highlights the `product` prefix of `products`. Overlapping
 * matches are merged into a single span. Returns the original string when
 * there are no terms or no matches (so callers can skip rendering nodes).
 */
export function highlightMatches(text: string, terms: string[]): ReactNode {
  if (terms.length === 0) return text;
  const lower = text.toLowerCase();
  const ranges: Array<[number, number]> = [];
  for (const term of terms) {
    if (!term) continue;
    const needle = term.toLowerCase();
    let from = 0;
    while (from <= lower.length) {
      const idx = lower.indexOf(needle, from);
      if (idx === -1) break;
      ranges.push([idx, idx + needle.length]);
      from = idx + needle.length;
    }
  }
  if (ranges.length === 0) return text;
  ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (last && range[0] <= last[1]) {
      last[1] = Math.max(last[1], range[1]);
    } else {
      merged.push([range[0], range[1]]);
    }
  }
  const nodes: ReactNode[] = [];
  let cursor = 0;
  merged.forEach((range, i) => {
    if (range[0] > cursor) nodes.push(text.slice(cursor, range[0]));
    nodes.push(
      <mark key={i} className="rounded-sm bg-primary/20 text-foreground">
        {text.slice(range[0], range[1])}
      </mark>,
    );
    cursor = range[1];
  });
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
