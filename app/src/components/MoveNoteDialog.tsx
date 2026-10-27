import { useEffect, useState } from "react";
import { Folder } from "lucide-react";
import { observer } from "mobx-react-lite";
import type { TreeNode } from "@shared/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { DocsSortPreference } from "@/lib/docs-sort";
import { cn } from "@/lib/utils";
import { findTreeNode, flattenSidebarFolders } from "@/lib/tree-utils";
import { workspaceStore } from "@/stores/workspace-store";
import { syncStore } from "@/stores/sync-store";

type Props = {
  open: boolean;
  note: { id: string; name: string } | null;
  tree: TreeNode[];
  sort: DocsSortPreference;
  onOpenChange: (open: boolean) => void;
  onConfirm: (targetFolderId: string | null, newFolderName?: string) => void;
};

export const MoveNoteDialog = observer(function MoveNoteDialog({
  open,
  note,
  tree,
  sort,
  onOpenChange,
  onConfirm,
}: Props) {
  const [targetFolderId, setTargetFolderId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const workspaceId = workspaceStore.activeId;
  const node = note ? findTreeNode(tree, note.id) : null;

  const currentParentId =
    node && workspaceId
      ? node.parentPath
        ? (syncStore.view(workspaceId).entries.find((e) => e.type === "folder" && e.path === node.parentPath)?.id ??
          null)
        : null
      : null;

  useEffect(() => {
    if (!open) return;
    setTargetFolderId(currentParentId);
    setNewFolderOpen(false);
    setNewFolderName("");
  }, [open, note?.id, currentParentId]);

  const folders = flattenSidebarFolders(tree, sort);
  const trimmedNew = newFolderName.trim();
  const newFolderValid = !newFolderOpen || (trimmedNew.length >= 1 && trimmedNew.length <= 80);
  const canMove =
    newFolderOpen && trimmedNew
      ? newFolderValid
      : targetFolderId !== currentParentId || Boolean(trimmedNew);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to</DialogTitle>
        </DialogHeader>
        {note ? (
          <div className="flex flex-col gap-3">
            <p className="text-xs text-dim">
              Move <span className="font-medium text-ink-secondary">{note.name}</span>
            </p>
            <div className="max-h-[240px] overflow-auto rounded-sm border border-divider py-1">
              {folders.map((row) => (
                <button
                  key={row.id ?? "root"}
                  type="button"
                  className={cn(
                    "flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-compact hover:bg-raised",
                    targetFolderId === row.id && !newFolderOpen && "bg-raised",
                  )}
                  style={{ paddingLeft: 8 + row.depth * 12 }}
                  onClick={() => {
                    setTargetFolderId(row.id);
                    setNewFolderOpen(false);
                  }}
                >
                  <Folder className="size-3.5 shrink-0 text-dim" />
                  <span className="truncate">{row.name}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-col gap-2">
              <Button
                type="button"
                variant={newFolderOpen ? "secondary" : "outline"}
                size="sm"
                className="w-fit"
                onClick={() => setNewFolderOpen((v) => !v)}
              >
                New folder
              </Button>
              {newFolderOpen ? (
                <div className="flex flex-col gap-1">
                  <Label htmlFor="move-new-folder">Folder name</Label>
                  <Input
                    id="move-new-folder"
                    value={newFolderName}
                    autoFocus
                    maxLength={80}
                    onChange={(e) => setNewFolderName(e.target.value)}
                    placeholder="Folder name"
                  />
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            disabled={!canMove || !newFolderValid}
            onClick={() => {
              if (!note) return;
              onConfirm(targetFolderId, newFolderOpen && trimmedNew ? trimmedNew : undefined);
              onOpenChange(false);
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
