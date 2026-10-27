import { useState, type ReactNode } from "react";
import { ArrowUpCircle, Loader2, X } from "lucide-react";
import { observer } from "mobx-react-lite";

import { UpdateDialog, type UpdateDialogIntent } from "@/components/update/UpdateDialog";
import { Button } from "@/components/ui/button";
import { cloudflareStore } from "@/stores/cloudflare-store";
import { updateStore } from "@/stores/update-store";

function Shell({
  title,
  detail,
  onLater,
  children,
}: {
  title: string;
  detail?: string | null;
  /** Hide the banner until a newer release. */
  onLater?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="mx-2 mb-1 rounded-md border border-divider bg-raised px-2.5 py-2" role="status" aria-live="polite">
      <div className="flex items-start gap-1">
        <p className="min-w-0 flex-1 text-xs font-medium text-ink">{title}</p>
        {onLater ? (
          <button
            type="button"
            className="-mr-1 -mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-sm text-dim hover:bg-raised-hover hover:text-ink"
            aria-label="Later"
            title="Later"
            onClick={onLater}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {detail ? <p className="mt-0.5 line-clamp-3 text-[11px] text-dim">{detail}</p> : null}
      {children}
    </div>
  );
}

const Progress = observer(function Progress() {
  const job = updateStore.job;
  if (!job) return null;
  const percent = Math.round((job.step.index / job.step.total) * 100);
  return (
    <div className="mt-1.5 h-0.5 overflow-hidden rounded-full bg-divider">
      <div className="h-full bg-accent-color transition-[width]" style={{ width: `${Math.max(4, percent)}%` }} />
    </div>
  );
});

/** Sidebar slot above the account row. Shows nothing unless there is an update, a running one, or a failed one. */
export const UpdateBanner = observer(function UpdateBanner() {
  const [dialog, setDialog] = useState<UpdateDialogIntent | null>(null);
  const phase = updateStore.phase;
  const job = updateStore.job;
  const latest = updateStore.latestVersion;

  function openDialog(intent: UpdateDialogIntent) {
    if (intent === "confirm") updateStore.prepare();
    setDialog(intent);
  }

  let body: ReactNode = null;
  if (updateStore.bannerVisible) {
    if (phase === "available") {
      body = (
        <Shell title={`Dotnote ${latest} is available`} detail={updateStore.error} onLater={updateStore.dismiss}>
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button size="sm" variant="default" onClick={() => openDialog("confirm")}>
              <ArrowUpCircle />
              Update
            </Button>
            <Button size="sm" variant="ghost" onClick={() => openDialog("notes")}>
              What’s new
            </Button>
          </div>
        </Shell>
      );
    } else if (phase === "blocked") {
      body = (
        <Shell
          title={`Dotnote ${latest} is available`}
          detail="Reconnect Cloudflare to let this Dotnote update itself."
          onLater={updateStore.dismiss}
        >
          <div className="mt-1.5 flex flex-wrap gap-1">
            <Button
              size="sm"
              variant="default"
              disabled={cloudflareStore.connectionBusy}
              onClick={() => void cloudflareStore.reconnect()}
            >
              Reconnect
            </Button>
          </div>
        </Shell>
      );
    } else if (phase === "updating" && job) {
      const verb = job.kind === "rollback" ? "Going back to" : "Updating to";
      body = updateStore.lostContact ? (
        <Shell title={`${verb} ${job.toVersion}`} detail="Dotnote stopped answering while it switched versions.">
          <div className="mt-1.5 flex gap-1">
            <Button size="sm" variant="outline" onClick={() => void updateStore.refresh()}>
              Check again
            </Button>
          </div>
        </Shell>
      ) : (
        <Shell
          title={`${verb} ${job.toVersion}`}
          detail={`${job.step.index + 1}/${job.step.total} · ${job.message ?? job.step.label}`}
        >
          <Progress />
        </Shell>
      );
    } else if (phase === "done") {
      body = (
        <Shell title={`Dotnote ${updateStore.currentVersion} is ready`} detail="Reload to use the new version.">
          <div className="mt-1.5 flex gap-1">
            <Button size="sm" variant="default" onClick={() => void updateStore.reload()}>
              Reload
            </Button>
          </div>
        </Shell>
      );
    } else if (phase === "failed" && job) {
      const unverified = job.errorCode === "unverified";
      body = (
        <Shell
          title={unverified ? `Dotnote ${job.toVersion} has not answered yet` : `Update to ${job.toVersion} stopped`}
          detail={updateStore.error ?? job.message}
        >
          <div className="mt-1.5 flex flex-wrap gap-1">
            {job.errorCode === "permission" ? (
              <Button
                size="sm"
                variant="default"
                disabled={cloudflareStore.connectionBusy}
                onClick={() => void cloudflareStore.reconnect()}
              >
                Reconnect
              </Button>
            ) : null}
            <Button
              size="sm"
              variant={job.errorCode === "permission" ? "outline" : "default"}
              disabled={updateStore.busy}
              onClick={() => void updateStore.retry()}
            >
              {updateStore.busy ? <Loader2 className="animate-spin" /> : null}
              {unverified ? "Check again" : "Retry"}
            </Button>
            <Button size="sm" variant="ghost" disabled={updateStore.busy} onClick={() => void updateStore.cancel()}>
              Dismiss
            </Button>
          </div>
        </Shell>
      );
    }
  }

  return (
    <>
      {body}
      <UpdateDialog
        open={dialog !== null}
        intent={dialog ?? "notes"}
        onIntentChange={setDialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </>
  );
});
