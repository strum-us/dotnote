import { useEffect } from "react";

import { useDocumentSearch } from "./DocumentSearchProvider";

/**
 * Register a capture-phase ⌘K / Ctrl+K listener that toggles the document
 * search dialog. Capture phase + `stopImmediatePropagation` ensures the
 * hotkey wins over any component-level `k` handlers (e.g. editor shortcuts),
 * mirroring the command palette pattern.
 */
export function useDocumentSearchHotkey(): void {
  const store = useDocumentSearch();

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== "k") return;
      if (!(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      store.toggleOpen();
    };
    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [store]);
}
