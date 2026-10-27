import { observer } from "mobx-react-lite";
import { useCallback, useEffect, useRef, useState } from "react";

import { MarkdownEditor, type MarkdownEditorHandle } from "@/components/MarkdownEditor";
import { MarkdownRawEditor, type MarkdownRawEditorHandle } from "@/components/MarkdownRawEditor";
import { NoteShareDialog } from "@/components/NoteShareDialog";
import { NoteTabBar } from "@/components/tabs/NoteTabBar";
import { Button } from "@/components/ui/button";
import type { OpenNoteOptions } from "@/lib/note-route";
import { noteStore } from "@/stores/note-store";
import { noteTabsStore } from "@/stores/note-tabs-store";

export type MarkdownSourceView = "wysiwyg" | "raw";

export const NoteEditor = observer(function NoteEditor({
  workspaceId,
  onSwitchNote,
  sidebarCollapsed,
  onExpandSidebar,
  canBack,
  canForward,
  onBack,
  onForward,
}: {
  workspaceId: string;
  onSwitchNote: (noteId: string, opts?: OpenNoteOptions) => void;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  canBack?: boolean;
  canForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
}) {
  const wysiwygRef = useRef<MarkdownEditorHandle>(null);
  const rawRef = useRef<MarkdownRawEditorHandle>(null);
  const [sourceView, setSourceView] = useState<MarkdownSourceView>("wysiwyg");
  const [shareOpen, setShareOpen] = useState(false);
  const tabsSession = noteTabsStore.workspace(workspaceId);
  const noteId = noteStore.openNoteId;
  const showEditor = Boolean(noteId && noteStore.editorReady && !noteStore.loadFailed);

  useEffect(() => {
    setSourceView("wysiwyg");
  }, [noteId]);

  const flushEditor = useCallback(() => {
    wysiwygRef.current?.flushViewState();
    rawRef.current?.flushSnapshot();
  }, []);

  function handleCloseTab(tabId: string) {
    flushEditor();
    if (tabsSession.activeTabId === tabId) noteStore.checkpoint();
    const nextNoteId = tabsSession.closeTab(tabId);
    if (nextNoteId) onSwitchNote(nextNoteId, { history: "replace" });
  }

  function handleSwitchNote(nextNoteId: string) {
    if (noteStore.openNoteId === nextNoteId) return;
    flushEditor();
    noteStore.checkpoint();
    onSwitchNote(nextNoteId, { history: "replace" });
  }

  const toggleSourceView = useCallback(() => {
    flushEditor();
    noteStore.checkpoint();
    setSourceView((prev) => (prev === "raw" ? "wysiwyg" : "raw"));
  }, [flushEditor]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <NoteTabBar
        workspaceId={workspaceId}
        tabsSession={tabsSession}
        onSwitchNote={handleSwitchNote}
        onCloseNote={handleCloseTab}
        sidebarCollapsed={sidebarCollapsed}
        onExpandSidebar={onExpandSidebar}
        canBack={canBack}
        canForward={canForward}
        onBack={onBack}
        onForward={onForward}
        showEditorActions={showEditor}
        sourceView={sourceView}
        onSourceViewChange={showEditor ? toggleSourceView : undefined}
        onShare={showEditor ? () => setShareOpen(true) : undefined}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {noteStore.conflict ? (
          <div className="flex items-center gap-2 border-b border-divider bg-amber-50 px-3 py-1.5 text-xs text-amber-900">
            <span className="min-w-0 flex-1">
              This note changed on the server since you started editing. Your version is kept here until you choose.
            </span>
            <Button size="sm" variant="ghost" onClick={noteStore.keepLocalVersion}>
              Keep mine
            </Button>
            <Button size="sm" variant="ghost" onClick={noteStore.useServerVersion}>
              Use server copy
            </Button>
          </div>
        ) : null}
        {sourceView === "raw" && showEditor ? (
          <MarkdownRawEditor
            ref={rawRef}
            key={`raw:${noteId}:${noteStore.hydrateToken}`}
            value={noteStore.content}
            onChange={(value) => noteStore.setContent(workspaceId, value)}
          />
        ) : (
          <MarkdownEditor ref={wysiwygRef} workspaceId={workspaceId} />
        )}
      </div>
      <NoteShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        workspaceId={workspaceId}
        noteId={noteId}
        onPrepare={() => {
          flushEditor();
          noteStore.checkpoint();
        }}
      />
    </div>
  );
});
