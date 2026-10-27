export type DocsSortField = "name" | "created" | "updated";
export type DocsSortDirection = "asc" | "desc";

export type DocsSortPreference = {
  field: DocsSortField;
  direction: DocsSortDirection;
};

export const DEFAULT_DOCS_SORT: DocsSortPreference = { field: "name", direction: "asc" };

const DOCS_SORT_KEY = "dotnote:docs-sort";

export function readDocsSort(): DocsSortPreference {
  if (typeof window === "undefined") return DEFAULT_DOCS_SORT;
  try {
    const raw = window.localStorage.getItem(DOCS_SORT_KEY);
    if (!raw) return DEFAULT_DOCS_SORT;
    const parsed = JSON.parse(raw) as Partial<DocsSortPreference>;
    const field = parsed.field === "created" || parsed.field === "updated" ? parsed.field : "name";
    const direction = parsed.direction === "desc" ? "desc" : "asc";
    return { field, direction };
  } catch {
    return DEFAULT_DOCS_SORT;
  }
}

export function writeDocsSort(pref: DocsSortPreference): void {
  try {
    window.localStorage.setItem(DOCS_SORT_KEY, JSON.stringify(pref));
  } catch {
    /* ignore */
  }
}
