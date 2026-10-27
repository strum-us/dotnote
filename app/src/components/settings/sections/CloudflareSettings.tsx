import { useEffect, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";
import { observer } from "mobx-react-lite";
import { SettingsField, SettingsSectionShell } from "@/components/settings/SettingsSectionShell";
import { CloudflareMigrationDialog } from "@/components/settings/sections/CloudflareMigrationDialog";
import { VersionCard } from "@/components/settings/sections/VersionCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes } from "@/lib/format-bytes";
import { cloudflareStore } from "@/stores/cloudflare-store";
import type { R2UsageCategory } from "@shared/types";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<R2UsageCategory, string> = {
  notes: "Notes",
  history: "History",
  assets: "Images & assets",
  manifests: "Manifests",
  other: "Other",
};

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn("inline-block size-2 rounded-full", ok ? "bg-green-500" : "bg-danger")}
      aria-hidden
    />
  );
}

export const CloudflareSettings = observer(function CloudflareSettings() {
  const [migrationOpen, setMigrationOpen] = useState(false);

  useEffect(() => {
    cloudflareStore.ensureLoaded();
  }, []);

  const status = cloudflareStore.status;
  const usage = cloudflareStore.usage;
  const usagePct =
    usage && usage.freeTierBytes > 0 ? Math.min(100, (usage.totalBytes / usage.freeTierBytes) * 100) : 0;

  return (
    <>
      <SettingsSectionShell
        title="Cloudflare"
        description="Worker, R2 bucket, and storage used by your workspaces on this instance."
        className="pb-10"
      >
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <StatusDot ok={status?.connection.connected ?? false} />
              Cloudflare connection
            </CardTitle>
            <CardDescription>
              {status?.connection.connected
                ? "This instance keeps the Cloudflare permission and renews it when it calls the API. Notes stay on this Worker if you revoke it."
                : "Deploy Dotnote into your Cloudflare account from the installer. The permission is stored on the new instance, not on the installer."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col items-start gap-2">
            {status?.connection.connected ? (
              <p className="text-xs text-dim">
                Account {status.connection.accountId} · {status.connection.scopes.length} permissions
                {status.connection.updatedAt
                  ? ` · updated ${new Date(status.connection.updatedAt).toLocaleString()}`
                  : ""}
              </p>
            ) : null}
            {cloudflareStore.checkMessage ? <p className="text-xs text-dim">{cloudflareStore.checkMessage}</p> : null}
            {cloudflareStore.checkError ? <p className="text-xs text-danger">{cloudflareStore.checkError}</p> : null}
            {cloudflareStore.reconnectError ? (
              <p className="text-xs text-danger">{cloudflareStore.reconnectError}</p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              {status?.connection.connected ? (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={cloudflareStore.connectionBusy}
                  onClick={() => void cloudflareStore.checkConnection()}
                >
                  Check access
                </Button>
              ) : null}
              {status?.installerOrigin ? (
                status.connection.connected ? (
                  <Button
                    size="sm"
                    disabled={cloudflareStore.connectionBusy}
                    onClick={() => void cloudflareStore.reconnect()}
                  >
                    Reconnect
                  </Button>
                ) : (
                  <Button size="sm" asChild>
                    <a href={status.installerOrigin}>Deploy to my Cloudflare</a>
                  </Button>
                )
              ) : null}
            </div>
          </CardContent>
        </Card>

        <VersionCard />

        <div className="flex justify-end">
          <Button
            size="sm"
            variant="outline"
            disabled={cloudflareStore.statusLoading || cloudflareStore.usageLoading}
            onClick={() => {
              void cloudflareStore.refreshStatus();
              void cloudflareStore.refreshUsage(true);
            }}
          >
            <RefreshCw className={cn(cloudflareStore.statusLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {cloudflareStore.statusError ? (
          <p className="text-sm text-danger">{cloudflareStore.statusError}</p>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StatusDot ok={status?.worker.ok ?? false} />
                Worker
              </CardTitle>
              <CardDescription>
                {status ? (
                  <>
                    {status.worker.name}{" "}
                    <Badge variant="muted" size="sm">
                      {status.worker.environment}
                    </Badge>
                  </>
                ) : (
                  "Loading…"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {status ? (
                <Button size="sm" variant="outline" className="w-fit" asChild>
                  <a href={status.links.workerDashboard} target="_blank" rel="noreferrer">
                    Open in Cloudflare <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <StatusDot ok={status?.r2.ok ?? false} />
                R2 storage
              </CardTitle>
              <CardDescription>
                {status ? (
                  <>
                    {status.r2.bucketName} · binding {status.r2.binding}
                    {status.r2.ok ? ` · ${status.r2.latencyMs} ms` : ""}
                  </>
                ) : (
                  "Loading…"
                )}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {status && !status.r2.ok && status.r2.error ? (
                <p className="text-xs text-danger">{status.r2.error}</p>
              ) : null}
              {status ? (
                <Button size="sm" variant="outline" className="w-fit" asChild>
                  <a href={status.links.r2BucketDashboard} target="_blank" rel="noreferrer">
                    Open bucket <ExternalLink className="size-3.5" />
                  </a>
                </Button>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <SettingsField
          label="Storage usage"
          hint="Logical size from object listing for your workspaces. Cloudflare billing metrics may differ slightly."
        >
          {cloudflareStore.usageError ? (
            <p className="text-sm text-danger">{cloudflareStore.usageError}</p>
          ) : null}
          {usage ? (
            <div className="flex flex-col gap-3 rounded-md border border-divider bg-panel-header p-3">
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="font-medium text-ink">{formatBytes(usage.totalBytes)}</span>
                <span className="text-dim">
                  {usage.objectCount} objects · free tier {formatBytes(usage.freeTierBytes)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-accent-color transition-[width]"
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-dim">
                {(Object.keys(CATEGORY_LABELS) as R2UsageCategory[]).map((key) =>
                  usage.byCategory[key] > 0 ? (
                    <span key={key}>
                      {CATEGORY_LABELS[key]} {formatBytes(usage.byCategory[key])}
                    </span>
                  ) : null,
                )}
              </div>
              {usage.byWorkspace.length > 0 ? (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="text-dim">
                      <th className="pb-1 font-medium">Workspace</th>
                      <th className="pb-1 font-medium text-right">Objects</th>
                      <th className="pb-1 font-medium text-right">Size</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.byWorkspace.map((row) => (
                      <tr key={row.workspaceId} className="border-t border-divider/60">
                        <td className="py-1.5 pr-2 text-ink">{row.name}</td>
                        <td className="py-1.5 text-right text-dim">{row.objects}</td>
                        <td className="py-1.5 text-right text-dim">{formatBytes(row.bytes)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
              <p className="text-micro text-dim">Calculated {new Date(usage.computedAt).toLocaleString()}</p>
            </div>
          ) : cloudflareStore.usageLoading ? (
            <p className="text-sm text-dim">Calculating usage…</p>
          ) : null}
        </SettingsField>

        <div className="rounded-md border border-divider bg-panel-header p-4">
          <h2 className="text-sm font-semibold text-ink">Move R2 to my Cloudflare account</h2>
          <p className="mt-1 text-xs text-dim">
            Copy your workspace data into a bucket you control. Deploy your own Dotnote worker and bind it to that
            bucket to run fully on your account.
          </p>
          <Button size="sm" className="mt-3" onClick={() => setMigrationOpen(true)}>
            Start migration…
          </Button>
        </div>
      </SettingsSectionShell>

      <CloudflareMigrationDialog
        open={migrationOpen}
        onOpenChange={setMigrationOpen}
        links={status ? { createBucket: status.links.createBucket, r2ApiTokens: status.links.r2ApiTokens } : null}
      />
    </>
  );
});
