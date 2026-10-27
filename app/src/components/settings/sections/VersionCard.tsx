import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import { observer } from "mobx-react-lite";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { UpdateDialog, type UpdateDialogIntent } from "@/components/update/UpdateDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CLIENT_VERSION } from "@/lib/app-version";
import { cn } from "@/lib/utils";
import { BLOCKED_COPY, updateStore } from "@/stores/update-store";

function summary(): string {
  const check = updateStore.check;
  const current = updateStore.currentVersion ?? CLIENT_VERSION;
  if (!check) return `Running ${current}`;
  if (check.updateAvailable) return `Running ${current} · ${check.latestVersion} is available`;
  if (check.rolloutHeld) return `Running ${current} · ${check.latestVersion} is rolling out and reaches this Dotnote later`;
  if (check.latestVersion) return `Running ${current} · up to date`;
  return `Running ${current}`;
}

/** Settings › Cloudflare: the running version, a manual check, and the way back to the previous release. */
export const VersionCard = observer(function VersionCard() {
  const [dialog, setDialog] = useState<UpdateDialogIntent | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);

  useEffect(() => {
    void updateStore.refresh();
  }, []);

  const check = updateStore.check;
  const job = updateStore.job;
  const running = job?.status === "running";
  const blocked = check?.blockedReason ?? null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Dotnote version</CardTitle>
        <CardDescription>{summary()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col items-start gap-2">
        {blocked ? <p className="text-xs text-dim">{BLOCKED_COPY[blocked]}</p> : null}
        {running && job ? (
          <p className="text-xs text-dim">
            {job.kind === "rollback" ? "Going back to" : "Updating to"} {job.toVersion} · {job.step.index + 1}/
            {job.step.total} {job.message ?? job.step.label}
          </p>
        ) : null}
        {job?.status === "failed" ? (
          <p className="text-xs text-danger">
            Update to {job.toVersion} stopped at “{job.step.label}”: {job.message}
          </p>
        ) : null}
        {check?.error ? <p className="text-xs text-danger">{check.error}</p> : null}
        {updateStore.checkError ? <p className="text-xs text-danger">{updateStore.checkError}</p> : null}
        {updateStore.error ? <p className="text-xs text-danger">{updateStore.error}</p> : null}
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={updateStore.checking}
            onClick={() => void updateStore.refresh(true)}
          >
            <RefreshCw className={cn(updateStore.checking && "animate-spin")} />
            Check for updates
          </Button>
          {check?.updateAvailable && check.canUpdate && !running ? (
            <Button
              size="sm"
              onClick={() => {
                updateStore.prepare();
                setDialog("confirm");
              }}
            >
              Update to {check.latestVersion}…
            </Button>
          ) : null}
          {updateStore.phase === "done" ? (
            <Button size="sm" onClick={() => void updateStore.reload()}>
              Reload
            </Button>
          ) : null}
          {check?.rollbackVersion && !running ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={updateStore.busy || !!updateStore.startBlocker}
              title={updateStore.startBlocker ?? undefined}
              onClick={() => setConfirmRollback(true)}
            >
              Go back to {check.rollbackVersion}…
            </Button>
          ) : null}
        </div>
        {check ? (
          <p className="text-micro text-dim">
            Page {CLIENT_VERSION} · checked {new Date(check.checkedAt).toLocaleString()}
          </p>
        ) : null}
      </CardContent>
      <UpdateDialog
        open={dialog !== null}
        intent={dialog ?? "confirm"}
        onIntentChange={setDialog}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
      <ConfirmDialog
        open={confirmRollback}
        title={`Go back to Dotnote ${check?.rollbackVersion ?? ""}`}
        description={`This puts the ${check?.rollbackVersion ?? "previous"} Worker back in place. Your notes stay as they are, and database tables added by ${updateStore.currentVersion ?? "this version"} stay too.`}
        confirmLabel="Go back"
        onOpenChange={setConfirmRollback}
        onConfirm={() => void updateStore.rollback()}
      />
    </Card>
  );
});
