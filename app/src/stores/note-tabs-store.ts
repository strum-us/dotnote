import { isClient } from "@/lib/is-client";
import type { NoteTabMode, NoteTabSession } from "@/lib/types/note-tabs";
import { uiPreferenceStore } from "@/stores/ui-preference-store";
import { makeAutoObservable } from "mobx";

function newTabId(): string {
  return `ntab_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

const MAX_VISIT_HISTORY = 50;

export type OpenNoteOptions = {
  mode?: NoteTabMode;
  /** Skip pushing onto back/forward history (programmatic restore). */
  skipHistory?: boolean;
};

export class NoteWorkspaceTabs {
  readonly workspaceId: string;
  tabs: NoteTabSession[] = [];
  activeTabId = "";
  visitHistory: string[] = [];
  visitHistoryIndex = -1;
  private attached = false;

  constructor(workspaceId: string) {
    this.workspaceId = workspaceId;
    makeAutoObservable(this, {}, { autoBind: true });
  }

  get activeTab(): NoteTabSession | null {
    if (this.activeTabId) {
      const found = this.tabs.find((tab) => tab.id === this.activeTabId);
      if (found) return found;
    }
    return this.tabs[0] ?? null;
  }

  get activeNoteId(): string | null {
    return this.activeTab?.noteId ?? null;
  }

  get previewTab(): NoteTabSession | null {
    return this.tabs.find((tab) => tab.mode === "preview") ?? null;
  }

  get canBack(): boolean {
    return this.visitHistoryIndex > 0;
  }

  get canForward(): boolean {
    return this.visitHistoryIndex >= 0 && this.visitHistoryIndex < this.visitHistory.length - 1;
  }

  /** Previous note in visit history, or null. */
  back(): string | null {
    if (!this.canBack) return null;
    this.visitHistoryIndex -= 1;
    return this.visitHistory[this.visitHistoryIndex] ?? null;
  }

  /** Next note in visit history, or null. */
  forward(): string | null {
    if (!this.canForward) return null;
    this.visitHistoryIndex += 1;
    return this.visitHistory[this.visitHistoryIndex] ?? null;
  }

  private recordVisit(noteId: string, skipHistory: boolean): void {
    if (skipHistory) return;
    if (this.visitHistoryIndex >= 0 && this.visitHistory[this.visitHistoryIndex] === noteId) return;
    if (this.visitHistoryIndex < this.visitHistory.length - 1) {
      this.visitHistory = this.visitHistory.slice(0, this.visitHistoryIndex + 1);
    }
    this.visitHistory.push(noteId);
    if (this.visitHistory.length > MAX_VISIT_HISTORY) {
      this.visitHistory.shift();
    }
    this.visitHistoryIndex = this.visitHistory.length - 1;
  }

  private pruneVisitHistory(validNoteIds: Set<string>): void {
    if (this.visitHistory.length === 0) return;
    const kept: string[] = [];
    for (const id of this.visitHistory) {
      if (validNoteIds.has(id)) kept.push(id);
    }
    this.visitHistory = kept;
    if (kept.length === 0) {
      this.visitHistoryIndex = -1;
      return;
    }
    const current =
      this.visitHistoryIndex >= 0 && this.visitHistoryIndex < this.visitHistory.length
        ? this.visitHistory[this.visitHistoryIndex]
        : null;
    const activeId = this.activeNoteId;
    const anchor = current ?? activeId;
    if (anchor && kept.includes(anchor)) {
      this.visitHistoryIndex = kept.indexOf(anchor);
    } else {
      this.visitHistoryIndex = kept.length - 1;
    }
  }

  /** Restore persisted tabs once; later calls keep the in-memory session. */
  attach(): void {
    if (!isClient() || this.attached) return;
    this.attached = true;
    const stored = this.readPersisted();
    if (stored?.tabs.length) {
      this.tabs = stored.tabs.map((tab) => ({
        ...tab,
        workspaceId: this.workspaceId,
      }));
      this.activeTabId = stored.activeTabId;
      this.pruneInvalid();
    }
  }

  openNote(noteId: string, options: OpenNoteOptions = {}): NoteTabSession {
    const mode = options.mode ?? "preview";
    const skipHistory = options.skipHistory === true;

    const existing = this.tabs.find((tab) => tab.noteId === noteId);
    if (existing) {
      if (mode === "permanent" && existing.mode === "preview") {
        existing.mode = "permanent";
      }
      this.activeTabId = existing.id;
      this.recordVisit(noteId, skipHistory);
      this.persist();
      uiPreferenceStore.recordNoteVisit(this.workspaceId, noteId);
      return existing;
    }

    if (mode === "preview") {
      const active = this.activeTab;
      const reuse = (active?.mode === "preview" ? active : null) ?? this.previewTab;
      if (reuse) {
        reuse.noteId = noteId;
        reuse.mode = "preview";
        this.activeTabId = reuse.id;
        this.recordVisit(noteId, skipHistory);
        this.persist();
        uiPreferenceStore.recordNoteVisit(this.workspaceId, noteId);
        return reuse;
      }
    }

    const tab: NoteTabSession = {
      id: newTabId(),
      workspaceId: this.workspaceId,
      noteId,
      mode,
    };

    const active = this.activeTab;
    const insertAt =
      active && mode === "preview"
        ? Math.min(this.tabs.indexOf(active) + 1, this.tabs.length)
        : this.tabs.length;
    this.tabs.splice(insertAt, 0, tab);
    this.activeTabId = tab.id;
    this.recordVisit(noteId, skipHistory);
    this.persist();
    uiPreferenceStore.recordNoteVisit(this.workspaceId, noteId);
    return tab;
  }

  switchTab(tabId: string, options: { skipHistory?: boolean } = {}): string | null {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab) return null;
    this.activeTabId = tabId;
    this.recordVisit(tab.noteId, options.skipHistory === true);
    this.persist();
    uiPreferenceStore.recordNoteVisit(this.workspaceId, tab.noteId);
    return tab.noteId;
  }

  promoteToPermanent(tabId: string): void {
    const tab = this.tabs.find((item) => item.id === tabId);
    if (!tab || tab.mode === "permanent") return;
    tab.mode = "permanent";
    this.persist();
  }

  promoteTabForNote(noteId: string): void {
    const tab =
      this.tabs.find((item) => item.id === this.activeTabId && item.noteId === noteId) ??
      this.tabs.find((item) => item.noteId === noteId);
    if (!tab) return;
    this.promoteToPermanent(tab.id);
  }

  closeTab(tabId: string): string | null {
    const idx = this.tabs.findIndex((tab) => tab.id === tabId);
    if (idx < 0) return null;

    this.tabs.splice(idx, 1);
    if (this.activeTabId === tabId) {
      const next = this.tabs[Math.min(idx, this.tabs.length - 1)];
      this.activeTabId = next?.id ?? "";
      this.persist();
      return next?.noteId ?? null;
    }
    this.persist();
    return null;
  }

  closeOtherTabs(keepTabId: string): void {
    this.tabs = this.tabs.filter((tab) => tab.id === keepTabId);
    this.activeTabId = keepTabId;
    this.persist();
  }

  reorderTabs(fromIndex: number, toIndex: number): void {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    if (fromIndex >= this.tabs.length || toIndex >= this.tabs.length) return;
    const next = [...this.tabs];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved!);
    this.tabs = next;
    this.persist();
  }

  closeTabsForNotes(noteIds: Iterable<string>): void {
    const remove = new Set(noteIds);
    const closingActive = this.tabs.some((t) => t.id === this.activeTabId && remove.has(t.noteId));
    this.tabs = this.tabs.filter((tab) => !remove.has(tab.noteId));
    if (closingActive || (this.activeTabId && !this.tabs.some((t) => t.id === this.activeTabId))) {
      this.activeTabId = this.tabs[0]?.id ?? "";
    }
    this.persist();
  }

  pruneMissingNotes(validNoteIds: Set<string>): void {
    const before = this.tabs.length;
    this.tabs = this.tabs.filter((tab) => validNoteIds.has(tab.noteId));
    this.pruneVisitHistory(validNoteIds);
    if (this.tabs.length !== before) {
      if (this.activeTabId && !this.tabs.some((t) => t.id === this.activeTabId)) {
        this.activeTabId = this.tabs[0]?.id ?? "";
      }
      this.persist();
    }
  }

  private pruneInvalid(): void {
    this.tabs = this.tabs.filter((tab) => tab.noteId.trim().length > 0);
    if (this.activeTabId && !this.tabs.some((tab) => tab.id === this.activeTabId)) {
      this.activeTabId = this.tabs[0]?.id ?? "";
    }
  }

  private readPersisted(): { activeTabId: string; tabs: NoteTabSession[] } | null {
    try {
      const stored = uiPreferenceStore.readNoteTabs(this.workspaceId);
      if (!stored?.tabs.length) return null;
      return {
        activeTabId: stored.activeTabId,
        tabs: stored.tabs.map((tab) => ({
          id: tab.id,
          workspaceId: this.workspaceId,
          noteId: tab.noteId,
          mode: tab.mode ?? "preview",
        })),
      };
    } catch {
      return null;
    }
  }

  private persist(): void {
    if (!isClient()) return;
    uiPreferenceStore.writeNoteTabs(
      this.workspaceId,
      this.activeTabId,
      this.tabs.map((tab) => ({
        id: tab.id,
        noteId: tab.noteId,
        mode: tab.mode,
      })),
    );
  }
}

class NoteTabsStore {
  private workspaces = new Map<string, NoteWorkspaceTabs>();

  workspace(workspaceId: string): NoteWorkspaceTabs {
    let session = this.workspaces.get(workspaceId);
    if (!session) {
      session = new NoteWorkspaceTabs(workspaceId);
      this.workspaces.set(workspaceId, session);
    }
    return session;
  }

  attach(workspaceId: string): NoteWorkspaceTabs {
    const session = this.workspace(workspaceId);
    session.attach();
    return session;
  }
}

export const noteTabsStore = new NoteTabsStore();
