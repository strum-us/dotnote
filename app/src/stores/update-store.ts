import { makeAutoObservable, runInAction } from "mobx";
import type { UpdateBlockedReason, UpdateCheckResponse, UpdateStatusResponse } from "@shared/types";
import { ApiError, updateApi } from "@/lib/api";
import { CLIENT_VERSION, CLIENT_VERSION_KNOWN } from "@/lib/app-version";
import { importStore } from "@/stores/import-store";
import { noteStore } from "@/stores/note-store";
import { syncStore } from "@/stores/sync-store";
import { uiPreferenceStore } from "@/stores/ui-preference-store";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
/** Coming back to the tab checks again, at most as often as the Worker refreshes its release cache. */
const RETURN_CHECK_MIN_MS = 15 * 60 * 1000;
const STEP_DELAY_MS = 250;
const STEP_ERROR_DELAY_MS = 3000;
/** Requests can fail for a moment while the Worker swaps. After this many in a row, stop and say so. */
const MAX_STEP_ERRORS = 20;

/**
 * `available`: a newer release can be installed. `blocked`: one exists, but the
 * Cloudflare permission needs a reconnect first. `done`: the Worker runs other
 * code than this page, so the page should reload.
 */
export type UpdatePhase = "idle" | "available" | "blocked" | "updating" | "done" | "failed";

export const BLOCKED_COPY: Record<UpdateBlockedReason, string> = {
  development: "Updates are off in local development.",
  no_installer: "This Dotnote has no installer address, so it cannot fetch releases.",
  unconfigured:
    "This Dotnote was not deployed by the installer, so it cannot redeploy itself. Update it the way it was deployed.",
  not_connected: "Connect Cloudflare to let this Dotnote update itself.",
  missing_scopes: "The stored Cloudflare permission cannot replace the Worker. Reconnect Cloudflare to allow updates.",
};

const ERROR_COPY: Record<string, string> = {
  ...BLOCKED_COPY,
  update_in_progress: "Another update is already running.",
  release_changed: "A newer release came out in the meantime. Check again.",
  rollout_held: "This release is not offered to this Dotnote yet.",
  not_newer: "This Dotnote already runs that version.",
  no_rollback: "There is no earlier version to go back to.",
  nothing_to_retry: "There is no failed update to retry.",
  nothing_to_cancel: "There is no failed update to dismiss.",
};

function apiMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    const body = err.body as { message?: string } | null;
    return ERROR_COPY[err.message] ?? body?.message ?? fallback;
  }
  return err instanceof Error ? err.message : fallback;
}

/**
 * Self-update of this Dotnote's Cloudflare Worker (worker/update/). The Worker
 * does the work; this store asks whether a release is out and keeps calling
 * the step endpoint while a job runs, in whichever tab is open.
 */
class UpdateStore {
  check: UpdateCheckResponse | null = null;
  job: UpdateCheckResponse["job"] = null;
  /** Version the Worker reported last, from a check or a step. */
  serverVersion: string | null = null;
  checking = false;
  checkError: string | null = null;
  busy = false;
  error: string | null = null;
  /** Step requests kept failing while the job was running. */
  lostContact = false;

  private checkInFlight: Promise<void> | null = null;
  private lastCheckedAt = 0;
  private stepTimer: ReturnType<typeof setTimeout> | null = null;
  private stepErrors = 0;
  /** Set in the tab that started the job: it reloads itself once the new version answers. */
  private reloadWhenLive = false;
  private stopBoot: (() => void) | null = null;

  constructor() {
    makeAutoObservable<
      UpdateStore,
      "checkInFlight" | "lastCheckedAt" | "stepTimer" | "stepErrors" | "reloadWhenLive" | "stopBoot"
    >(
      this,
      {
        checkInFlight: false,
        lastCheckedAt: false,
        stepTimer: false,
        stepErrors: false,
        reloadWhenLive: false,
        stopBoot: false,
      },
      { autoBind: true },
    );
  }

  get currentVersion(): string | null {
    return this.serverVersion ?? this.check?.currentVersion ?? null;
  }

  get latestVersion(): string | null {
    return this.check?.latestVersion ?? null;
  }

  /** The Worker runs other code than this page. */
  get pageOutdated(): boolean {
    const server = this.currentVersion;
    return CLIENT_VERSION_KNOWN && !!server && server !== CLIENT_VERSION;
  }

  get pendingChanges(): number {
    return syncStore.ownOps.length;
  }

  /** Why an update cannot start from this page right now. Old ops must not meet new code mid-flight. */
  get startBlocker(): string | null {
    const pending = this.pendingChanges;
    if (pending > 0) return pending === 1 ? "1 change is still syncing." : `${pending} changes are still syncing.`;
    if (importStore.busy) return "An import is still running.";
    if (this.job?.status === "running") return "An update is already running.";
    return null;
  }

  get phase(): UpdatePhase {
    const status = this.job?.status;
    if (status === "running") return "updating";
    if (status === "failed") return "failed";
    if (this.pageOutdated) return "done";
    const check = this.check;
    if (!check?.updateAvailable) return "idle";
    if (check.canUpdate) return "available";
    return check.blockedReason === "missing_scopes" ? "blocked" : "idle";
  }

  get bannerVisible(): boolean {
    const phase = this.phase;
    if (phase === "idle") return false;
    if (phase === "available" || phase === "blocked") {
      return this.latestVersion !== uiPreferenceStore.dismissedUpdateVersion;
    }
    return true;
  }

