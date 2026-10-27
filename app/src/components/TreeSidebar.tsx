import { useEffect, useRef, useState } from "react";
import { ArrowUpDown, FileText, Folder, MoreHorizontal, Plus, Settings } from "lucide-react";
import { observer } from "mobx-react-lite";
import type { TreeNode } from "@shared/types";
import { displayEntryName } from "@shared/title";
import { cn } from "@/lib/utils";
import { authStore } from "@/stores/auth-store";
import { workspaceStore } from "@/stores/workspace-store";
import { noteStore } from "@/stores/note-store";
import { uiPreferenceStore } from "@/stores/ui-preference-store";
import { WorkspaceHeaderRow } from "@/components/navigation/WorkspaceHeaderRow";
import { MoveNoteDialog } from "@/components/MoveNoteDialog";
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
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { NameDialog } from "@/components/NameDialog";
import { SyncIndicator } from "@/components/SyncIndicator";
import { sidebarTree } from "@/lib/tree-utils";

type DialogState =
  | { kind: "folder"; parentId: string | null }
  | { kind: "rename"; id: string; type: "note" | "folder"; name: string }
  | null;

type ConfirmState = { id: string; name: string } | null;
type MoveTarget = { id: string; name: string } | null;

function accountInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + last).toUpperCase();
}

type Props = {
  selectedNoteId: string | null;
  onPreviewNote: (id: string) => void;
  onPermanentNote: (id: string) => void;
  onCreatedNote: (id: string) => void;
  canBack: boolean;
  canForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onCollapseSidebar: () => void;
  onSelectWorkspace: (id: string) => void;
  onNewWorkspace: () => void;
  onOpenSettings: () => void;
};

const Row = observer(function Row({
  node,
  depth,
  selectedNoteId,
  onPreviewNote,
  onPermanentNote,
  onAsk,
  onConfirm,
  onAddNote,
  onMove,
  onDuplicate,
  workspaceId,
  sort,
}: {
  node: TreeNode;
  depth: number;
  selectedNoteId: string | null;
  onPreviewNote: (id: string) => void;
  onPermanentNote: (id: string) => void;
  onAsk: (dialog: DialogState) => void;
  onConfirm: (confirm: ConfirmState) => void;
  onAddNote: (parentId: string) => void;
  onMove: (target: MoveTarget) => void;
  onDuplicate: (noteId: string) => void;
  workspaceId: string | null;
  sort: typeof uiPreferenceStore.docsSort;
}) {
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const isFolder = node.type === "folder";
  const expanded = isFolder && workspaceStore.expanded.has(node.path);
  const active = !isFolder && selectedNoteId === node.id;
  const label = isFolder ? node.name || "Untitled" : displayEntryName(node.name);
  const syncState = workspaceId ? noteStore.syncStateOf(workspaceId, node.id) : "synced";

  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const handleNoteClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
      return;
    }
    clickTimerRef.current = setTimeout(() => {
      clickTimerRef.current = null;
      onPreviewNote(node.id);
    }, 220);
  };

  const handleNoteDoubleClick = () => {
    if (clickTimerRef.current) {
      clearTimeout(clickTimerRef.current);
      clickTimerRef.current = null;
    }
    onPermanentNote(node.id);
  };

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div
            ref={rowRef}
            className={cn(
              "group mx-2 flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1.5 hover:bg-raised",
              active && "bg-raised-hover text-ink hover:bg-raised-hover",
            )}
            style={{ paddingLeft: 6 + depth * 12 }}
            onClick={() => {
              if (isFolder) workspaceStore.toggleExpanded(node.path);
              else handleNoteClick();
            }}
            onDoubleClick={() => {
              if (!isFolder) handleNoteDoubleClick();
            }}
          >
            {isFolder ? (
              <Folder className="size-3.5 shrink-0 text-dim" />
            ) : (
              <FileText className="size-3.5 shrink-0 text-dim" />
            )}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            <SyncIndicator state={syncState} className="mr-0.5 group-hover:hidden" />
            {!isFolder ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="hidden size-5 shrink-0 p-0 group-hover:inline-flex data-[state=open]:inline-flex"
                    aria-label="Note menu"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal className="size-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-[10rem]">
                  <DropdownMenuItem onSelect={() => onMove({ id: node.id, name: label })}>Move to…</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => onDuplicate(node.id)}>Duplicate</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => onAsk({ kind: "rename", id: node.id, type: node.type, name: label })}>
                    Rename
                  </DropdownMenuItem>
                  <DropdownMenuItem variant="destructive" onSelect={() => onConfirm({ id: node.id, name: label })}>
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
            {isFolder ? (
              <Button
                size="sm"
                variant="ghost"
                className="hidden size-5 shrink-0 p-0 group-hover:inline-flex"
                title="New note"
                onClick={(event) => {
                  event.stopPropagation();
                  onAddNote(node.id);
                }}
              >
                <Plus className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent>
          {isFolder ? (
            <>
              <ContextMenuItem onSelect={() => onAddNote(node.id)}>New note</ContextMenuItem>
              <ContextMenuItem onSelect={() => onAsk({ kind: "folder", parentId: node.id })}>New folder</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          ) : (
            <>
              <ContextMenuItem onSelect={() => onMove({ id: node.id, name: label })}>Move to…</ContextMenuItem>
              <ContextMenuItem onSelect={() => onDuplicate(node.id)}>Duplicate</ContextMenuItem>
              <ContextMenuSeparator />
            </>
          )}
          <ContextMenuItem onSelect={() => onAsk({ kind: "rename", id: node.id, type: node.type, name: label })}>
            Rename
          </ContextMenuItem>
          <ContextMenuItem variant="destructive" onSelect={() => onConfirm({ id: node.id, name: label })}>
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
      {isFolder && expanded
        ? sidebarTree(node.children ?? [], sort).map((child) => (
            <Row
              key={child.id}
              node={child}
              depth={depth + 1}
              selectedNoteId={selectedNoteId}
              onPreviewNote={onPreviewNote}
              onPermanentNote={onPermanentNote}
              onAsk={onAsk}
              onConfirm={onConfirm}
              onAddNote={onAddNote}
              onMove={onMove}
              onDuplicate={onDuplicate}
              workspaceId={workspaceId}
              sort={sort}
            />
          ))
        : null}
    </>
  );
});

