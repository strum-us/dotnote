import {
  UI_PREFERENCE_BUILD_VERSION,
  UI_PREFERENCE_SCHEMA_VERSION,
} from "@/lib/app-version";
import { createEmptyWorkspacePref } from "@/lib/ui-preference/defaults";
import { migrateUIPreferenceData } from "@/lib/ui-preference/migrate";
import { isClient } from "@/lib/is-client";
import type {
  NoteTabPreference,
  NoteUIPreference,
  UIPreferenceMeta,
  WorkspaceUIPreferenceEnvelope,
  WorkspaceUIPreferences,
} from "@/lib/types/ui-preference";
import { makeAutoObservable, observable } from "mobx";
import {
  DEFAULT_DOCS_SORT,
  type DocsSortDirection,
  type DocsSortField,
  type DocsSortPreference,
  readDocsSort,
  writeDocsSort,
} from "@/lib/docs-sort";
import { detectBrowserLanguage, isSupportedLanguageCode } from "@/lib/languages";

const META_KEY = "dotnote:ui-pref:meta";
const WORKSPACE_KEY_PREFIX = "dotnote:ui-pref:ws:";
const SIDEBAR_COLLAPSED_KEY = "dotnote:sidebar-collapsed";
const AI_TRANSLATE_TARGET_KEY = "dotnote:ai-translate-target";
const DISMISSED_UPDATE_KEY = "dotnote:dismissed-update-version";

function readDismissedUpdate(): string | null {
  try {
    return window.localStorage.getItem(DISMISSED_UPDATE_KEY);
  } catch {
    return null;
  }
}

function writeDismissedUpdate(version: string | null): void {
  try {
    if (version) window.localStorage.setItem(DISMISSED_UPDATE_KEY, version);
    else window.localStorage.removeItem(DISMISSED_UPDATE_KEY);
  } catch {
    /* ignore */
  }
}

function readAiTranslateTarget(): string {
  try {
    const stored = window.localStorage.getItem(AI_TRANSLATE_TARGET_KEY);
    if (stored && isSupportedLanguageCode(stored)) return stored;
  } catch {
    /* ignore */
  }
  return detectBrowserLanguage();
}

function writeAiTranslateTarget(code: string): void {
  try {
    window.localStorage.setItem(AI_TRANSLATE_TARGET_KEY, code);
  } catch {
    /* ignore */
  }
}

