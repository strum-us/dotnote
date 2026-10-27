import { makeAutoObservable, runInAction } from "mobx";

import { ROOT_KEYS, type RootKey } from "@/lib/config";
import { currentDocsRoot } from "@/lib/search-nav";
import { fetchFile, subscribeFsEvents, type FsEvent } from "@/lib/search-io";
import {
  fetchIndexingSnapshot,
  fetchRecentsSnapshot,
  saveIndexingSnapshot,
  saveRecentsSnapshot,
} from "@/lib/document-search-api";
import { subscribeFileWrites } from "@/lib/file-write-events";
import {
  applyLocalDelete,
  applyLocalMove,
  applyLocalSave,
  handleFsEvent,
  rebuildIndex,
  extractTerms,
  nameMatchScore,
  type BuildProgress,
} from "@/document-search/core";
import {
  createIndexUpdateScheduler,
  type IndexUpdateScheduler,
} from "@/document-search/core/schedule-index-update";
import {
  InProcessSearchIndexEngine,
  type SearchIndexEngine,
} from "@/document-search/core/search-index-engine";
import { WorkerSearchIndexEngine } from "@/document-search/worker/worker-search-index-engine";
import type { SearchResult } from "@/document-search/core/types";
import type { RecentEntry } from "@/lib/document-search-api";

const RECENT_LIMIT = 5;
const RECENT_STORE_LIMIT = 50;
const SEARCH_DEBOUNCE_MS = 120;
const PERSIST_INDEX_DEBOUNCE_MS = 1000;

export type DocumentSearchProgress = BuildProgress;

function recentEntryId(root: RootKey, path: string): string {
  return `${root}:${path}`;
}

function toSearchResult(entry: RecentEntry): SearchResult {
  return {
    id: recentEntryId(entry.root, entry.path),
    root: entry.root,
    path: entry.path,
    title: entry.title,
    score: 0,
    snippet: null,
  };
}

/**
 * Rank search hits by how strongly their name fields (title, filename,
 * foldername, path) cover the query terms, then by MiniSearch relevance.
 * Recents are only used as a tie-break when name and relevance scores are
 * equal, so a path match like `products/duck-launcher` outranks a
 * body-only hit even when the body hit was recently opened.
 */
export function rankSearchResults(
  hits: SearchResult[],
  recents: RecentEntry[],
  terms: string[] = [],
): SearchResult[] {
  if (hits.length <= 1) return hits;
  const recentIdSet = new Set(
    recents.map((entry) => recentEntryId(entry.root, entry.path)),
  );
  const nameScores = new Map<string, number>();
  for (const hit of hits) {
    nameScores.set(hit.id, terms.length > 0 ? nameMatchScore(hit, terms) : 0);
  }
  return [...hits].sort((a, b) => {
    const byName = (nameScores.get(b.id) ?? 0) - (nameScores.get(a.id) ?? 0);
    if (byName !== 0) return byName;
    const byScore = b.score - a.score;
    if (byScore !== 0) return byScore;
    const aRecent = recentIdSet.has(a.id) ? 0 : 1;
    const bRecent = recentIdSet.has(b.id) ? 0 : 1;
    return aRecent - bRecent;
  });
}

/**
 * MobX store that owns the Cmd+K document search index lifecycle, dialog
 * open state, and query/results. Mirrors the `FileStore` / `AgentStore`
 * pattern: the React tree holds a single stable instance and components
 * observe only the fields they read.
 *
 * Search index snapshots and recently opened documents are persisted under
 * `~/.railmark/workspaces/[id]/indexing/` and `.../recents/`.
 */
export class DocumentSearchStore {
  open = false;
  query = "";
  results: SearchResult[] = [];
  progress: DocumentSearchProgress = {
    status: "idle",
    indexed: 0,
    total: 0,
  };
  /** Increments whenever the index contents change so an open dialog re-queries. */
  indexRevision = 0;
  /**
   * Which root Cmd+K is searching. Snapshotted from the current docs route
   * when the dialog opens; stays put while the dialog is open and when the
   * hash points at a non-docs route (e.g. `#/settings`).
   */
  searchRoot: RootKey = "notes";
  /** Per-root document counts, kept in sync with the engine for the footer. */
  rootSizes: Record<RootKey, number> = { notes: 0 };

  private engine: SearchIndexEngine;
  private readonly roots: RootKey[];
  private connected = false;
  private rebuildGeneration = 0;
  private rebuildAbort: AbortController | null = null;
  private searchTimer: ReturnType<typeof setTimeout> | null = null;
  private persistIndexTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduler: IndexUpdateScheduler | null = null;
  private unsubscribeFs: (() => void) | null = null;
  private unsubscribeWrites: (() => void) | null = null;
  /** Active engine — swapped to a fallback if the worker engine fails. */
  private activeEngine: SearchIndexEngine;
  private fallbackEngine: InProcessSearchIndexEngine | null = null;
  private recents: RecentEntry[] = [];
  /** In-flight engine reset from the last disconnect, so a reconnect cannot race it. */
  private idle: Promise<void> = Promise.resolve();
  private connectGeneration = 0;

