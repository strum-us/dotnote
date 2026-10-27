export type NoteTabMode = "preview" | "permanent";

export interface NoteTabSession {
  id: string;
  workspaceId: string;
  noteId: string;
  mode: NoteTabMode;
}
