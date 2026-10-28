import { makeAutoObservable, runInAction } from "mobx";
import { noteApi } from "@/lib/api";
import { readCache, writeCache } from "@/lib/idb-cache";
import type { HistoryTrigger } from "@/lib/sync-ops";
import { stripAiJobImages } from "@/lib/ai-job-markdown";
import { replaceMarkdownTitle, titleFromMarkdown } from "@shared/title";
import { emitFileWrite } from "@/lib/file-write-events";
import { pathForNoteId, recordOpenedNote } from "@/lib/search-nav";
import { noteTabsStore } from "@/stores/note-tabs-store";
import { syncStore, type SyncEvent, type SyncState } from "@/stores/sync-store";
import { workspaceStore } from "@/stores/workspace-store";

export type { SyncState };

const AUTOSAVE_MS = 400;
/** Trailing debounce after the last real edit; independent of autosave. */
const HISTORY_BACKUP_DEBOUNCE_MS = 45_000;
/** Force one snapshot during continuous typing. */
const HISTORY_BACKUP_MAX_WAIT_MS = 120_000;

type CachedNote = { content: string; contentHash?: string };

function cacheKey(workspaceId: string, noteId: string): string {
  return `note:${workspaceId}:${noteId}`;
}

class NoteStore {
  openNoteId: string | null = null;
  openWorkspaceId: string | null = null;
  content = "";
  /** Hash of the server copy the editor content builds on. */
  contentHash: string | undefined;
  /** Content last handed to the sync queue. Differs from `content` while the autosave debounce runs. */
  queuedContent = "";
  historyOpen = false;
  /** The editor has real content to show (local op, cache or server). */
  editorReady = false;
  /** Nothing local and the server was unreachable. Editing stays off so an empty body is never saved. */
  loadFailed = false;
  hydrateToken = 0;
  focusTitleNoteId: string | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private backupTimer: ReturnType<typeof setTimeout> | null = null;
  private backupMaxWaitTimer: ReturnType<typeof setTimeout> | null = null;
  /** Content at the last history snapshot (auto or manual). */
  private lastBackupContent = "";
  private openToken = 0;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    syncStore.subscribe(this.onSyncEvent);
  }

  get title(): string {
    return titleFromMarkdown(this.content);
  }

  get hasUnqueuedEdits(): boolean {
    return !!this.openNoteId && this.editorReady && this.content !== this.queuedContent;
  }

  get conflict(): boolean {
    return !!this.openWorkspaceId && !!this.openNoteId && syncStore.hasConflict(this.openWorkspaceId, this.openNoteId);
  }

  /** Sync state of any entry, counting edits still inside the autosave debounce as local. */
  syncStateOf(workspaceId: string, entryId: string): SyncState {
    const state = syncStore.entryState(workspaceId, entryId);
    if (state !== "synced" || entryId !== this.openNoteId || workspaceId !== this.openWorkspaceId) return state;
    return this.hasUnqueuedEdits ? "local" : state;
  }

  get syncState(): SyncState {
    if (!this.openWorkspaceId || !this.openNoteId) return "synced";
    return this.syncStateOf(this.openWorkspaceId, this.openNoteId);
  }

  armTitleFocus(noteId: string): void {
    this.focusTitleNoteId = noteId;
  }

  consumeTitleFocus(noteId: string): void {
    if (this.focusTitleNoteId === noteId) this.focusTitleNoteId = null;
  }

  /**
   * Show a note. Pending local content paints synchronously, the cache within
   * a frame or two, and the server copy only replaces them when nothing local
   * is pending for the note.
   */
  async open(workspaceId: string, noteId: string): Promise<void> {
    if (this.openNoteId === noteId && this.openWorkspaceId === workspaceId) return;
    this.flushPendingHistoryBackup();
    this.checkpoint();
    this.clearBackupTimer();
    const token = ++this.openToken;
    this.openNoteId = noteId;
    this.openWorkspaceId = workspaceId;
    this.historyOpen = false;
    this.loadFailed = false;
    this.contentHash = syncStore.base(workspaceId)?.entries.find((e) => e.id === noteId)?.contentHash;

    const local = syncStore.latestContent(workspaceId, noteId);
    if (local !== null) this.paint(local);
    else this.editorReady = false;

    if (local === null) {
      const cached = await readCache<CachedNote>(cacheKey(workspaceId, noteId), "notes").catch(() => null);
      if (token !== this.openToken) return;
      runInAction(() => {
        if (!cached || this.editorReady) return;
        this.contentHash = cached.contentHash;
        this.paint(this.withPendingRename(workspaceId, noteId, cached.content));
      });
    }

    if (!syncStore.isLocalOnly(workspaceId, noteId)) {
      try {
        const data = await noteApi.get(workspaceId, noteId);
        void writeCache(cacheKey(workspaceId, noteId), { content: data.content, contentHash: data.entry?.contentHash }, "notes");
        if (token !== this.openToken) return;
        runInAction(() => {
          if (this.hasUnqueuedEdits || syncStore.latestContent(workspaceId, noteId) !== null) return;
          this.contentHash = data.entry?.contentHash;
          const next = this.withPendingRename(workspaceId, noteId, data.content);
          if (!this.editorReady || next !== this.content) this.paint(next);
        });
      } catch {
        if (token !== this.openToken) return;
        runInAction(() => {
          if (!this.editorReady) this.loadFailed = true;
        });
      }
    }

    const path = pathForNoteId(noteId);
    if (path && this.editorReady) recordOpenedNote(path, this.title);
  }

  /** Forget the open note without saving (it was deleted, or its tab closed with nothing next). */
  close(): void {
    this.flushPendingHistoryBackup();
    this.checkpoint();
    this.clearBackupTimer();
    this.openToken += 1;
    this.openNoteId = null;
    this.openWorkspaceId = null;
    this.content = "";
    this.queuedContent = "";
    this.lastBackupContent = "";
    this.editorReady = false;
    this.loadFailed = false;
  }

  setContent(workspaceId: string, raw: string): void {
    if (!this.openNoteId || !this.editorReady || workspaceId !== this.openWorkspaceId) return;
    const value = stripAiJobImages(raw);
    const changed = this.content !== value;
    this.content = value;
    workspaceStore.applyNoteTitle(this.openNoteId, titleFromMarkdown(value));
    noteTabsStore.workspace(workspaceId).promoteTabForNote(this.openNoteId);
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => this.checkpoint(), AUTOSAVE_MS);
    if (changed) this.scheduleAutoBackup();
  }

  /** Hand unsent editor content to the sync queue. Local and synchronous; never waits on the network. */
  checkpoint(historyTrigger?: HistoryTrigger): void {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    const workspaceId = this.openWorkspaceId;
    const noteId = this.openNoteId;
    if (!workspaceId || !noteId || !this.editorReady) return;
    if (this.content === this.queuedContent && !historyTrigger) return;
    syncStore.enqueue(workspaceId, {
      kind: "saveNote",
      noteId,
      content: this.content,
      baseHash: this.contentHash,
      historyTrigger,
      at: new Date().toISOString(),
    });
    this.queuedContent = this.content;
  }

  manualSave(): void {
    this.clearBackupTimer();
    this.recordHistorySnapshot("manual");
  }

  /** Rename a note by rewriting its first heading, locally first. */
  renameNote(workspaceId: string, noteId: string, title: string): void {
    const name = title.trim().replace(/\.md$/i, "") || "Untitled";
    if (noteId === this.openNoteId && workspaceId === this.openWorkspaceId && this.editorReady) {
      const next = replaceMarkdownTitle(this.content, name);
      const changed = next !== this.content;
      this.content = next;
      this.hydrateToken += 1;
      workspaceStore.applyNoteTitle(noteId, name);
      this.checkpoint();
      if (changed) this.scheduleAutoBackup();
      return;
    }
    const local = syncStore.latestContent(workspaceId, noteId);
    if (local !== null) {
      syncStore.enqueue(workspaceId, {
        kind: "saveNote",
        noteId,
        content: replaceMarkdownTitle(local, name),
        at: new Date().toISOString(),
      });
    } else {
      // No local body to edit: the worker rewrites the heading.
      syncStore.enqueue(workspaceId, { kind: "rename", entryId: noteId, name });
    }
  }

  keepLocalVersion(): void {
    if (this.openWorkspaceId && this.openNoteId) syncStore.resolveConflict(this.openWorkspaceId, this.openNoteId, "local");
  }

  useServerVersion(): void {
    if (this.openWorkspaceId && this.openNoteId) syncStore.resolveConflict(this.openWorkspaceId, this.openNoteId, "server");
  }

  setHistoryOpen(open: boolean): void {
    if (open && !this.openNoteId) return;
    this.historyOpen = open;
  }

  async restoreBackup(workspaceId: string, backupId: string): Promise<void> {
    const noteId = this.openNoteId;
    if (!noteId || workspaceId !== this.openWorkspaceId) return;
    const { backup } = await noteApi.historyItem(workspaceId, noteId, backupId);
    runInAction(() => {
      if (this.openNoteId !== noteId) return;
      if (this.content !== this.lastBackupContent) {
        this.recordHistorySnapshot("manual");
      }
      this.clearBackupTimer();
      this.content = backup.content;
      this.queuedContent = backup.content;
      this.hydrateToken += 1;
      this.historyOpen = false;
      this.lastBackupContent = backup.content;
      workspaceStore.applyNoteTitle(noteId, titleFromMarkdown(backup.content));
      this.checkpoint();
    });
  }

  private paint(content: string): void {
    this.content = content;
    this.queuedContent = content;
    this.lastBackupContent = content;
    this.editorReady = true;
    this.loadFailed = false;
    this.hydrateToken += 1;
    if (this.openNoteId) workspaceStore.applyNoteTitle(this.openNoteId, titleFromMarkdown(content));
  }

  private withPendingRename(workspaceId: string, noteId: string, content: string): string {
    const name = syncStore.pendingRename(workspaceId, noteId);
    return name ? replaceMarkdownTitle(content, name) : content;
  }

  private onSyncEvent(event: SyncEvent): void {
    switch (event.type) {
      case "noteSaved": {
        void writeCache(
          cacheKey(event.workspaceId, event.noteId),
          { content: event.content, contentHash: event.contentHash },
          "notes",
        );
        if (this.isOpen(event.workspaceId, event.noteId)) this.contentHash = event.contentHash;
        const path = pathForNoteId(event.noteId);
        if (path) emitFileWrite({ type: "save", root: "notes", path, content: event.content });
        return;
      }
      case "noteRenamed":
        if (this.isOpen(event.workspaceId, event.noteId)) this.contentHash = event.contentHash;
        return;
      case "entriesRemoved":
        if (this.openWorkspaceId === event.workspaceId && this.openNoteId && event.ids.includes(this.openNoteId)) {
          this.queuedContent = this.content;
          this.close();
        }
        return;
      case "noteDiscarded":
        if (this.isOpen(event.workspaceId, event.noteId)) {
          const { workspaceId, noteId } = event;
          this.queuedContent = this.content;
          this.close();
          void this.open(workspaceId, noteId);
        }
        return;
      default:
        return;
    }
  }

  private isOpen(workspaceId: string, noteId: string): boolean {
    return this.openWorkspaceId === workspaceId && this.openNoteId === noteId;
  }

  private historyBackupPending(): boolean {
    return this.backupTimer != null || this.backupMaxWaitTimer != null;
  }

  private flushPendingHistoryBackup(): void {
    if (!this.historyBackupPending()) return;
    this.clearBackupTimer();
    if (this.content === this.lastBackupContent) return;
    this.recordHistorySnapshot("auto");
  }

  private clearBackupTimer(): void {
    if (this.backupTimer != null) {
      clearTimeout(this.backupTimer);
      this.backupTimer = null;
    }
    if (this.backupMaxWaitTimer != null) {
      clearTimeout(this.backupMaxWaitTimer);
      this.backupMaxWaitTimer = null;
    }
  }

  private scheduleAutoBackup(): void {
    if (this.backupTimer != null) {
      clearTimeout(this.backupTimer);
      this.backupTimer = null;
    }
    this.backupTimer = setTimeout(() => {
      this.backupTimer = null;
      if (this.backupMaxWaitTimer != null) {
        clearTimeout(this.backupMaxWaitTimer);
        this.backupMaxWaitTimer = null;
      }
      this.recordHistorySnapshot("auto");
    }, HISTORY_BACKUP_DEBOUNCE_MS);
    if (this.backupMaxWaitTimer == null) {
      this.backupMaxWaitTimer = setTimeout(() => {
        this.backupMaxWaitTimer = null;
        if (this.backupTimer != null) {
          clearTimeout(this.backupTimer);
          this.backupTimer = null;
        }
        this.recordHistorySnapshot("auto");
      }, HISTORY_BACKUP_MAX_WAIT_MS);
    }
  }

  /** Persist a history snapshot via the sync queue; skips unchanged auto snapshots. */
  private recordHistorySnapshot(trigger: HistoryTrigger): void {
    if (trigger === "auto" && this.content === this.lastBackupContent) return;
    this.checkpoint(trigger);
    this.lastBackupContent = this.content;
  }
}

export const noteStore = new NoteStore();