function readSidebarCollapsed(): boolean {
  try {
    return window.localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed: boolean): void {
  try {
    window.localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
  } catch {
    /* ignore */
  }
}

const SAVE_DEBOUNCE_MS = 150;
const MAX_NOTES_PER_WORKSPACE = 80;

function workspaceStorageKey(workspaceId: string): string {
  return `${WORKSPACE_KEY_PREFIX}${workspaceId}`;
}

export { createEmptyWorkspacePref } from "@/lib/ui-preference/defaults";

function readStoredSchemaVersion(meta: UIPreferenceMeta | null): number | null {
  if (!meta || typeof meta.schemaVersion !== "number") return null;
  return meta.schemaVersion;
}

function persistMeta(): void {
  window.localStorage.setItem(
    META_KEY,
    JSON.stringify({
      buildVersion: UI_PREFERENCE_BUILD_VERSION,
      schemaVersion: UI_PREFERENCE_SCHEMA_VERSION,
    } satisfies UIPreferenceMeta),
  );
}

function persistWorkspaceEnvelope(workspaceId: string, data: WorkspaceUIPreferences): void {
  const envelope: WorkspaceUIPreferenceEnvelope = {
    buildVersion: UI_PREFERENCE_BUILD_VERSION,
    schemaVersion: UI_PREFERENCE_SCHEMA_VERSION,
    data,
  };
  window.localStorage.setItem(workspaceStorageKey(workspaceId), JSON.stringify(envelope));
}

export class UIPreferenceStore {
  sidebarCollapsed = false;
  docsSort: DocsSortPreference = DEFAULT_DOCS_SORT;
  /** Preferred target for “Translate to …” in the AI bar; defaults from browser locale. */
  aiTranslateTarget = "en";
  /** Release whose sidebar banner the user put off with “Later”. A newer release shows again. */
  dismissedUpdateVersion: string | null = null;
  private workspacePrefs = observable.map<string, WorkspaceUIPreferences>();
  private saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listening = false;
  private versionChecked = false;

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true });
    if (isClient()) {
      this.sidebarCollapsed = readSidebarCollapsed();
      this.docsSort = readDocsSort();
      this.aiTranslateTarget = readAiTranslateTarget();
      this.dismissedUpdateVersion = readDismissedUpdate();
      this.ensureStorageVersion();
      this.listenPageExit();
    }
  }

  setAiTranslateTarget(code: string): void {
    if (!isSupportedLanguageCode(code) || this.aiTranslateTarget === code) return;
    this.aiTranslateTarget = code;
    writeAiTranslateTarget(code);
  }

  setDismissedUpdateVersion(version: string | null): void {
    if (this.dismissedUpdateVersion === version) return;
    this.dismissedUpdateVersion = version;
    writeDismissedUpdate(version);
  }

  setDocsSort(field: DocsSortField, direction: DocsSortDirection): void {
    if (this.docsSort.field === field && this.docsSort.direction === direction) return;
    this.docsSort = { field, direction };
    writeDocsSort(this.docsSort);
  }

  toggleSidebarCollapsed(): void {
    this.sidebarCollapsed = !this.sidebarCollapsed;
    writeSidebarCollapsed(this.sidebarCollapsed);
  }

  setSidebarCollapsed(collapsed: boolean): void {
    if (this.sidebarCollapsed === collapsed) return;
    this.sidebarCollapsed = collapsed;
    writeSidebarCollapsed(collapsed);
  }

  ensureStorageVersion(): void {
    if (!isClient() || this.versionChecked) return;
    this.versionChecked = true;

    try {
      const rawMeta = window.localStorage.getItem(META_KEY);
      let meta: UIPreferenceMeta | null = null;
      if (rawMeta) {
        try {
          meta = JSON.parse(rawMeta) as UIPreferenceMeta;
        } catch {
          meta = null;
        }
      }

      const storedVersion = readStoredSchemaVersion(meta);

      if (storedVersion !== null && storedVersion > UI_PREFERENCE_SCHEMA_VERSION) {
        this.clearAllPersisted();
      } else if (storedVersion !== null && storedVersion < UI_PREFERENCE_SCHEMA_VERSION) {
        this.migrateAllWorkspacePrefKeys(storedVersion);
      }

      persistMeta();
    } catch {
      /* private mode */
    }
  }

  private migrateAllWorkspacePrefKeys(fromVersion: number): void {
    const keys: string[] = [];
    for (let i = 0; i < window.localStorage.length; i++) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(WORKSPACE_KEY_PREFIX)) keys.push(key);
    }
    for (const key of keys) {
      const workspaceId = key.slice(WORKSPACE_KEY_PREFIX.length);
      if (!workspaceId) continue;
      try {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw) as WorkspaceUIPreferenceEnvelope;
        if (!parsed?.data || typeof parsed.data.workspaceId !== "string") continue;
        const migrated = migrateUIPreferenceData(workspaceId, parsed.data, fromVersion);
        migrated.updatedAt = Date.now();
        persistWorkspaceEnvelope(workspaceId, migrated);
      } catch {
        /* skip corrupt entry */
      }
    }
  }

  clearAllPersisted(): void {
    if (!isClient()) return;
    try {
      const keys: string[] = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key?.startsWith(WORKSPACE_KEY_PREFIX)) keys.push(key);
      }
      for (const key of keys) window.localStorage.removeItem(key);
      this.workspacePrefs.clear();
    } catch {
      /* not critical */
    }
  }

  forgetWorkspace(workspaceId: string): void {
    if (!workspaceId) return;
    const timer = this.saveTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(workspaceId);
    }
    this.workspacePrefs.delete(workspaceId);
    if (!isClient()) return;
    try {
      window.localStorage.removeItem(workspaceStorageKey(workspaceId));
    } catch {
      /* ignore */
    }
  }

  get(workspaceId: string): WorkspaceUIPreferences {
    this.ensureStorageVersion();
    if (!workspaceId) return createEmptyWorkspacePref("");
    let pref = this.workspacePrefs.get(workspaceId);
    if (!pref) {
      pref = this.loadWorkspace(workspaceId) ?? createEmptyWorkspacePref(workspaceId);
      this.workspacePrefs.set(workspaceId, pref);
    }
    return pref;
  }

  readNoteTabs(workspaceId: string): { activeTabId: string; tabs: NoteTabPreference[] } | null {
    const notes = this.get(workspaceId).notes;
    if (notes.tabs.length === 0) return null;
    return { activeTabId: notes.activeTabId ?? "", tabs: notes.tabs };
  }

  writeNoteTabs(workspaceId: string, activeTabId: string, tabs: NoteTabPreference[]): void {
    const pref = this.get(workspaceId);
    pref.notes.activeTabId = activeTabId;
    pref.notes.tabs = tabs;
    if (tabs.find((t) => t.id === activeTabId)) {
      pref.notes.lastActiveNoteId = tabs.find((t) => t.id === activeTabId)?.noteId;
    }
    this.scheduleSave(workspaceId);
  }

  recordNoteVisit(workspaceId: string, noteId: string): void {
    const pref = this.get(workspaceId);
    pref.notes.lastActiveNoteId = noteId;
    this.ensureNoteEntry(pref, noteId).lastVisitedAt = Date.now();
    this.pruneNotesLru(pref);
    this.scheduleSave(workspaceId);
  }

  getLastActiveNoteId(workspaceId: string): string | null {
    return this.get(workspaceId).notes.lastActiveNoteId ?? null;
  }

  setNoteUI(workspaceId: string, noteId: string, state: Partial<NoteUIPreference>): void {
    const pref = this.get(workspaceId);
    const prev = pref.notes.noteUi[noteId];
    pref.notes.noteUi[noteId] = {
      scrollTop: prev?.scrollTop ?? 0,
      scrollLeft: prev?.scrollLeft ?? 0,
      caret: prev?.caret,
      lastVisitedAt: Date.now(),
      ...state,
    };
    this.scheduleSave(workspaceId);
  }

  getNoteUI(workspaceId: string, noteId: string): NoteUIPreference | null {
    return this.get(workspaceId).notes.noteUi[noteId] ?? null;
  }

  getExpandedFolders(workspaceId: string): string[] {
    return [...(this.get(workspaceId).notes.sidebarExpandedPaths ?? [])];
  }

  setExpandedFolders(workspaceId: string, paths: string[]): void {
    const pref = this.get(workspaceId);
    pref.notes.sidebarExpandedPaths = paths;
    this.scheduleSave(workspaceId);
  }

  private ensureNoteEntry(pref: WorkspaceUIPreferences, noteId: string) {
    if (!pref.notes.noteUi[noteId]) {
      pref.notes.noteUi[noteId] = {
        scrollTop: 0,
        scrollLeft: 0,
        lastVisitedAt: Date.now(),
      };
    }
    return pref.notes.noteUi[noteId]!;
  }

  private pruneNotesLru(pref: WorkspaceUIPreferences): void {
    const keys = Object.keys(pref.notes.noteUi);
    if (keys.length <= MAX_NOTES_PER_WORKSPACE) return;
    const sorted = keys.sort(
      (a, b) => (pref.notes.noteUi[a]?.lastVisitedAt ?? 0) - (pref.notes.noteUi[b]?.lastVisitedAt ?? 0),
    );
    for (const key of sorted.slice(0, keys.length - MAX_NOTES_PER_WORKSPACE)) {
      delete pref.notes.noteUi[key];
    }
  }

  private scheduleSave(workspaceId: string): void {
    if (!isClient() || !workspaceId) return;
    const timer = this.saveTimers.get(workspaceId);
    if (timer) clearTimeout(timer);
    this.saveTimers.set(
      workspaceId,
      setTimeout(() => this.flushWorkspace(workspaceId), SAVE_DEBOUNCE_MS),
    );
  }

  flushWorkspace(workspaceId: string): void {
    const timer = this.saveTimers.get(workspaceId);
    if (timer) {
      clearTimeout(timer);
      this.saveTimers.delete(workspaceId);
    }
    const pref = this.workspacePrefs.get(workspaceId);
    if (!pref || !isClient()) return;
    this.ensureStorageVersion();
    try {
      pref.updatedAt = Date.now();
      persistWorkspaceEnvelope(workspaceId, pref);
      persistMeta();
    } catch {
      /* quota */
    }
  }

  flushAll(): void {
    for (const workspaceId of this.workspacePrefs.keys()) {
      this.flushWorkspace(workspaceId);
    }
  }

  private loadWorkspace(workspaceId: string): WorkspaceUIPreferences | null {
    if (!isClient()) return null;
    this.ensureStorageVersion();
    try {
      const raw = window.localStorage.getItem(workspaceStorageKey(workspaceId));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as WorkspaceUIPreferenceEnvelope;
      const schemaVersion = typeof parsed.schemaVersion === "number" ? parsed.schemaVersion : 1;
      if (
        !parsed.data ||
        typeof parsed.data.workspaceId !== "string" ||
        parsed.data.workspaceId !== workspaceId
      ) {
        window.localStorage.removeItem(workspaceStorageKey(workspaceId));
        return null;
      }
      if (schemaVersion > UI_PREFERENCE_SCHEMA_VERSION) {
        window.localStorage.removeItem(workspaceStorageKey(workspaceId));
        return null;
      }
      const data = migrateUIPreferenceData(workspaceId, parsed.data, schemaVersion);
      if (schemaVersion < UI_PREFERENCE_SCHEMA_VERSION) {
        data.updatedAt = Date.now();
        persistWorkspaceEnvelope(workspaceId, data);
      }
      return data;
    } catch {
      return null;
    }
  }

  private listenPageExit(): void {
    if (this.listening) return;
    this.listening = true;
    window.addEventListener("pagehide", () => this.flushAll());
    window.addEventListener("beforeunload", () => this.flushAll());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") this.flushAll();
    });
  }
}

export const uiPreferenceStore = new UIPreferenceStore();
