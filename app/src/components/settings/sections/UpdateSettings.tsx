import { useEffect, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";
import { observer } from "mobx-react-lite";

import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import { ReleaseNotesPreview } from "@/components/update/ReleaseNotesPreview";
import { UpdateDialog, type UpdateDialogIntent } from "@/components/update/UpdateDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FieldCheck } from "@/components/ui/field-check";
import { CLIENT_VERSION } from "@/lib/app-version";
import { openSettingsSection } from "@/lib/settings-route";
import { updateStatusSummary } from "@/lib/update-summary";
import { cn } from "@/lib/utils";
import { cloudflareStore } from "@/stores/cloudflare-store";
import { BLOCKED_COPY, updateStore } from "@/stores/update-store";

function JobProgress() {
  const job = updateStore.job;
  if (!job || job.status !== "running") return null;
  const percent = Math.round((job.step.index / job.step.total) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs text-dim">
        {job.kind === "rollback" ? "Going back to" : "Updating to"} {job.toVersion} · {job.step.index + 1}/
        {job.step.total} · {job.message ?? job.step.label}
      </p>
      <div className="h-1 overflow-hidden rounded-full bg-divider">
        <div className="h-full bg-accent-color transition-[width]" style={{ width: `${Math.max(4, percent)}%` }} />
      </div>
    </div>
  );
}

/** Settings › Updates: version, manual check, self-update, rollback, and release notes. */
export const UpdateSettings = observer(function UpdateSettings() {
  const [dialog, setDialog] = useState<UpdateDialogIntent | null>(null);
  const [confirmRollback, setConfirmRollback] = useState(false);

  useEffect(() => {
    void updateStore.refresh();
  }, []);

  const check = updateStore.check;
  const job = updateStore.job;
  const running = job?.status === "running";
  const blocked = check?.blockedReason ?? null;
  const needsReconnect = blocked === "missing_scopes" || blocked === "not_connected";
  const needsInstaller = blocked === "unconfigured";
  const workerVersion = updateStore.currentVersion ?? check?.currentVersion ?? "…";

  return (
    <SettingsSectionShell
      title="Updates"
      description="Check for Dotnote releases and update this instance from the installer when it was deployed that way."
      className="pb-10"
    >
      <Card>
        <CardHeader>
          <CardTitle>Installed version</CardTitle>
          <CardDescription>{updateStatusSummary()}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-3">
          <dl className="grid w-full gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-dim">Worker (this instance)</dt>
              <dd className="font-medium text-ink">{workerVersion}</dd>
            </div>
            <div>
              <dt className="text-dim">This page</dt>
              <dd className="font-medium text-ink">{CLIENT_VERSION}</dd>
            </div>
            {check?.latestVersion ? (
              <div className="sm:col-span-2">
                <dt className="text-dim">Latest release</dt>
                <dd className="font-medium text-ink">{check.latestVersion}</dd>
              </div>
            ) : null}
          </dl>

          {blocked ? <p className="text-xs text-dim">{BLOCKED_COPY[blocked]}</p> : null}
          {check?.rolloutHeld && check.latestVersion ? (
            <p className="text-xs text-dim">
              {check.latestVersion} is rolling out gradually and is not offered to this Dotnote yet.
            </p>
          ) : null}
          {check?.updateAvailable && !check.canUpdate && blocked && blocked !== "missing_scopes" ? (
            <p className="text-xs text-dim">A newer release exists, but this instance cannot install it automatically.</p>
          ) : null}
          {updateStore.startBlocker && !running ? (
            <p className="text-xs text-dim">{updateStore.startBlocker}</p>
          ) : null}

          {running ? <JobProgress /> : null}
          {updateStore.lostContact && running ? (
            <p className="text-xs text-dim">Dotnote stopped answering while it switched versions.</p>
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
                disabled={!!updateStore.startBlocker}
                title={updateStore.startBlocker ?? undefined}
                onClick={() => {
                  updateStore.prepare();
                  setDialog("confirm");
                }}
              >
                Update to {check.latestVersion}…
              </Button>
            ) : null}
            {check?.updateAvailable && check.notes ? (
              <Button size="sm" variant="ghost" onClick={() => setDialog("notes")}>
                What&apos;s new
              </Button>
            ) : null}
            {needsReconnect ? (
              <Button
                size="sm"
                disabled={cloudflareStore.connectionBusy}
                onClick={() => void cloudflareStore.reconnect()}
              >
                Reconnect Cloudflare
              </Button>
            ) : null}
            {needsInstaller ? (
              <Button size="sm" onClick={() => openSettingsSection("cloudflare")}>
                Connect from the installer…
              </Button>
            ) : null}
            {updateStore.phase === "done" ? (
              <Button size="sm" onClick={() => void updateStore.reload()}>
                Reload page
              </Button>
            ) : null}
            {job?.status === "failed" ? (
              <>
                {job.errorCode === "permission" ? (
                  <Button
                    size="sm"
                    disabled={cloudflareStore.connectionBusy}
                    onClick={() => void cloudflareStore.reconnect()}
                  >
                    Reconnect
                  </Button>
                ) : null}
                <Button size="sm" disabled={updateStore.busy} onClick={() => void updateStore.retry()}>
                  {updateStore.busy ? <Loader2 className="animate-spin" /> : null}
                  {job.errorCode === "unverified" ? "Check again" : "Retry"}
                </Button>
                <Button size="sm" variant="ghost" disabled={updateStore.busy} onClick={() => void updateStore.cancel()}>
                  Dismiss
                </Button>
              </>
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
            <p className="text-micro text-dim">Last checked {new Date(check.checkedAt).toLocaleString()}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Automatic updates</CardTitle>
          <CardDescription>
            {check?.credential === "grant"
              ? "Uses the Cloudflare permission this Dotnote stored at install."
              : "Needs the Cloudflare permission from the installer first."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <FieldCheck
            id="auto-update"
            checked={updateStore.autoUpdate}
            disabled={updateStore.autoBusy || (!updateStore.autoUpdate && !check?.canUpdate)}
            onCheckedChange={(enabled) => void updateStore.setAutoUpdate(enabled)}
            label="Install new releases on their own"
            description="Every 30 minutes this Dotnote checks for a release and installs it, even with no tab open. A release that asks for you, failed once, or that you went back from waits here instead. Open tabs offer a reload afterwards."
          />
          {check && !check.canUpdate && !updateStore.autoUpdate ? (
            <p className="text-xs text-dim">Available once this Dotnote can update itself.</p>
          ) : null}
        </CardContent>
      </Card>

      {check?.notes ? (
        <Card>
          <CardHeader>
            <CardTitle>Release notes</CardTitle>
            <CardDescription>
              {check.latestVersion && check.releasedAt
                ? `Dotnote ${check.latestVersion} · ${new Date(check.releasedAt).toLocaleDateString()}`
                : check.latestVersion
                  ? `Dotnote ${check.latestVersion}`
                  : "Latest release"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ReleaseNotesPreview source={check.notes} />
          </CardContent>
        </Card>
      ) : null}

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
    </SettingsSectionShell>
  );
});
