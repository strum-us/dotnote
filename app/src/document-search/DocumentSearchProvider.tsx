import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";

import { ROOT_KEYS, type RootKey } from "@/lib/config";
import { DocumentSearchStore } from "@/stores/document-search-store";
import { InProcessSearchIndexEngine } from "./core/search-index-engine";
import { WorkerSearchIndexEngine } from "./worker/worker-search-index-engine";

const DocumentSearchContext = createContext<DocumentSearchStore | null>(null);

type ProviderProps = {
  /** Rebuild the index when the active workspace id changes. */
  vaultId: string | null;
  /** Roots to index. Defaults to all `ROOT_KEYS`. */
  roots?: RootKey[];
  /**
   * Override the engine (tests inject an `InProcessSearchIndexEngine` with
   * mocked I/O). Defaults to a `WorkerSearchIndexEngine` in production and
   * an `InProcessSearchIndexEngine` when Web Workers are unavailable.
   */
  engine?: ReturnType<typeof createDefaultEngine>;
  children: ReactNode;
};

function createDefaultEngine() {
  if (typeof Worker !== "undefined") {
    try {
      return new WorkerSearchIndexEngine();
    } catch {
      // fall through to in-process
    }
  }
  return new InProcessSearchIndexEngine();
}

/**
 * Provides a single stable `DocumentSearchStore` to the React tree.
 *
 * The store owns the Cmd+K dialog open state, query/results, and the index
 * build lifecycle. It is a MobX store (like `FileStore`), so components
 * observe only the fields they read — the editor and file tree never
 * re-render from indexing progress. All normalization + MiniSearch work is
 * delegated to a `SearchIndexEngine` running off the main thread.
 */
export function DocumentSearchProvider({
  vaultId,
  roots = ROOT_KEYS as unknown as RootKey[],
  engine,
  children,
}: ProviderProps) {
  const store = useMemo(() => {
    const resolvedEngine = engine ?? createDefaultEngine();
    return new DocumentSearchStore(resolvedEngine, [...roots]);
  }, [engine, roots]);

  useEffect(() => {
    store.setConnected(false);
    if (vaultId) store.setConnected(true);
  }, [vaultId, store]);

  useEffect(() => {
    return () => store.dispose();
  }, [store]);

  return (
    <DocumentSearchContext.Provider value={store}>
      {children}
    </DocumentSearchContext.Provider>
  );
}

export function useDocumentSearch(): DocumentSearchStore {
  const store = useContext(DocumentSearchContext);
  if (!store) {
    throw new Error("useDocumentSearch must be used within a DocumentSearchProvider");
  }
  return store;
}
