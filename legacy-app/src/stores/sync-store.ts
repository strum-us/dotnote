import { makeAutoObservable, observable, observableRef, runInAction } from "mobx";
import type { ManifestEntry, Workspace, WorkspaceManifest } from "@shared/types";
import { emptyManifest, folderPathById } from "@shared/manifest";
import { ApiError, noteApi, workspaceApi } from "@/lib/api";
import {
  deleteCache,
  deleteLegacyDraft,
  deleteSyncOp,
  readCache,
  readLegacyDrafts,
  readSyncOps,
  writeCache,
  writeSyncOp,
} from "@/lib/idb-cache";
import {
  isCreate,
  opTarget,
  replayOps,
  type HistoryTrigger,
  type SyncOp,
  type SyncOpBody,
} from "@/lib/sync-ops";

/** `local`: changed here, not on the server yet. `syncing`: request in flight. */
export type SyncState = "local" | "syncing" | "synced";

/** Manifest snapshot load for a workspace (IndexedDB + server revalidate). */
export type ManifestLoadState = "idle" | "loading" | "ready" | "error";

export type SyncEvent =
  | { type: "noteSaved"; workspaceId: string; noteId: string; content: string; contentHash: string }
  | { type: "noteRenamed"; workspaceId: string; noteId: string; contentHash?: string }
  | { type: "workspaceCreated"; workspace: Workspace }
  | { type: "entriesRemoved"; workspaceId: string; ids: string[] }
  | { type: "noteDiscarded"; workspaceId: string; noteId: string }
  | { type: "rejected"; op: SyncOp; status: number };

const RETRY_DELAYS = [1000, 3000, 10_000, 30_000];
const BASE_PERSIST_MS = 1000;
const LEGACY_OUTBOX_KEY = "dotnote-outbox";
/** 4xx answers that are worth retrying rather than dropping the op. */
const RETRYABLE_STATUS = new Set([401, 403, 408, 425, 429]);

function entityKey(workspaceId: string, id: string): string {
  return `${workspaceId}:${id}`;
}

export function manifestCacheKey(workspaceId: string): string {
  return `manifest:${workspaceId}`;
}

function mergeTrigger(a?: HistoryTrigger, b?: HistoryTrigger): HistoryTrigger | undefined {
  if (a === "manual" || b === "manual") return "manual";
  return a ?? b;
}

/**
 * The sync engine. Mutations land here as ops, are persisted to IndexedDB,
 * and are sent to the worker one at a time in order. It also holds the last
 * server manifest per workspace; the visible tree is that snapshot with the
 * pending ops replayed on top (see docs/local-first.md).
 */
class SyncStore {
  ready = false;
  ops: SyncOp[] = [];
  inflightOpId: string | null = null;
  /** Last manifest acknowledged by the server, per workspace. Replaced, never mutated. */
  bases = observable.map<string, WorkspaceManifest>(undefined, { deep: false });
  /** Notes whose save hit a 409, keyed `${workspaceId}:${noteId}`, with the server's hash. */
  conflicts = observable.map<string, string>();
  /** The last request failed for a transient reason and the queue is backing off. */
  retrying = false;
  /** Per-workspace manifest hydrate/revalidate (see `manifestLoadState`). */
  baseLoadStates = observable.map<string, ManifestLoadState>();
  userId: string | null = null;
  syncDisabled = false;

  private seq = 0;
  private baseRefreshInFlight = new Map<string, Promise<void>>();
  private pumping = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private persistChain: Promise<void> = Promise.resolve();
  private basePersistTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** Entries deleted this session; late saves for them are ignored instead of resurrecting them. */
  private tombstones = new Set<string>();
  private listeners = new Set<(event: SyncEvent) => void>();
  private loadPromise: Promise<void> | null = null;

  constructor() {
    makeAutoObservable<
      SyncStore,
      | "seq"
      | "pumping"
      | "retryTimer"
      | "persistChain"
      | "basePersistTimers"
      | "tombstones"
      | "listeners"
      | "loadPromise"
      | "baseRefreshInFlight"
    >(
      this,
      {
        ops: observableRef,
        seq: false,
        pumping: false,
        retryTimer: false,
        persistChain: false,
        basePersistTimers: false,
        tombstones: false,
        listeners: false,
        loadPromise: false,
        baseRefreshInFlight: false,
      },
      { autoBind: true },
    );
  }

  /** Ops for the signed-in user, in send order. */
  get ownOps(): SyncOp[] {
    return this.ops.filter((op) => op.ownerId === this.userId);
  }

