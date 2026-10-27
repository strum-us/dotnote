import MarkdownPreview from "@uiw/react-markdown-preview";
import { Loader2 } from "lucide-react";
import { observer } from "mobx-react-lite";

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
import { themeStore } from "@/stores/theme-store";
import { updateStore } from "@/stores/update-store";

import "@uiw/react-markdown-preview/markdown.css";

export type UpdateDialogIntent = "confirm" | "notes";

const ReleaseNotes = observer(function ReleaseNotes({ source }: { source: string }) {
  return (
    <div className="max-h-72 min-h-0 overflow-auto rounded-sm border border-divider bg-well px-3 py-2">
      <MarkdownPreview
        source={source}
        wrapperElement={{ "data-color-mode": themeStore.resolved }}
        style={{ backgroundColor: "transparent" }}
        className="!bg-transparent !text-[13px] [&_h1]:!mt-1 [&_h1]:!border-0 [&_h1]:!pb-0 [&_h1]:!text-base [&_h2]:!border-0 [&_h2]:!pb-0 [&_h2]:!text-sm [&_ul]:!list-disc"
      />
    </div>
  );
});

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
          <ReleaseNotes source={check.notes} />
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
