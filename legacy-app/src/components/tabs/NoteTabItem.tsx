import { SyncIndicator } from "@/components/SyncIndicator";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NoteTabSession } from "@/lib/types/note-tabs";
import type { NoteWorkspaceTabs } from "@/stores/note-tabs-store";
import { noteStore } from "@/stores/note-store";
import { displayEntryName } from "@shared/title";
import { FileText, MoreHorizontal, X } from "lucide-react";
import { observer } from "mobx-react-lite";

export const NoteTabItem = observer(function NoteTabItem({
  tab,
  tabsSession,
  active,
  label,
  onSelect,
  onClose,
}: {
  tab: NoteTabSession;
  tabsSession: NoteWorkspaceTabs;
  active: boolean;
  label: string;
  onSelect: () => void;
  onClose: () => void;
}) {
  const isPreview = tab.mode === "preview";
  const syncState = noteStore.syncStateOf(tab.workspaceId, tab.noteId);

  const tabShell = (
    <div
      role="tab"
      aria-selected={active}
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/note-tab-id", tab.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        const fromId = event.dataTransfer.getData("text/note-tab-id");
        if (!fromId || fromId === tab.id) return;
        const fromIndex = tabsSession.tabs.findIndex((t) => t.id === fromId);
        const toIndex = tabsSession.tabs.findIndex((t) => t.id === tab.id);
        if (fromIndex >= 0 && toIndex >= 0) tabsSession.reorderTabs(fromIndex, toIndex);
      }}
      className={cn(
        "group flex h-9 max-w-[220px] shrink-0 items-center gap-1 border-r border-divider px-2 text-compact",
        active
          ? "pro-dock-tab-active border-b-0 text-ink"
          : "border-b border-divider text-dim hover:bg-raised hover:text-ink",
      )}
    >
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-1 text-left"
        onClick={onSelect}
        onDoubleClick={() => tabsSession.promoteToPermanent(tab.id)}
      >
        <FileText className={cn("size-3 shrink-0", active ? "text-ink-secondary" : "opacity-70")} />
        <span
          className={cn(
            "min-w-0 flex-1 truncate text-xs",
            isPreview ? "italic font-normal" : "not-italic font-medium",
          )}
        >
          {displayEntryName(label) || "Untitled"}
        </span>
        <SyncIndicator state={syncState} />
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
            aria-label="Tab menu"
            onClick={(e) => e.stopPropagation()}
          >
            <MoreHorizontal className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          <DropdownMenuItem onSelect={() => tabsSession.promoteToPermanent(tab.id)}>Pin tab</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => tabsSession.closeOtherTabs(tab.id)}>Close others</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={onClose}>Close</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 opacity-0 group-hover:opacity-100"
        aria-label={`Close ${label}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{tabShell}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={tab.mode === "permanent"}
          onSelect={() => tabsSession.promoteToPermanent(tab.id)}
        >
          Pin tab
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => tabsSession.closeOtherTabs(tab.id)}>Close others</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={onClose}>Close</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
