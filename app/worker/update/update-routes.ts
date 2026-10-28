import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { UpdateCheckResponse, UpdateStatusResponse } from "@shared/types";
import { compareVersions, isVersion } from "@shared/version";
import type { Env } from "../env";
import type { AppVariables } from "../session";
import { cloudflareToken, readUpdateAccess } from "./access";
import { ensureUpdateSchedule } from "./cron";
import {
  advanceJob,
  cancelJob,
  createJob,
  jobView,
  lastUpdateFrom,
  latestJob,
  retryJob,
  runningJob,
  type UpdateJob,
} from "./jobs";
import { blockedReason, rolloutHeld } from "./policy";
import { latestRelease, releaseManifest, type ReleaseManifest } from "./release-client";
import { autoUpdateEnabled, setAutoUpdate } from "./schedule";
import { ensureUpdateTables } from "./schema";
import { BUILD_VERSION } from "./version";

export const updateRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

updateRoutes.use("*", async (c, next) => {
  await ensureUpdateTables(c.env);
  await next();
});

async function rollbackTarget(env: Env): Promise<string | null> {
  const from = await lastUpdateFrom(env, BUILD_VERSION);
  return from && from !== BUILD_VERSION ? from : null;
}

function statusBody(job: UpdateJob | null, retryAfterMs?: number): UpdateStatusResponse {
  return { currentVersion: BUILD_VERSION, job: job ? jobView(job, retryAfterMs) : null };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

updateRoutes.get("/check", async (c) => {
  const access = await readUpdateAccess(c.env);
  const blocked = blockedReason(c.env, access);
  const job = await latestJob(c.env);
  let release: ReleaseManifest | null = null;
  let error: string | null = null;
  if (blocked !== "no_installer") {
    try {
      release = await latestRelease(c.env, { force: c.req.query("force") === "1" });
    } catch (err) {
      error = errorMessage(err, "The installer could not be reached.");
    }
  }
  const newer = !!release && compareVersions(release.version, BUILD_VERSION) > 0;
  const held = newer && rolloutHeld(c.env, access, release!, new URL(c.req.url).host);
  const offered = newer && !held;
  const body: UpdateCheckResponse = {
    checkedAt: new Date().toISOString(),
    currentVersion: BUILD_VERSION,
    latestVersion: release?.version ?? null,
    updateAvailable: offered,
    releasedAt: offered ? release!.releasedAt : null,
    notes: offered ? release!.notes : null,
    sizeBytes: offered ? release!.sizeBytes : null,
    canUpdate: blocked === null,
    blockedReason: blocked,
    rolloutHeld: held,
    rollbackVersion: blocked === null ? await rollbackTarget(c.env) : null,
    error,
    job: job ? jobView(job) : null,
    credential: access.credential,
    autoUpdate: await autoUpdateEnabled(c.env),
  };
  return c.json(body);
});

updateRoutes.get("/status", async (c) => {
  return c.json(statusBody(await latestJob(c.env)));
});

const versionBody = z.object({ version: z.string().min(1).max(64) });

updateRoutes.post("/start", zValidator("json", versionBody), async (c) => {
  const access = await readUpdateAccess(c.env);
  const blocked = blockedReason(c.env, access);
  if (blocked) return c.json({ error: blocked }, 403);
  const { version } = c.req.valid("json");
  if (!isVersion(version) || compareVersions(version, BUILD_VERSION) <= 0) {
    return c.json({ error: "not_newer", message: `Dotnote ${version} is not newer than ${BUILD_VERSION}.` }, 409);
  }
  let release: ReleaseManifest;
  try {
    release = await latestRelease(c.env, { force: true });
  } catch (err) {
    return c.json({ error: "release_unavailable", message: errorMessage(err, "No release is available.") }, 502);
  }
  if (release.version !== version) {
    return c.json({ error: "release_changed", latestVersion: release.version }, 409);
  }
  if (rolloutHeld(c.env, access, release, new URL(c.req.url).host)) {
    return c.json({ error: "rollout_held" }, 409);
  }
  const job = await createJob(c.env, "update", BUILD_VERSION, version);
  if (!job) return c.json({ error: "update_in_progress" }, 409);
  return c.json(statusBody(job, 0), 202);
});

updateRoutes.post("/rollback", zValidator("json", versionBody), async (c) => {
  const blocked = blockedReason(c.env, await readUpdateAccess(c.env));
  if (blocked) return c.json({ error: blocked }, 403);
  const { version } = c.req.valid("json");
  if ((await rollbackTarget(c.env)) !== version) return c.json({ error: "no_rollback" }, 409);
  try {
    await releaseManifest(c.env, version);
  } catch (err) {
    return c.json({ error: "release_gone", message: errorMessage(err, `Dotnote ${version} is gone.`) }, 404);
  }
  const job = await createJob(c.env, "rollback", BUILD_VERSION, version);
  if (!job) return c.json({ error: "update_in_progress" }, 409);
  return c.json(statusBody(job, 0), 202);
});

/** Run the next piece of the running job. Any open tab may call it; one request works at a time. */
updateRoutes.post("/step", async (c) => {
  const running = await runningJob(c.env);
  if (!running) return c.json(statusBody(await latestJob(c.env)));
  const { job, retryAfterMs } = await advanceJob(c.env, running.id);
  return c.json(statusBody(job, retryAfterMs));
});

updateRoutes.post("/retry", async (c) => {
  const blocked = blockedReason(c.env, await readUpdateAccess(c.env));
  if (blocked) return c.json({ error: blocked }, 403);
  const latest = await latestJob(c.env);
  if (!latest || latest.status !== "failed") return c.json({ error: "nothing_to_retry" }, 409);
  const job = await retryJob(c.env, latest);
  if (!job) return c.json({ error: "update_in_progress" }, 409);
  return c.json(statusBody(job, 0));
});

updateRoutes.post("/cancel", async (c) => {
  const latest = await latestJob(c.env);
  if (!latest || latest.status !== "failed") return c.json({ error: "nothing_to_cancel" }, 409);
  return c.json(statusBody(await cancelJob(c.env, latest)));
});

/**
 * Automatic updates (schedule.ts). Turning them on needs a working credential
 * and puts the Cron Trigger on the Worker, so the setting cannot be on while
 * nothing would ever run it.
 */
updateRoutes.post("/auto", zValidator("json", z.object({ enabled: z.boolean() })), async (c) => {
  const { enabled } = c.req.valid("json");
  if (enabled) {
    const blocked = blockedReason(c.env, await readUpdateAccess(c.env));
    if (blocked) return c.json({ error: blocked }, 403);
    try {
      const { token, accountId, scriptName } = await cloudflareToken(c.env);
      await ensureUpdateSchedule(token, accountId, scriptName);
    } catch (err) {
      const message = errorMessage(err, "Cloudflare did not accept the Cron Trigger.");
      return c.json({ error: "schedule_failed", message }, 502);
    }
  }
  await setAutoUpdate(c.env, enabled);
  return c.json({ autoUpdate: enabled });
});
