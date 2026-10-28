import { Loader2 } from "lucide-react";
import { observer } from "mobx-react-lite";

import { ReleaseNotesPreview } from "@/components/update/ReleaseNotesPreview";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { formatBytes } from "@/lib/format-bytes";
import { updateStore } from "@/stores/update-store";

export type UpdateDialogIntent = "confirm" | "notes";

/** Release notes, and the one confirmation before this Dotnote replaces its own Worker. */
export const UpdateDialog = observer(function UpdateDialog({
  open,
  intent,
  onIntentChange,
  onOpenChange,
}: {
  open: boolean;
  intent: UpdateDialogIntent;
  onIntentChange: (intent: UpdateDialogIntent) => void;
  onOpenChange: (open: boolean) => void;
}) {
  const check = updateStore.check;
  const latest = updateStore.latestVersion;
  const blocker = updateStore.startBlocker;
  const canStart = !!check?.updateAvailable && check.canUpdate;
  const details = [
    check?.currentVersion && latest ? `${check.currentVersion} → ${latest}` : null,
    check?.sizeBytes ? formatBytes(check.sizeBytes) : null,
    check?.releasedAt ? `released ${new Date(check.releasedAt).toLocaleDateString()}` : null,
  ].filter(Boolean);

  async function start() {
    if (await updateStore.start()) onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{intent === "confirm" ? `Update to Dotnote ${latest ?? ""}` : `What’s new in Dotnote ${latest ?? ""}`}</DialogTitle>
          <DialogDescription>
            {intent === "confirm"
              ? "This replaces the Worker code in your Cloudflare account. Your notes in R2 and D1 stay where they are; new database tables are added before the switch. This page reloads when the new version answers."
              : details.join(" · ")}
          </DialogDescription>
        </DialogHeader>
        {intent === "confirm" && details.length ? <p className="text-xs text-dim">{details.join(" · ")}</p> : null}
        {check?.notes ? (
          <ReleaseNotesPreview source={check.notes} />
        ) : (
          <p className="text-xs text-dim">This release has no notes.</p>
        )}
        {intent === "confirm" && blocker ? <p className="text-xs text-dim">{blocker} The update can start once that is done.</p> : null}
        {updateStore.error ? <p className="text-xs text-danger">{updateStore.error}</p> : null}
        <DialogFooter className="gap-2">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {intent === "confirm" ? "Cancel" : "Close"}
          </Button>
          {intent === "confirm" ? (
            <Button
              type="button"
              variant="default"
              disabled={!canStart || !!blocker || updateStore.busy}
              onClick={() => void start()}
            >
              {updateStore.busy ? <Loader2 className="animate-spin" /> : null}
              Update now
            </Button>
          ) : canStart ? (
            <Button
              type="button"
              variant="default"
              onClick={() => {
                updateStore.prepare();
                onIntentChange("confirm");
              }}
            >
              Update…
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
});
