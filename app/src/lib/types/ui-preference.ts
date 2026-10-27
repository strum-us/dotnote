import type { NoteTabMode } from "@/lib/types/note-tabs";

export interface NoteCaretPreference {
  blockId: string;
}

export interface NoteUIPreference {
  scrollTop: number;
  scrollLeft: number;
  caret?: NoteCaretPreference;
  lastVisitedAt: number;
}

export interface NoteTabPreference {
  id: string;
  noteId: string;
  mode: NoteTabMode;
}

export interface WorkspaceUIPreferences {
  workspaceId: string;
  updatedAt: number;
  notes: {
    lastActiveNoteId?: string;
    activeTabId?: string;
    tabs: NoteTabPreference[];
    noteUi: Record<string, NoteUIPreference>;
    sidebarExpandedPaths?: string[];
  };
}

export interface UIPreferenceMeta {
  buildVersion?: string;
  schemaVersion: number;
}

export interface WorkspaceUIPreferenceEnvelope {
  buildVersion?: string;
  schemaVersion: number;
  data: WorkspaceUIPreferences;
}