  constructor(engine: SearchIndexEngine, roots: RootKey[] = [...ROOT_KEYS]) {
    this.engine = engine;
    this.activeEngine = engine;
    this.roots = roots;
    makeAutoObservable(this);
  }

  get isBuilding(): boolean {
    return this.progress.status === "building";
  }

  get hasError(): boolean {
    return this.progress.status === "error";
  }

  get footerLabel(): string {
    if (this.hasError) return "Indexing failed";
    if (this.isBuilding) {
      return this.progress.total > 0
        ? `Indexing ${this.progress.indexed}/${this.progress.total}…`
        : "Indexing…";
    }
    return `${this.rootSizes[this.searchRoot]} documents indexed`;
  }

  // --- Dialog -------------------------------------------------------------

  /**
   * Snapshot the current docs route's root into `searchRoot` so Cmd+K only
   * searches that root. When the hash points at a non-docs route (e.g.
   * `#/settings`), keep the previous `searchRoot` instead of falling back to
   * the `parseHash` default.
   */
  private snapshotSearchRoot(): void {
    const root = currentDocsRoot();
    if (root != null) this.searchRoot = root;
  }

  setOpen(open: boolean): void {
    if (open) this.snapshotSearchRoot();
    this.open = open;
  }

  toggleOpen(): void {
    if (!this.open) this.snapshotSearchRoot();
    this.open = !this.open;
  }

  setQuery(query: string): void {
    this.query = query;
    this.scheduleSearch();
  }

  /** Force a re-query (called after index changes while the dialog is open). */
  refreshResults(): void {
    this.scheduleSearch(true);
  }

