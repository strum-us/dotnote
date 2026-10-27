import { useState } from "react";
import { observer } from "mobx-react-lite";
import { Button } from "@/components/ui/button";
import { formatBytes } from "@/lib/format-bytes";
import { importStore } from "@/stores/import-store";

function progressPercent(): number {
  const job = importStore.job;
  if (!job) return 0;
  if (job.phase === "done") return 100;
  const staging = job.phase === "staging" || job.phase === "needs-permission";
  const total = staging ? importStore.notesTotal : importStore.notesTotal + importStore.assetsTotal;
  const done = staging ? importStore.notesDone : importStore.notesDone + importStore.assetsDone;
  if (total <= 0) return 0;
  return Math.min(100, Math.round((done / total) * 100));
}

function statusText(): string {
  const job = importStore.job;
  if (!job) return "";
  if (job.phase === "failed") return job.message ?? "Import failed";
  if (job.phase === "needs-permission") {
    return `Import paused. Allow access to ${job.rootName} to continue.`;
  }
  if (job.phase === "done") {
    const notes = importStore.notesDone === 1 ? "1 note" : `${importStore.notesDone} notes`;
    const skipped =
      job.errors.length === 0
        ? ""
        : job.errors.length === 1
          ? " 1 file was skipped."
          : ` ${job.errors.length} files were skipped.`;
    return `Imported ${notes} into ${job.workspaceName}.${skipped}`;
  }
  const counts =
    importStore.notesTotal > 0 ? `${importStore.notesDone}/${importStore.notesTotal} notes` : "Reading folder";
  const file = job.currentPath ? ` · ${job.currentPath}` : "";
  if (job.phase === "publishing") {
    return `Importing ${job.rootName} · ${counts}${importStore.assetsTotal > 0 ? ` · ${importStore.assetsDone}/${importStore.assetsTotal} files` : ""}${file}`;
  }
  const bytes = job.bytesStaged > 0 ? ` · ${formatBytes(job.bytesStaged)}` : "";
  return `Copying ${job.rootName} · ${counts}${bytes}${file}`;
}

export const ImportStatusBar = observer(function ImportStatusBar() {
  const job = importStore.job;
  const [errorsOpen, setErrorsOpen] = useState(false);
  if (!job) return null;
  const percent = progressPercent();
  const canDismiss = job.phase === "done" || job.phase === "failed" || job.phase === "needs-permission";

  return (
    <div className="shrink-0 border-b border-divider bg-panel px-3 py-2" role="status" aria-live="polite">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-ink">{statusText()}</p>
        {job.phase === "needs-permission" ? (
          <Button size="sm" variant="default" onClick={() => void importStore.grantAndContinue()}>
            Continue
          </Button>
        ) : null}
        {job.phase === "failed" && job.plan ? (
          <Button size="sm" variant="outline" onClick={() => importStore.retry()}>
            Retry
          </Button>
        ) : null}
        {job.errors.length > 0 ? (
          <Button size="sm" variant="ghost" onClick={() => setErrorsOpen((open) => !open)}>
            {job.errors.length} skipped
          </Button>
        ) : null}
        {canDismiss ? (
          <Button size="sm" variant="ghost" onClick={() => void importStore.dismiss()}>
            Dismiss
          </Button>
        ) : null}
      </div>
      {job.phase === "staging" || job.phase === "publishing" ? (
        <div className="mt-1.5 h-0.5 overflow-hidden bg-divider">
          <div className="h-full bg-accent-color" style={{ width: `${percent}%` }} />
        </div>
      ) : null}
      {errorsOpen && job.errors.length > 0 ? (
        <ul className="mt-1.5 max-h-24 space-y-0.5 overflow-auto text-[11px] text-muted-foreground">
          {job.errors.slice(0, 12).map((error) => (
            <li key={`${error.path}:${error.message}`} className="truncate">
              {error.path}: {error.message}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
});
