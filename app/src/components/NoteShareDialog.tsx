import { Link2, Loader2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { noteApi } from "@/lib/api";
import type { NoteShareStatus } from "@shared/types";

export function NoteShareDialog({
  open,
  onOpenChange,
  workspaceId,
  noteId,
  onPrepare,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  noteId: string | null;
  onPrepare?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [share, setShare] = useState<NoteShareStatus | null>(null);

  const refresh = useCallback(async () => {
    if (!noteId) return;
    setLoading(true);
    try {
      const status = await noteApi.shareStatus(workspaceId, noteId);
      setShare(status);
    } catch {
      toast.error("Could not load share status.");
      setShare(null);
    } finally {
      setLoading(false);
    }
  }, [workspaceId, noteId]);

  useEffect(() => {
    if (!open || !noteId) return;
    void refresh();
  }, [open, noteId, refresh]);

  async function enableShare() {
    if (!noteId) return;
    onPrepare?.();
    setLoading(true);
    try {
      const next = await noteApi.createShare(workspaceId, noteId);
      setShare(next);
      toast.success("Share link ready.");
    } catch {
      toast.error("Could not create share link.");
    } finally {
      setLoading(false);
    }
  }

  async function copyLink() {
    if (!share?.url) return;
    try {
      await navigator.clipboard.writeText(share.url);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy link.");
    }
  }

  async function revoke() {
    if (!noteId) return;
    setRevoking(true);
    try {
      await noteApi.revokeShare(workspaceId, noteId);
      setShare({ active: false });
      toast.success("Share link revoked.");
    } catch {
      toast.error("Could not revoke share link.");
    } finally {
      setRevoking(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share note</DialogTitle>
          <DialogDescription>
            Anyone with the link sees a read-only rendered page. Edits in the app are not included until they are saved
            to the server.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {loading && !share ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              Loading…
            </div>
          ) : share?.active && share.url ? (
            <>
              <Input readOnly value={share.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
              <div className="flex flex-wrap gap-2">
                <Button type="button" className="flex-1" onClick={() => void copyLink()}>
                  <Link2 className="size-4" />
                  Copy link
                </Button>
                <Button type="button" variant="outline" onClick={() => void revoke()} disabled={revoking}>
                  {revoking ? "Revoking…" : "Revoke link"}
                </Button>
              </div>
            </>
          ) : (
            <Button type="button" className="w-full" onClick={() => void enableShare()} disabled={loading || !noteId}>
              {loading ? "Creating…" : "Create share link"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