  get inflightOp(): SyncOp | null {
    return this.ops.find((op) => op.opId === this.inflightOpId) ?? null;
  }

  /** Sync state per `${workspaceId}:${entryId}`. Entries not listed are synced. */
  get entryStates(): Map<string, SyncState> {
    const states = new Map<string, SyncState>();
    for (const op of this.ownOps) states.set(entityKey(op.workspaceId, opTarget(op)), "local");
    const inflight = this.inflightOp;
    if (inflight) states.set(entityKey(inflight.workspaceId, opTarget(inflight)), "syncing");
    return states;
  }

  get pendingWorkspaces(): Workspace[] {
    return this.ownOps
      .filter((op) => op.kind === "createWorkspace")
      .map((op) => ({
        id: op.workspaceId,
        name: op.kind === "createWorkspace" ? op.name : "",
        createdAt: new Date(op.createdAt).toISOString(),
      }));
  }

  entryState(workspaceId: string, entryId: string): SyncState {
    return this.entryStates.get(entityKey(workspaceId, entryId)) ?? "synced";
  }

  hasPending(workspaceId: string, entryId: string): boolean {
    return this.entryStates.has(entityKey(workspaceId, entryId));
  }

  hasConflict(workspaceId: string, noteId: string): boolean {
    return this.conflicts.has(entityKey(workspaceId, noteId));
  }

  /** True until the server acknowledges the entry's create. */
  isLocalOnly(workspaceId: string, entryId: string): boolean {
    return this.ownOps.some((op) => op.workspaceId === workspaceId && isCreate(op) && opTarget(op) === entryId);
  }