export const TreeSidebar = observer(function TreeSidebar({
  selectedNoteId,
  onPreviewNote,
  onPermanentNote,
  onCreatedNote,
  canBack,
  canForward,
  onBack,
  onForward,
  onCollapseSidebar,
  onSelectWorkspace,
  onNewWorkspace,
  onOpenSettings,
}: Props) {
  const [dialog, setDialog] = useState<DialogState>(null);
  const [confirm, setConfirm] = useState<ConfirmState>(null);
  const [moveTarget, setMoveTarget] = useState<MoveTarget>(null);
  const workspaceId = workspaceStore.activeId;
  const sort = uiPreferenceStore.docsSort;
  const accountName = authStore.user?.fullName || authStore.user?.email || "Account";

  function submitName(value: string) {
    if (!dialog || !workspaceId) return;
    if (dialog.kind === "folder") workspaceStore.addFolder(dialog.parentId, value);
    else if (dialog.type === "note") noteStore.renameNote(workspaceId, dialog.id, value);
    else workspaceStore.renameFolder(dialog.id, value);
  }

  function addNote(parentId: string | null) {
    const id = workspaceStore.addNote(parentId);
    if (!id) return;
    noteStore.armTitleFocus(id);
    onCreatedNote(id);
  }

  function duplicateNote(noteId: string) {
    void workspaceStore.duplicateNote(noteId).then((newId) => {
      if (newId) onPermanentNote(newId);
    });
  }

  return (
    <aside className="flex h-full w-60 shrink-0 select-none flex-col border-r border-divider bg-sidebar">
      <WorkspaceHeaderRow
        workspaceId={workspaceId}
        canBack={canBack}
        canForward={canForward}
        onBack={onBack}
        onForward={onForward}
        onCollapse={onCollapseSidebar}
        onSelectWorkspace={onSelectWorkspace}
        onNewWorkspace={onNewWorkspace}
      />
      <div className="group flex shrink-0 items-center justify-between px-3 pb-1 pt-4">
        <div className="flex items-center gap-0.5">
          <span className="text-[11px] font-medium text-dim">Docs</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-1"
                title="Sort"
                aria-label="Sort"
              >
                <ArrowUpDown className="size-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[10rem]">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort.field}
                onValueChange={(value) =>
                  uiPreferenceStore.setDocsSort(value as typeof sort.field, sort.direction)
                }
              >
                <DropdownMenuRadioItem value="name">Name</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="created">Created</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="updated">Updated</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Order</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={sort.direction}
                onValueChange={(value) =>
                  uiPreferenceStore.setDocsSort(sort.field, value as typeof sort.direction)
                }
              >
                <DropdownMenuRadioItem value="asc">Ascending</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc">Descending</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center opacity-0 group-hover:opacity-100">
          <Button size="sm" variant="ghost" className="h-6 px-1" title="New note" onClick={() => addNote(null)}>
            <Plus className="size-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-1"
            title="New folder"
            onClick={() => setDialog({ kind: "folder", parentId: null })}
          >
            <Folder className="size-3.5" />
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto py-1">
        {sidebarTree(workspaceStore.tree, sort).map((node) => (
          <Row
            key={node.id}
            node={node}
            depth={0}
            selectedNoteId={selectedNoteId}
            onPreviewNote={onPreviewNote}
            onPermanentNote={onPermanentNote}
            onAsk={setDialog}
            onConfirm={setConfirm}
            onAddNote={addNote}
            onMove={setMoveTarget}
            onDuplicate={duplicateNote}
            workspaceId={workspaceId}
            sort={sort}
          />
        ))}
      </div>
      <div className="flex shrink-0 items-center gap-2 px-3 pb-3 pt-2">
        <span
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-raised text-[11px] font-medium text-ink-secondary"
          aria-hidden
        >
          {accountInitials(accountName)}
        </span>
        <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{accountName}</span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 rounded-md text-dim"
          aria-label="Settings"
          title="Settings"
          onClick={onOpenSettings}
        >
          <Settings className="size-4" />
        </Button>
      </div>
      <NameDialog
        open={dialog !== null}
        title={dialog?.kind === "rename" ? "Rename" : "New folder"}
        label="Name"
        initial={dialog?.kind === "rename" ? dialog.name : ""}
        confirmLabel={dialog?.kind === "rename" ? "Rename" : "Create"}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
        onSubmit={submitName}
      />
      <MoveNoteDialog
        open={moveTarget !== null}
        note={moveTarget}
        tree={workspaceStore.tree}
        sort={sort}
        onOpenChange={(open) => {
          if (!open) setMoveTarget(null);
        }}
        onConfirm={(targetFolderId, newFolderName) => {
          if (moveTarget) workspaceStore.moveNote(moveTarget.id, targetFolderId, newFolderName);
        }}
      />
      <ConfirmDialog
        open={confirm !== null}
        title="Delete"
        description={confirm ? `Delete “${confirm.name}”? This removes it from your workspace.` : ""}
        onOpenChange={(open) => {
          if (!open) setConfirm(null);
        }}
        onConfirm={() => {
          if (confirm) workspaceStore.deleteEntry(confirm.id);
        }}
      />
    </aside>
  );
});
