import { useCallback, useEffect, useState } from "react";
import { observer } from "mobx-react-lite";
import { RotateCcw } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { noteApi } from "@/lib/api";
import type { BackupSummary, StoredBackup } from "@shared/types";
import { noteStore } from "@/stores/note-store";
import { cn } from "@/lib/utils";
import { HistoryDiffPreview } from "@/components/tabs/HistoryDiffPreview";

const TRIGGER_LABEL: Record<BackupSummary["trigger"], string> = {
  manual: "Manual",
  auto: "Auto",
};

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export const NoteHistoryDialog = observer(function NoteHistoryDialog({ workspaceId }: { workspaceId: string }) {
  const [backups, setBackups] = useState<BackupSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState<StoredBackup | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<BackupSummary | null>(null);

  const open = noteStore.historyOpen;
  const noteId = noteStore.openNoteId;

  const loadList = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    setError(null);
    try {
      const { backups: list } = await noteApi.history(workspaceId, noteId);
      setBackups(list);
      setSelectedId(list.length > 0 ? list[0]!.backupId : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load history");
    } finally {
      setLoading(false);
    }
  }, [workspaceId, noteId]);

  useEffect(() => {
    if (!open || !noteId) return;
    setSelectedId(null);
    setPreview(null);
    setError(null);
    void loadList();
  }, [open, noteId, loadList]);

  useEffect(() => {
    if (!open || !noteId || !selectedId) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewLoading(true);
    void noteApi
      .historyItem(workspaceId, noteId, selectedId)
      .then(({ backup }) => {
        if (!cancelled) setPreview(backup);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load backup");
      })
      .finally(() => {
        if (!cancelled) setPreviewLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, selectedId, workspaceId, noteId]);

  const handleRestore = useCallback(
    async (summary: BackupSummary) => {
      setRestoring(true);
      setError(null);
      try {
        await noteStore.restoreBackup(workspaceId, summary.backupId);
        setConfirmRestore(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to restore");
      } finally {
        setRestoring(false);
      }
    },
    [workspaceId],
  );

  return (
    <>
      <Dialog
        open={open && noteId != null}
        onOpenChange={(next) => noteStore.setHistoryOpen(next)}
      >
        <DialogContent size="lg" className="gap-3">
          <DialogHeader>
            <DialogTitle>History</DialogTitle>
            <DialogDescription className="truncate">{noteStore.title}</DialogDescription>
          </DialogHeader>

          <div className="grid min-h-0 flex-1 grid-cols-[14rem_1fr] gap-3 overflow-hidden">
            <div className="min-h-0 overflow-auto rounded-md border border-divider">
              {loading ? (
                <p className="px-3 py-4 text-sm text-dim">Loading…</p>
              ) : backups.length === 0 ? (
                <p className="px-3 py-4 text-sm text-dim">No history</p>
              ) : (
                <ul className="divide-y divide-divider">
                  {backups.map((b) => (
                    <li key={b.backupId}>
                      <button
                        type="button"
                        onClick={() => setSelectedId(b.backupId)}
                        className={cn(
                          "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-raised",
                          selectedId === b.backupId && "bg-raised",
                        )}
                      >
                        <span className="font-medium text-ink">{formatTimestamp(b.createdAt)}</span>
                        <span className="text-xs text-dim">{TRIGGER_LABEL[b.trigger]}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="min-h-0 overflow-auto rounded-md border border-divider">
              {previewLoading ? (
                <p className="px-4 py-6 text-sm text-dim">Loading…</p>
              ) : preview ? (
                <HistoryDiffPreview current={noteStore.content} backup={preview.content} />
              ) : (
                <p className="px-4 py-6 text-sm text-dim">Select an item to preview.</p>
              )}
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}

          <DialogFooter>
            <Button
              type="button"
              disabled={!selectedId || restoring || !preview}
              onClick={() => {
                const summary = backups.find((b) => b.backupId === selectedId);
                if (summary) setConfirmRestore(summary);
              }}
            >
              <RotateCcw className="size-3.5" />
              {restoring ? "Restoring…" : "Restore this version"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog
        open={confirmRestore != null}
        onOpenChange={(next) => {
          if (!next) setConfirmRestore(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore this version?</AlertDialogTitle>
            <AlertDialogDescription>
              Your current edits will be replaced with the saved backup. A snapshot of your current note is saved first
              when it differs from the last history entry.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={restoring}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={restoring}
              onClick={() => {
                if (confirmRestore) void handleRestore(confirmRestore);
              }}
            >
              {restoring ? "Restoring…" : "Restore"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
});