  /** Newest content queued for a note, or `null` when nothing is pending. */
  latestContent(workspaceId: string, noteId: string): string | null {
    const ops = this.ownOps;
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i]!;
      if (op.workspaceId !== workspaceId) continue;
      if ((op.kind === "saveNote" || op.kind === "createNote") && op.noteId === noteId) return op.content;
    }
    return null;
  }

  pendingRename(workspaceId: string, entryId: string): string | null {
    const ops = this.ownOps;
    for (let i = ops.length - 1; i >= 0; i--) {
      const op = ops[i]!;
      if (op.workspaceId === workspaceId && op.kind === "rename" && op.entryId === entryId) return op.name;
    }
    return null;
  }

  base(workspaceId: string): WorkspaceManifest | null {
    return this.bases.get(workspaceId) ?? null;
  }

  manifestLoadState(workspaceId: string | null): ManifestLoadState {
    if (!workspaceId) return "idle";
    if (this.bases.has(workspaceId)) return "ready";
    return this.baseLoadStates.get(workspaceId) ?? "idle";
  }

  /** Server snapshot with this workspace's pending ops replayed on top. */
  view(workspaceId: string): WorkspaceManifest {
    const ops = this.ownOps.filter((op) => op.workspaceId === workspaceId);
    return replayOps(this.bases.get(workspaceId) ?? emptyManifest(), ops);
  }

  subscribe(listener: (event: SyncEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Resolves once every op queued so far is in IndexedDB, so a reload cannot drop it. */
  persisted(): Promise<void> {
    return this.persistChain;
  }

  /** Load the durable queue for `userId` and start sending. Safe to call again on sign-in. */
  async start(userId: string, options?: { syncDisabled?: boolean }): Promise<void> {
    this.userId = userId;
    this.syncDisabled = options?.syncDisabled ?? false;
    this.loadPromise ??= this.load();
    await this.loadPromise;
    this.pump();
  }

  private async load(): Promise<void> {
    const stored = await readSyncOps<SyncOp>().catch(() => [] as SyncOp[]);
    runInAction(() => {
      // A fresh page load is a good moment to retry; backoff from the last session does not carry over.
      this.ops = stored.sort((a, b) => a.seq - b.seq).map((op) => ({ ...op, nextAttemptAt: 0 }));
      this.seq = this.ops.reduce((max, op) => Math.max(max, op.seq), 0);
    });
    await this.migrateLegacy();
    runInAction(() => {
      this.ready = true;
    });
    window.addEventListener("online", this.retryNow);
    window.addEventListener("focus", this.retryNow);
  }

  /** Earlier builds kept unsent edits in a localStorage outbox and a drafts database. */
  private async migrateLegacy(): Promise<void> {
    let outbox: Array<{ workspaceId: string; noteId: string; content: string; baseHash?: string }> = [];
    try {
      outbox = JSON.parse(localStorage.getItem(LEGACY_OUTBOX_KEY) ?? "[]");
    } catch {
      /* unreadable outbox: drafts below still carry the content */
    }
    const drafts = await readLegacyDrafts().catch(() => []);
    runInAction(() => {
      for (const op of outbox) {
        this.enqueue(op.workspaceId, { kind: "saveNote", noteId: op.noteId, content: op.content, baseHash: op.baseHash });
      }
      for (const { key, value } of drafts) {
        const [, workspaceId, noteId] = key.split(":");
        if (!workspaceId || !noteId || this.latestContent(workspaceId, noteId) !== null) continue;
        this.enqueue(workspaceId, { kind: "saveNote", noteId, content: value.content, baseHash: value.contentHash });
      }
    });
    try {
      localStorage.removeItem(LEGACY_OUTBOX_KEY);
    } catch {
      /* storage unavailable */
    }
    await Promise.all(drafts.map((draft) => deleteLegacyDraft(draft.key))).catch(() => {});
  }

  /** Record a mutation. Returns synchronously; the request happens in the background. */
  enqueue(workspaceId: string, body: SyncOpBody): void {
    if (body.kind === "saveNote" && this.tombstones.has(entityKey(workspaceId, body.noteId))) return;
    if (!this.coalesce(workspaceId, body)) {
      const op = {
        ...body,
        opId: crypto.randomUUID(),
        workspaceId,
        ownerId: this.userId ?? "",
        seq: ++this.seq,
        createdAt: Date.now(),
        attempts: 0,
        nextAttemptAt: 0,
      } as SyncOp;
      this.ops = [...this.ops, op];
      this.persistOp(op);
    }
    this.pump();
  }

  /**
   * Delete an entry and everything under it. Pending ops for those entries
   * are dropped, and when the server never received the entry's create, no
   * request is sent at all.
   */
  enqueueDelete(workspaceId: string, entryId: string, descendantIds: string[]): void {
    const removed = new Set([entryId, ...descendantIds]);
    for (const id of removed) {
      this.tombstones.add(entityKey(workspaceId, id));
      this.conflicts.delete(entityKey(workspaceId, id));
    }
    const mine = (op: SyncOp) =>
      op.workspaceId === workspaceId && op.ownerId === this.userId && op.opId !== this.inflightOpId;
    const neverSent = this.ops.some(
      (op) => mine(op) && isCreate(op) && opTarget(op) === entryId && op.attempts === 0,
    );
    this.removeOps(this.ops.filter((op) => mine(op) && removed.has(opTarget(op))));
    this.emit({ type: "entriesRemoved", workspaceId, ids: [...removed] });
    if (!neverSent) this.enqueue(workspaceId, { kind: "delete", entryId });
  }

  /** True when the workspace exists only as a pending createWorkspace op. */
  isPendingCreateWorkspace(workspaceId: string): boolean {
    return this.isLocalOnly(workspaceId, workspaceId);
  }

  /** Update the name on a not-yet-synced createWorkspace op. */
  updatePendingCreateWorkspaceName(workspaceId: string, name: string): boolean {
    const trimmed = name.trim().slice(0, 80);
    if (!trimmed) return false;
    let updated = false;
    this.ops = this.ops.map((op) => {
      if (
        op.workspaceId !== workspaceId ||
        op.ownerId !== this.userId ||
        op.kind !== "createWorkspace" ||
        op.opId === this.inflightOpId
      ) {
        return op;
      }
      updated = true;
      const next = { ...op, name: trimmed };
      this.persistOp(next);
      return next;
    });
    return updated;
  }

  /** Drop local sync state for a workspace (after delete or abandoning a pending create). */
  discardWorkspace(workspaceId: string): void {
    const mine = (op: SyncOp) => op.workspaceId === workspaceId && op.ownerId === this.userId;
    const toRemove = this.ops.filter(mine);
    this.removeOps(toRemove);
    const inflight = this.inflightOpId ? this.ops.find((op) => op.opId === this.inflightOpId) : null;
    if (!inflight || inflight.workspaceId === workspaceId) this.inflightOpId = null;
    this.bases.delete(workspaceId);
    const timer = this.basePersistTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.basePersistTimers.delete(workspaceId);
    }
    for (const key of [...this.conflicts.keys()]) {
      if (key.startsWith(`${workspaceId}:`)) this.conflicts.delete(key);
    }
    for (const key of [...this.tombstones]) {
      if (key.startsWith(`${workspaceId}:`)) this.tombstones.delete(key);
    }
    void deleteCache(manifestCacheKey(workspaceId), "trees");
    this.baseLoadStates.delete(workspaceId);
  }

  /** Settle a 409: resend local edits over the server copy, or drop them. */
  resolveConflict(workspaceId: string, noteId: string, keep: "local" | "server"): void {
    const key = entityKey(workspaceId, noteId);
    const serverHash = this.conflicts.get(key);
    if (serverHash === undefined) return;
    this.conflicts.delete(key);
    if (keep === "local") {
      this.rebaseNoteOps(workspaceId, noteId, serverHash);
    } else {
      this.removeOps(
        this.ops.filter((op) => op.workspaceId === workspaceId && op.kind === "saveNote" && op.noteId === noteId),
      );
      this.emit({ type: "noteDiscarded", workspaceId, noteId });
    }
    this.pump();
  }

  /** Paint from the cached snapshot. Leaves the base unset when nothing is cached. */
  async loadBase(workspaceId: string): Promise<void> {
    if (this.bases.has(workspaceId)) {
      runInAction(() => this.baseLoadStates.set(workspaceId, "ready"));
      return;
    }
    runInAction(() => this.baseLoadStates.set(workspaceId, "loading"));
    const cached = await readCache<WorkspaceManifest>(manifestCacheKey(workspaceId), "trees").catch(() => null);
    runInAction(() => {
      if (this.bases.has(workspaceId)) return;
      if (cached) {
        this.bases.set(workspaceId, cached);
        this.baseLoadStates.set(workspaceId, "ready");
      } else if (this.isLocalOnly(workspaceId, workspaceId)) {
        this.bases.set(workspaceId, emptyManifest());
        this.baseLoadStates.set(workspaceId, "ready");
      }
    });
  }

  /** Revalidate the snapshot against the server. Offline keeps the cached copy. */
  refreshBase(workspaceId: string): Promise<void> {
    const existing = this.baseRefreshInFlight.get(workspaceId);
    if (existing) return existing;
    const promise = this.refreshBaseOnce(workspaceId).finally(() => {
      this.baseRefreshInFlight.delete(workspaceId);
    });
    this.baseRefreshInFlight.set(workspaceId, promise);
    return promise;
  }

  private async refreshBaseOnce(workspaceId: string): Promise<void> {
    if (this.isLocalOnly(workspaceId, workspaceId)) {
      runInAction(() => {
        if (!this.bases.has(workspaceId)) this.setBase(workspaceId, emptyManifest());
        else this.baseLoadStates.set(workspaceId, "ready");
      });
      return;
    }
    const hadBase = this.bases.has(workspaceId);
    if (!hadBase) runInAction(() => this.baseLoadStates.set(workspaceId, "loading"));
    try {
      const { manifest } = await workspaceApi.manifest(workspaceId);
      runInAction(() => this.setBase(workspaceId, manifest));
    } catch {
      runInAction(() => {
        if (this.bases.has(workspaceId)) this.baseLoadStates.set(workspaceId, "ready");
        else this.baseLoadStates.set(workspaceId, "error");
      });
    }
  }

  setBase(workspaceId: string, manifest: WorkspaceManifest): void {
    const current = this.bases.get(workspaceId);
    if (current && manifest.rev < current.rev) return;
    this.bases.set(workspaceId, manifest);
    this.baseLoadStates.set(workspaceId, "ready");
    this.persistBase(workspaceId, true);
  }

  retryNow(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
    const now = Date.now();
    if (this.ops.some((op) => op.nextAttemptAt > now)) {
      this.ops = this.ops.map((op) => (op.nextAttemptAt > now ? { ...op, nextAttemptAt: 0 } : op));
    }
    this.pump();
  }

  private pump(): void {
    if (!this.ready || this.pumping || this.syncDisabled) return;
    this.pumping = true;
    void this.drain().finally(() => {
      this.pumping = false;
      const next = this.nextOp();
      if (next && next.nextAttemptAt <= Date.now()) this.pump();
    });
  }

  private nextOp(): SyncOp | undefined {
    return this.ops.find(
      (op) => op.ownerId === this.userId && !this.conflicts.has(entityKey(op.workspaceId, opTarget(op))),
    );
  }

  private async drain(): Promise<void> {
    for (;;) {
      const next = this.nextOp();
      if (!next) {
        runInAction(() => {
          this.retrying = false;
        });
        return;
      }
      const wait = next.nextAttemptAt - Date.now();
      if (wait > 0) {
        this.scheduleRetry(wait);
        return;
      }
      // Count the attempt before sending: an op that may have reached the server is never "unsent".
      const op = { ...next, attempts: next.attempts + 1 } as SyncOp;
      runInAction(() => {
        this.replaceOp(op);
        this.inflightOpId = op.opId;
      });
      try {
        await this.send(op);
        runInAction(() => {
          this.retrying = false;
        });
      } catch (error) {
        runInAction(() => this.fail(op, error));
      } finally {
        runInAction(() => {
          this.inflightOpId = null;
        });
      }
    }
  }

  private scheduleRetry(wait: number): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.pump();
    }, wait);
  }

  private async send(op: SyncOp): Promise<void> {
    const workspaceId = op.workspaceId;
    const entries = () => this.bases.get(workspaceId)?.entries ?? [];
    switch (op.kind) {
      case "createWorkspace": {
        const { workspace } = await workspaceApi.create(op.name, { id: workspaceId, seed: false });
        runInAction(() => {
          this.ack(op);
          if (!this.bases.has(workspaceId)) this.setBase(workspaceId, emptyManifest());
          this.emit({ type: "workspaceCreated", workspace });
        });
        return;
      }
      case "createNote": {
        const parentPath = folderPathById(entries(), op.parentId);
        const res = await workspaceApi.createNote(workspaceId, {
          id: op.noteId,
          parentPath,
          content: op.content,
          historyTrigger: op.historyTrigger,
        });
        runInAction(() => {
          this.setBase(workspaceId, res.manifest);
          this.ackNote(op, op.content, res.entry.contentHash ?? "");
        });
        return;
      }
      case "createFolder": {
        const parentPath = folderPathById(entries(), op.parentId);
        const res = await workspaceApi.createFolder(workspaceId, { id: op.folderId, parentPath, name: op.name });
        runInAction(() => {
          this.setBase(workspaceId, res.manifest);
          this.ack(op);
        });
        return;
      }
      case "rename": {
        const res = await workspaceApi.renameEntry(workspaceId, op.entryId, op.name);
        runInAction(() => {
          this.setBase(workspaceId, res.manifest);
          this.ack(op);
          if (res.entry.type === "note") {
            if (res.entry.contentHash) this.rebaseNoteOps(workspaceId, op.entryId, res.entry.contentHash);
            this.emit({ type: "noteRenamed", workspaceId, noteId: op.entryId, contentHash: res.entry.contentHash });
          }
        });
        return;
      }
      case "delete": {
        const res = await workspaceApi.deleteEntry(workspaceId, op.entryId);
        runInAction(() => {
          this.setBase(workspaceId, res.manifest);
          this.ack(op);
        });
        return;
      }
      case "move": {
        const parentPath = folderPathById(entries(), op.parentId);
        const res = await workspaceApi.moveEntry(workspaceId, op.entryId, parentPath);
        runInAction(() => {
          this.setBase(workspaceId, res.manifest);
          this.ack(op);
        });
        return;
      }
      case "saveNote": {
        // Recreate the entry if the server lost it, but only for notes that still exist here.
        const local = this.view(workspaceId).entries.find((e) => e.id === op.noteId);
        const res = await noteApi.save(workspaceId, op.noteId, {
          content: op.content,
          baseHash: op.baseHash,
          historyTrigger: op.historyTrigger,
          parentPath: local?.parentPath,
        });
        runInAction(() => {
          this.patchBase(workspaceId, res.entry, res.rev);
          this.ackNote(op, op.content, res.contentHash);
        });
        return;
      }
    }
  }

  private fail(sent: SyncOp, error: unknown): void {
    const op = this.ops.find((o) => o.opId === sent.opId);
    if (!op) return;
    const status = error instanceof ApiError ? error.status : 0;
    if (status === 409 && op.kind === "saveNote") {
      const body = (error as ApiError).body as { serverHash?: string } | null;
      this.conflicts.set(entityKey(op.workspaceId, op.noteId), body?.serverHash ?? "");
      return;
    }
    if (status >= 400 && status < 500 && !RETRYABLE_STATUS.has(status)) {
      // The server gave a definitive answer. A 404 on an existing entry means it is gone remotely.
      this.removeOps([op]);
      const silent =
        status === 404 && (op.kind === "rename" || op.kind === "delete" || op.kind === "saveNote" || op.kind === "move");
      if (!silent) this.emit({ type: "rejected", op, status });
      void this.refreshBase(op.workspaceId);
      return;
    }
    const delay = RETRY_DELAYS[Math.min(op.attempts - 1, RETRY_DELAYS.length - 1)] ?? RETRY_DELAYS[0]!;
    this.replaceOp({ ...op, nextAttemptAt: Date.now() + delay });
    this.retrying = true;
  }

  private coalesce(workspaceId: string, body: SyncOpBody): boolean {
    if (body.kind !== "saveNote" && body.kind !== "rename") return false;
    const target = body.kind === "saveNote" ? body.noteId : body.entryId;
    let index = -1;
    for (let i = this.ops.length - 1; i >= 0; i--) {
      const op = this.ops[i]!;
      if (op.workspaceId === workspaceId && op.ownerId === this.userId && opTarget(op) === target) {
        index = i;
        break;
      }
    }
    if (index < 0) return false;
    const last = this.ops[index]!;
    if (last.opId === this.inflightOpId) return false;
    let next: SyncOp | null = null;
    if (body.kind === "saveNote" && last.kind === "createNote") {
      next = {
        ...last,
        content: body.content,
        historyTrigger: mergeTrigger(last.historyTrigger, body.historyTrigger),
      };
    } else if (body.kind === "saveNote" && last.kind === "saveNote") {
      next = {
        ...last,
        content: body.content,
        historyTrigger: mergeTrigger(last.historyTrigger, body.historyTrigger),
        at: body.at ?? last.at,
      };
    } else if (body.kind === "rename" && (last.kind === "rename" || last.kind === "createFolder")) {
      next = { ...last, name: body.name };
    }
    if (!next) return false;
    this.replaceOp(next);
    return true;
  }

  private ack(op: SyncOp): void {
    this.removeOps([op]);
  }

  private ackNote(op: SyncOp & { noteId: string }, content: string, contentHash: string): void {
    this.ack(op);
    // Later saves were typed on top of what was just acknowledged.
    this.rebaseNoteOps(op.workspaceId, op.noteId, contentHash);
    this.emit({ type: "noteSaved", workspaceId: op.workspaceId, noteId: op.noteId, content, contentHash });
  }

  private rebaseNoteOps(workspaceId: string, noteId: string, baseHash: string): void {
    for (const op of this.ops) {
      if (op.workspaceId === workspaceId && op.kind === "saveNote" && op.noteId === noteId && op.baseHash !== baseHash) {
        this.replaceOp({ ...op, baseHash });
      }
    }
  }

  /** Fold one saved entry into the snapshot. Skipped until the snapshot is loaded. */
  private patchBase(workspaceId: string, entry: ManifestEntry, rev: number): void {
    const base = this.bases.get(workspaceId);
    if (!base) return;
    const known = base.entries.some((e) => e.id === entry.id);
    const entries = known ? base.entries.map((e) => (e.id === entry.id ? entry : e)) : [...base.entries, entry];
    this.bases.set(workspaceId, { ...base, rev: Math.max(base.rev, rev), entries });
    this.persistBase(workspaceId, !known);
    if (rev > base.rev + 1) void this.refreshBase(workspaceId);
  }

  private replaceOp(op: SyncOp): void {
    this.ops = this.ops.map((o) => (o.opId === op.opId ? op : o));
    this.persistOp(op);
  }

  private removeOps(ops: SyncOp[]): void {
    if (ops.length === 0) return;
    const ids = new Set(ops.map((op) => op.opId));
    this.ops = this.ops.filter((op) => !ids.has(op.opId));
    for (const id of ids) this.persistTask(() => deleteSyncOp(id));
  }

  private persistOp(op: SyncOp): void {
    this.persistTask(() => writeSyncOp(op.opId, op));
  }

  /** Snapshot writes share the op chain so a reload never sees an op removed before its effect is cached. */
  private persistBase(workspaceId: string, immediate: boolean): void {
    const pending = this.basePersistTimers.get(workspaceId);
    if (pending) clearTimeout(pending);
    const write = () => {
      this.basePersistTimers.delete(workspaceId);
      const manifest = this.bases.get(workspaceId);
      if (manifest) this.persistTask(() => writeCache(manifestCacheKey(workspaceId), manifest, "trees"));
    };
    if (immediate) write();
    else this.basePersistTimers.set(workspaceId, setTimeout(write, BASE_PERSIST_MS));
  }

  private persistTask(task: () => Promise<void>): void {
    this.persistChain = this.persistChain.then(task).catch(() => {});
  }

  private emit(event: SyncEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}

export const syncStore = new SyncStore();
