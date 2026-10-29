import type { SearchResult } from "./types";

/**
 * Extract a short snippet around the first matched search term inside a
 * document body. Returns `null` when no term is found (e.g. title-only match).
 *
 * The snippet is padded with an ellipsis when truncated so the UI can show
 * context without re-running the search.
 */
export function extractSnippet(body: string, terms: string[], radius = 60): string | null {
  if (terms.length === 0) return null;
  const lower = body.toLowerCase();
  let earliest = -1;
  let matchedTerm = "";
  for (const term of terms) {
    if (!term) continue;
    const idx = lower.indexOf(term.toLowerCase());
    if (idx !== -1 && (earliest === -1 || idx < earliest)) {
      earliest = idx;
      matchedTerm = term;
    }
  }
  if (earliest === -1) return null;
  const start = Math.max(0, earliest - radius);
  const end = Math.min(body.length, earliest + matchedTerm.length + radius);
  const prefix = start > 0 ? "…" : "";
  const suffix = end < body.length ? "…" : "";
  return `${prefix}${body.slice(start, end).trim()}${suffix}`;
}

/** Map MiniSearch raw results into the `SearchResult` shape, attaching snippets. */
export function toSearchResults(
  raw: Array<{
    id: string;
    root: string;
    path: string;
    title: string;
    body: string;
    score: number;
  }>,
  terms: string[],
): SearchResult[] {
  return raw.map((hit) => ({
    id: hit.id,
    root: hit.root as SearchResult["root"],
    path: hit.path,
    title: hit.title,
    score: hit.score,
    snippet: extractSnippet(hit.body, terms),
  }));
}
