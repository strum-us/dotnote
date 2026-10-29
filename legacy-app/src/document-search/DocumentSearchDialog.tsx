import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { observer } from "mobx-react-lite";
import { FileText, Loader2 } from "lucide-react";

import {
  CommandDialog,
  CommandEmpty,
  CommandFooter,
  CommandFooterItem,
  CommandFooterKey,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navigate } from "@/lib/search-nav";
import { useDocumentSearch } from "./DocumentSearchProvider";
import { extractTerms } from "./core";
import { highlightMatches } from "./core/highlight";
import type { SearchResult } from "./core";

function resultItemValue(result: SearchResult): string {
  return result.id;
}

/**
 * Cmd+K document search dialog (Notion-style file search).
 *
 * Renders only documents — no commands or settings entries. Filtering is
 * delegated to the `DocumentSearchStore`'s engine (MiniSearch in a Web
 * Worker), so `cmdk`'s built-in filter is disabled via `shouldFilter={false}`.
 * A blank query shows the 5 most recently opened documents (filled from the
 * index when recents are empty). Search hits that are also recents are
 * sorted first.
 *
 * This component is a MobX `observer`; it re-renders only when the store
 * fields it reads (`open`, `query`, `results`, `progress`) change. The
 * editor and file tree never observe these fields and are unaffected by
 * indexing progress.
 */
export const DocumentSearchDialog = observer(function DocumentSearchDialog({
  onSelect,
}: {
  /** Called after a result is selected (and the dialog closed). */
  onSelect?: (root: SearchResult["root"], path: string) => void;
}) {
  const store = useDocumentSearch();
  const terms = extractTerms(store.query);
  const listRef = useRef<HTMLDivElement>(null);
  const [userSelected, setUserSelected] = useState<string | undefined>(undefined);
  const [selectionQuery, setSelectionQuery] = useState(store.query);

  const rootLabel = "notes";
  const placeholder = `Search ${rootLabel}…`;
  const description = `Search Markdown documents in ${rootLabel}`;

  // While the query is changing (user is typing), always highlight the first
  // result so Enter opens it. Drop any prior arrow-key selection on the same
  // render as the query update so cmdk cannot keep a mid-list item selected.
  if (store.query !== selectionQuery) {
    setSelectionQuery(store.query);
    setUserSelected(undefined);
  }

  const firstValue = store.results[0] ? resultItemValue(store.results[0]) : "";
  const selectedStillVisible =
    userSelected != null &&
    store.results.some((result) => resultItemValue(result) === userSelected);
  const selectedValue = selectedStillVisible ? userSelected : firstValue;

  // Re-query when the index changes while the dialog is open.
  useEffect(() => {
    if (!store.open) return;
    store.refreshResults();
  }, [store, store.indexRevision, store.open]);

  // Reset the query when the dialog closes so it reopens clean.
  useEffect(() => {
    if (!store.open) {
      store.setQuery("");
      setUserSelected(undefined);
    }
  }, [store, store.open]);

  // Keep the list pinned to the top whenever the query or leading result
  // changes. cmdk otherwise scrollIntoView()s a previously selected item.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = 0;
  }, [store.query, firstValue]);

  return (
    <CommandDialog
      open={store.open}
      onOpenChange={store.setOpen.bind(store)}
      title="Search documents"
      description={description}
      shouldFilter={false}
      value={selectedValue}
      onValueChange={setUserSelected}
    >
      <CommandInput
        placeholder={placeholder}
        value={store.query}
        onValueChange={(value) => store.setQuery(value)}
      />
      <CommandList ref={listRef}>
        <CommandEmpty>
          {store.isBuilding
            ? "Indexing documents…"
            : store.hasError
              ? "Indexing failed. Try reopening the vault."
              : "No documents found."}
        </CommandEmpty>
        {store.results.length > 0 ? (
          <CommandGroup heading={store.query.trim() ? "Results" : "Recent"}>
            {store.results.map((result) => (
              <CommandItem
                key={result.id}
                value={resultItemValue(result)}
                onSelect={() => {
                  store.setOpen(false);
                  void store.recordRecent(result.root, result.path, result.title);
                  navigate(result.root, result.path);
                  onSelect?.(result.root, result.path);
                }}
              >
                <FileText />
                <div className="flex min-w-0 flex-col">
                  <span className="truncate text-foreground">
                    {highlightMatches(result.title, terms)}
                  </span>
                  <span className="truncate text-xs text-muted-foreground/80">
                    {highlightMatches(result.path.includes("/") ? result.path.split("/").slice(0, -1).join(" / ") : "Note", terms)}
                  </span>
                  {result.snippet ? (
                    <span className="truncate text-xs text-muted-foreground/60">
                      {highlightMatches(result.snippet, terms)}
                    </span>
                  ) : null}
                </div>
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
      </CommandList>
      <CommandFooter>
        <CommandFooterItem
          keys={
            <>
              <CommandFooterKey>↑</CommandFooterKey>
              <CommandFooterKey>↓</CommandFooterKey>
            </>
          }
          label="Select"
        />
        <CommandFooterItem keys={<CommandFooterKey>⏎</CommandFooterKey>} label="Open" />
        <CommandFooterItem keys={<CommandFooterKey>esc</CommandFooterKey>} label="Close" />
        <span className="ml-auto flex items-center gap-1.5">
          {store.isBuilding ? (
            <Loader2 className="size-3.5 animate-spin text-muted-foreground" />
          ) : null}
          {store.footerLabel}
        </span>
      </CommandFooter>
    </CommandDialog>
  );
});