  private scheduleSearch(immediate = false): void {
    if (this.searchTimer != null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    const run = () => {
      this.searchTimer = null;
      void this.runSearch();
    };
    if (immediate) {
      run();
    } else {
      this.searchTimer = setTimeout(run, SEARCH_DEBOUNCE_MS);
    }
  }

  private async runSearch(): Promise<void> {
    const trimmed = this.query.trim();
    const root = this.searchRoot;
    try {
      const results =
        trimmed.length === 0
          ? await this.resolveBlankQueryResults(root)
          : rankSearchResults(
              await this.activeEngine.search(trimmed, root),
              this.recents,
              extractTerms(trimmed),
            );
      runInAction(() => {
        this.results = results;
      });
    } catch {
      runInAction(() => {
        this.results = [];
      });
    }
  }

  // --- Recents persistence ------------------------------------------------

  /** Restore recently opened documents from disk. */
  async loadRecents(generation?: number): Promise<void> {
    try {
      const snapshot = await fetchRecentsSnapshot();
      if (generation != null && generation !== this.connectGeneration) return;
      runInAction(() => {
        this.recents = snapshot.entries.slice(0, RECENT_STORE_LIMIT);
      });
    } catch {
      if (generation != null && generation !== this.connectGeneration) return;
      runInAction(() => {
        this.recents = [];
      });
    }
    if (this.open && this.query.trim().length === 0) {
      this.refreshResults();
    }
  }

  /** Return persisted recents as search results for the blank-query fallback. */
  getRecentResults(limit: number, root?: RootKey): SearchResult[] {
    const scoped = root ? this.recents.filter((entry) => entry.root === root) : this.recents;
    return scoped.slice(0, limit).map(toSearchResult);
  }

  /**
   * Blank Cmd+K list: persisted recents first (up to `RECENT_LIMIT`), then
   * fill from the index so an empty recents file does not show a blank dialog.
   * Both sources are scoped to the current `searchRoot`.
   */
  private async resolveBlankQueryResults(root: RootKey): Promise<SearchResult[]> {
    const fromRecents = this.getRecentResults(RECENT_LIMIT, root);
    if (fromRecents.length >= RECENT_LIMIT) return fromRecents;
    const seen = new Set(fromRecents.map((result) => result.id));
    const fallback = await this.activeEngine.recent(RECENT_LIMIT, root);
    for (const hit of fallback) {
      if (seen.has(hit.id)) continue;
      fromRecents.push(hit);
      if (fromRecents.length >= RECENT_LIMIT) break;
    }
    return fromRecents;
  }

  /** Record a document open and persist to `~/.railmark/.../recents/`. */
  async recordRecent(root: RootKey, path: string, title: string): Promise<void> {
    const id = recentEntryId(root, path);
    const fallbackTitle = path.split("/").pop()?.replace(/\.md$/i, "") || path;
    const incoming = title.trim();
    const existing = this.recents.find((entry) => recentEntryId(entry.root, entry.path) === id);
    const resolvedTitle =
      incoming && incoming !== fallbackTitle
        ? incoming
        : existing?.title || incoming || fallbackTitle;
    const next: RecentEntry = {
      root,
      path,
      title: resolvedTitle,
      openedAt: new Date().toISOString(),
    };
    const filtered = this.recents.filter((entry) => recentEntryId(entry.root, entry.path) !== id);
    const entries = [next, ...filtered].slice(0, RECENT_STORE_LIMIT);

    runInAction(() => {
      this.recents = entries;
      if (this.open && this.query.trim().length === 0) {
        this.results = this.getRecentResults(RECENT_LIMIT, this.searchRoot);
      }
    });

    try {
      await saveRecentsSnapshot(entries);
    } catch {
      // ignore persistence failures (browser mode, offline, etc.)
    }
  }

  /** Drop a deleted or missing document from recents. */
  async removeRecent(root: RootKey, path: string): Promise<void> {
    const id = recentEntryId(root, path);
    const entries = this.recents.filter(
      (entry) => recentEntryId(entry.root, entry.path) !== id,
    );
    if (entries.length === this.recents.length) return;

    runInAction(() => {
      this.recents = entries;
      if (this.open && this.query.trim().length === 0) {
        this.results = this.getRecentResults(RECENT_LIMIT, this.searchRoot);
      }
    });

    try {
      await saveRecentsSnapshot(entries);
    } catch {
      // ignore persistence failures
    }
  }

  // --- Index persistence --------------------------------------------------

  /** Restore a persisted index snapshot into the active engine. */
  async loadPersistedIndex(generation?: number): Promise<boolean> {
    try {
      const snapshot = await fetchIndexingSnapshot();
      if (generation != null && generation !== this.connectGeneration) return false;
      if (!snapshot?.records?.length) return false;
      await this.activeEngine.replaceRecords(snapshot.records);
      if (generation != null && generation !== this.connectGeneration) {
        await this.activeEngine.reset();
        return false;
      }
      const size = snapshot.records.length;
      runInAction(() => {
        this.progress = { status: "ready", indexed: size, total: size };
        this.indexRevision++;
      });
      void this.refreshRootSizes();
      return true;
    } catch {
      return false;
    }
  }

  /** Export the in-memory index and write it to disk. */
  async persistIndex(): Promise<void> {
    try {
      const records = await this.activeEngine.exportRecords();
      if (records.length === 0) return;
      await saveIndexingSnapshot(records);
    } catch {
      // ignore persistence failures
    }
  }

  private schedulePersistIndex(): void {
    if (this.persistIndexTimer != null) {
      clearTimeout(this.persistIndexTimer);
    }
    this.persistIndexTimer = setTimeout(() => {
      this.persistIndexTimer = null;
      void this.persistIndex();
    }, PERSIST_INDEX_DEBOUNCE_MS);
  }

  /**
   * Query both per-root sizes from the engine so the footer can show the
   * count for the current `searchRoot`. Fired after rebuild, snapshot load,
   * and incremental updates.
   */
  private async refreshRootSizes(): Promise<void> {
    try {
      const sizes = await Promise.all(this.roots.map((root) => this.activeEngine.size(root)));
      const rootSizes = { notes: 0 } as Record<RootKey, number>;
      this.roots.forEach((root, index) => {
        rootSizes[root] = sizes[index] ?? 0;
      });
      runInAction(() => {
        this.rootSizes = rootSizes;
      });
    } catch {
      // ignore — footer falls back to the last known sizes
    }
  }

  private onIndexChanged(refreshOpenDialog = true): void {
    runInAction(() => {
      this.indexRevision++;
      if (refreshOpenDialog && this.open) this.refreshResults();
    });
    this.schedulePersistIndex();
    void this.refreshRootSizes();
  }

  // --- Lifecycle ----------------------------------------------------------

  /**
   * Connect or disconnect the index. On connect, restores persisted index
   * and recents when available, otherwise rebuilds from scratch.
   */
  setConnected(connected: boolean): void {
    if (this.connected === connected) return;
    this.connected = connected;

    if (!connected) {
      this.connectGeneration += 1;
      this.teardown();
      runInAction(() => {
        this.progress = { status: "idle", indexed: 0, total: 0 };
        this.results = [];
        this.recents = [];
        this.indexRevision = 0;
        this.rootSizes = { notes: 0 };
      });
      return;
    }

    const generation = ++this.connectGeneration;
    this.reviveEngine();
    void this.idle.then(() => {
      if (!this.connected || generation !== this.connectGeneration) return;
      this.setupSubscriptions();
      void this.initializeIndex(generation);
    });
  }

  /** Strict Mode disposes the worker on the fake unmount. Replace it before indexing. */
  private reviveEngine(): void {
    const current = this.engine;
    if (current instanceof WorkerSearchIndexEngine && (current.isDisposed || current.failed)) {
      const next = new WorkerSearchIndexEngine();
      if (this.activeEngine === this.engine) this.activeEngine = next;
      this.engine = next;
    }
  }

  private async initializeIndex(generation: number): Promise<void> {
    if (generation !== this.connectGeneration) return;
    await this.loadRecents(generation);
    if (generation !== this.connectGeneration) return;

    const loaded = await this.loadPersistedIndex(generation);
    if (generation !== this.connectGeneration) return;
    if (loaded) {
      if (this.open) this.refreshResults();
      return;
    }

    await this.startRebuild();
  }

  private async startRebuild(): Promise<void> {
    const generation = ++this.rebuildGeneration;
    this.rebuildAbort?.abort();
    const abort = new AbortController();
    this.rebuildAbort = abort;

    await this.doRebuild(this.activeEngine, generation, abort);

    if (
      this.progress.status === "error" &&
      this.activeEngine === this.engine
    ) {
      this.fallbackEngine ??= new InProcessSearchIndexEngine();
      this.activeEngine = this.fallbackEngine;
      const retryAbort = new AbortController();
      this.rebuildAbort = retryAbort;
      runInAction(() => {
        this.progress = { status: "building", indexed: 0, total: 0 };
      });
      await this.doRebuild(this.activeEngine, generation, retryAbort);
    }
  }

  private async doRebuild(
    engine: SearchIndexEngine,
    generation: number,
    abort: AbortController,
  ): Promise<void> {
    await rebuildIndex(engine, this.roots, (next) => {
      if (generation !== this.rebuildGeneration || abort.signal.aborted) return;
      runInAction(() => {
        this.progress = next;
        if (next.status === "ready") {
          this.indexRevision++;
          if (this.open) this.refreshResults();
        }
      });
    }, abort.signal);

    if (
      generation === this.rebuildGeneration &&
      !abort.signal.aborted &&
      this.progress.status === "ready"
    ) {
      const size = await engine.size();
      if (generation === this.rebuildGeneration) {
        runInAction(() => {
          this.progress = {
            status: "ready",
            indexed: size,
            total: size,
          };
        });
        void this.persistIndex();
        void this.refreshRootSizes();
      }
    }
  }

  private setupSubscriptions(): void {
    this.scheduler = createIndexUpdateScheduler(async (event) => {
      await handleFsEvent(this.activeEngine, event);
      this.onIndexChanged();
    });

    this.unsubscribeFs = subscribeFsEvents((event: FsEvent) => {
      if (event.type !== "fs") return;
      this.scheduler?.enqueue({
        event: event.event,
        root: event.root,
        path: event.path,
      });
    });

    this.unsubscribeWrites = subscribeFileWrites((event) => {
      if (event.type === "delete") {
        this.scheduler?.cancelFile(event.root, event.path);
        void applyLocalDelete(this.activeEngine, event.root, event.path).then(() => {
          this.onIndexChanged();
        });
        void this.removeRecent(event.root, event.path);
        return;
      }
      if (event.type === "move") {
        this.scheduler?.cancelFile(event.root, event.oldPath);
        this.scheduler?.cancelFile(event.root, event.newPath);
        void applyLocalMove(
          this.activeEngine,
          event.root,
          event.oldPath,
          event.newPath,
          (path) => fetchFile(event.root, path),
        ).then(() => {
          this.onIndexChanged();
        });
        void this.removeRecent(event.root, event.oldPath);
        return;
      }
      this.scheduler?.cancelFile(event.root, event.path);
      void applyLocalSave(this.activeEngine, event.root, event.path, event.content).then(() => {
        this.onIndexChanged();
      });
    });
  }

  private teardown(): void {
    this.rebuildAbort?.abort();
    this.rebuildAbort = null;
    this.scheduler?.dispose();
    this.scheduler = null;
    this.unsubscribeFs?.();
    this.unsubscribeFs = null;
    this.unsubscribeWrites?.();
    this.unsubscribeWrites = null;
    if (this.searchTimer != null) {
      clearTimeout(this.searchTimer);
      this.searchTimer = null;
    }
    if (this.persistIndexTimer != null) {
      clearTimeout(this.persistIndexTimer);
      this.persistIndexTimer = null;
    }
    this.idle = this.activeEngine.reset().then(
      () => undefined,
      () => undefined,
    );
  }

  dispose(): void {
    this.teardown();
    void this.engine.dispose();
    this.fallbackEngine?.dispose();
  }
}