  /** Check now, when the tab comes back after a while, and every 30 minutes. Returns the cleanup. */
  boot(): () => void {
    this.stopBoot?.();
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), CHECK_INTERVAL_MS);
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - this.lastCheckedAt >= RETURN_CHECK_MIN_MS) void this.refresh();
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    const stop = () => {
      clearInterval(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
      this.clearStepTimer();
      if (this.stopBoot === stop) this.stopBoot = null;
    };
    this.stopBoot = stop;
    return stop;
  }

  refresh(force = false): Promise<void> {
    if (this.checkInFlight) return this.checkInFlight;
    this.checkInFlight = (async () => {
      runInAction(() => {
        this.checking = true;
        this.checkError = null;
      });
      try {
        const check = await updateApi.check(force);
        runInAction(() => {
          this.check = check;
          this.serverVersion = check.currentVersion;
          this.job = check.job;
          this.lastCheckedAt = Date.now();
          this.stepErrors = 0;
          this.lostContact = false;
        });
        this.follow();
      } catch (err) {
        runInAction(() => {
          this.checkError = apiMessage(err, "Could not check for updates.");
        });
      } finally {
        runInAction(() => {
          this.checking = false;
          this.checkInFlight = null;
        });
      }
    })();
    return this.checkInFlight;
  }

  /** Queue what the editor holds, so the sync gate sees it before the user confirms. */
  prepare(): void {
    noteStore.checkpoint();
    this.error = null;
  }

  async start(): Promise<boolean> {
    const version = this.latestVersion;
    if (!version || this.busy || this.startBlocker) return false;
    this.busy = true;
    this.error = null;
    try {
      const res = await updateApi.start(version);
      runInAction(() => {
        this.busy = false;
        this.reloadWhenLive = true;
      });
      this.apply(res);
      return true;
    } catch (err) {
      runInAction(() => {
        this.busy = false;
        this.error = apiMessage(err, "The update could not start.");
      });
      if (err instanceof ApiError && err.message === "release_changed") void this.refresh(true);
      return false;
    }
  }

  async rollback(): Promise<boolean> {
    const version = this.check?.rollbackVersion;
    const from = this.currentVersion;
    if (!version || this.busy || this.startBlocker) return false;
    this.busy = true;
    this.error = null;
    try {
      const res = await updateApi.rollback(version);
      runInAction(() => {
        this.busy = false;
        this.reloadWhenLive = true;
      });
      // Going back on purpose: do not offer the release just left right away.
      if (from) uiPreferenceStore.setDismissedUpdateVersion(from);
      this.apply(res);
      return true;
    } catch (err) {
      runInAction(() => {
        this.busy = false;
        this.error = apiMessage(err, "Could not go back to the earlier version.");
      });
      return false;
    }
  }

  async retry(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const res = await updateApi.retry();
      runInAction(() => {
        this.busy = false;
        this.reloadWhenLive = true;
      });
      this.apply(res);
    } catch (err) {
      runInAction(() => {
        this.busy = false;
        this.error = apiMessage(err, "The update could not resume.");
      });
    }
  }

  /** Set a failed update aside. The release is offered again. */
  async cancel(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.error = null;
    try {
      const res = await updateApi.cancel();
      runInAction(() => {
        this.busy = false;
      });
      this.apply(res);
    } catch (err) {
      runInAction(() => {
        this.busy = false;
        this.error = apiMessage(err, "Could not dismiss the failed update.");
      });
    }
  }

  /** Hide the banner for this release only. */
  dismiss(): void {
    if (this.latestVersion) uiPreferenceStore.setDismissedUpdateVersion(this.latestVersion);
  }

  /** Load the new code once every local change is in IndexedDB; it syncs again after the reload. */
  async reload(): Promise<void> {
    this.reloadWhenLive = false;
    noteStore.checkpoint();
    await syncStore.persisted();
    window.location.reload();
  }

  private apply(res: UpdateStatusResponse): void {
    const wasDone = this.job?.id === res.job?.id && this.job?.status === "done";
    runInAction(() => {
      this.job = res.job;
      this.serverVersion = res.currentVersion;
    });
    if (res.job?.status === "running") {
      this.scheduleStep(res.job.retryAfterMs ?? STEP_DELAY_MS);
      return;
    }
    this.follow();
    if (res.job?.status === "done" && !wasDone) void this.refresh(true);
  }

  private follow(): void {
    if (this.job?.status === "running") {
      if (!this.stepTimer) this.scheduleStep(0);
      return;
    }
    this.clearStepTimer();
    if (this.job?.status === "done" && this.reloadWhenLive && this.pageOutdated) void this.reload();
  }

  private scheduleStep(delay: number): void {
    this.clearStepTimer();
    this.stepTimer = setTimeout(() => void this.step(), delay);
  }

  private clearStepTimer(): void {
    if (this.stepTimer) clearTimeout(this.stepTimer);
    this.stepTimer = null;
  }

  private async step(): Promise<void> {
    this.stepTimer = null;
    try {
      const res = await updateApi.step();
      runInAction(() => {
        this.stepErrors = 0;
        this.lostContact = false;
      });
      this.apply(res);
    } catch {
      runInAction(() => {
        this.stepErrors += 1;
        this.lostContact = this.stepErrors >= MAX_STEP_ERRORS;
      });
      if (!this.lostContact) this.scheduleStep(STEP_ERROR_DELAY_MS);
    }
  }
}

export const updateStore = new UpdateStore();
