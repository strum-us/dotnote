import { useEffect } from "react";

/** Prevent the browser Save Page (⌘S) and Open File (⌘O) dialogs in the app shell. */
export function useBlockBrowserFileShortcuts(): void {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (key !== "s" && key !== "o") return;
      event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
