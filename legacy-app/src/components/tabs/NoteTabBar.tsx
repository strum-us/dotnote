import { ChevronLeft, ChevronRight, Code2, PanelLeftOpen, Share } from "lucide-react";
import { observer } from "mobx-react-lite";

import { NoteHistoryButton } from "@/components/tabs/NoteHistoryButton";
import { NoteTabItem } from "@/components/tabs/NoteTabItem";
import { Button } from "@/components/ui/button";
import { noteLabelFromTree } from "@/lib/tree-utils";
import type { NoteWorkspaceTabs } from "@/stores/note-tabs-store";
import { workspaceStore } from "@/stores/workspace-store";

export const NoteTabBar = observer(function NoteTabBar({
  workspaceId,
  tabsSession,
  onSwitchNote,
  onCloseNote,
  sidebarCollapsed,
  onExpandSidebar,
  canBack,
  canForward,
  onBack,
  onForward,
  sourceView,
  onSourceViewChange,
  onShare,
  showEditorActions,
}: {
  workspaceId: string;
  tabsSession: NoteWorkspaceTabs;
  onSwitchNote: (noteId: string) => void;
  onCloseNote: (tabId: string) => void;
  sidebarCollapsed?: boolean;
  onExpandSidebar?: () => void;
  canBack?: boolean;
  canForward?: boolean;
  onBack?: () => void;
  onForward?: () => void;
  sourceView?: "wysiwyg" | "raw";
  onSourceViewChange?: () => void;
  onShare?: () => void;
  showEditorActions?: boolean;
}) {
  const showSidebarControls = Boolean(sidebarCollapsed && onExpandSidebar);
  if (tabsSession.tabs.length === 0 && !showSidebarControls) return null;

  return (
    <div className="flex h-9 shrink-0 select-none items-stretch bg-panel-header">
      {showSidebarControls ? (
        <div className="flex h-9 shrink-0 items-center gap-0.5 border-b border-divider px-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Expand sidebar"
            title="Expand sidebar"
            onClick={onExpandSidebar}
          >
            <PanelLeftOpen className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Previous"
            disabled={!canBack}
            onClick={onBack}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Next"
            disabled={!canForward}
            onClick={onForward}
          >
            <ChevronRight className="size-3.5" />
          </Button>
          <div className="mx-1 h-4 w-px shrink-0 bg-divider" />
        </div>
      ) : null}
      <div role="tablist" aria-label="Open notes" className="flex min-w-0 flex-1 items-stretch overflow-x-auto">
        {tabsSession.tabs.map((tab) => (
          <NoteTabItem
            key={tab.id}
            tab={tab}
            tabsSession={tabsSession}
            active={tab.id === tabsSession.activeTabId}
            label={noteLabelFromTree(workspaceStore.tree, tab.noteId) ?? "Untitled"}
            onSelect={() => {
              const noteId = tabsSession.switchTab(tab.id);
              if (noteId) onSwitchNote(noteId);
            }}
            onClose={() => onCloseNote(tab.id)}
          />
        ))}
        <div className="h-9 min-w-4 flex-1 border-b border-divider" aria-hidden />
      </div>
      <div className="ml-auto flex h-9 shrink-0 items-center gap-1 border-b border-divider pr-1">
        {showEditorActions && onSourceViewChange ? (
          <Button
            type="button"
            variant={sourceView === "raw" ? "secondary" : "ghost"}
            size="icon"
            className="size-7 shrink-0"
            aria-label={sourceView === "raw" ? "Rich text" : "Edit source"}
            aria-pressed={sourceView === "raw"}
            title={sourceView === "raw" ? "Rich text" : "Edit source"}
            onClick={onSourceViewChange}
          >
            <Code2 className={sourceView !== "raw" ? "text-dim" : undefined} />
          </Button>
        ) : null}
        {showEditorActions && onShare ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label="Share note"
            title="Share note"
            onClick={onShare}
          >
            <Share className="text-dim" />
          </Button>
        ) : null}
        <NoteHistoryButton workspaceId={workspaceId} />
      </div>
    </div>
  );
});
