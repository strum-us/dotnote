import type { UpdateJobView, UpdateStepId } from "@shared/types";
import { mintAccessToken, readConnection } from "../cf-grant";
import type { Env } from "../env";
import {
  CfApiError,
  listSecretNames,
  putScript,
  putSecret,
  scriptSettings,
  startAssetSession,
  uploadAssetBucket,
  type ScriptBinding,
  type ScriptSettings,
} from "./cf-deploy";
import { assetBytes, releaseManifest, workerSource, type ReleaseManifest } from "./release-client";
import { appliedMigrations, applyMigration, pendingMigrations, setMeta } from "./schema";
import { BUILD_VERSION } from "./version";

/**
 * The installer's steps minus everything that creates resources: no account
 * check, no new D1 or R2, no new secrets, no address. The browser drives the
 * job one step per request (like the installer), so no single request runs
 * into the subrequest or wall-clock limits, and every step is saved before
 * the next one starts. `deploy` replaces this very Worker; `verify` only
 * passes once a request is answered by the new code.
 */
export const STEPS: { id: UpdateStepId; label: string }[] = [
  { id: "prepare", label: "Check the release" },
  { id: "migrate", label: "Apply database migrations" },
  { id: "assets", label: "Prepare Dotnote's files" },
  { id: "upload", label: "Upload Dotnote's files" },
  { id: "deploy", label: "Replace the Worker" },
  { id: "verify", label: "Wait for the new version" },
];

/** One request holds a job at a time; other tabs get the view and come back. */
const LEASE_MS = 120_000;
const BUSY_RETRY_MS = 1500;
const VERIFY_RETRY_MS = 2000;
/** After the upload, how long the old version may keep answering before the job asks for a manual check. */
const VERIFY_TIMEOUT_MS = 90_000;
/** A Worker that dies mid-step leaves its marker behind; give up after this many in a row. */
const MAX_INTERRUPTED = 3;
const MIGRATIONS_PER_STEP = 5;

/**
 * Installer-written secrets. `keep_bindings` carries them across the upload;
 * if one is missing afterwards it is put back from this isolate's env, which
 * still holds the values. CF_GRANT_KEY is never regenerated: a new key could
 * not decrypt the stored Cloudflare grant.
 */
const KEPT_SECRETS = ["CF_GRANT_KEY", "DOTNOTE_HANDOFF", "DOTNOTE_DIAGNOSTICS_TOKEN"] as const;
const SECRET_TYPES = new Set(["secret_text", "secret_key"]);
/** Bindings that point at extra module parts. The upload only sends index.js, so these cannot be carried. */
const PART_BINDING_TYPES = new Set(["wasm_module", "text_blob", "data_blob"]);

type ErrorCode = NonNullable<UpdateJobView["errorCode"]>;

type JobState = {
  pending?: string[];
  migrated?: number;
  uploadJwt?: string;
  buckets?: string[][];
  bucket?: number;
  completionJwt?: string;
  deployedAt?: string;
  /** Set while a step runs. Still set when the next lease is taken means that request died. */
  inStep?: UpdateStepId;
  interrupted?: number;
};

export type UpdateJob = {
  id: string;
  kind: UpdateJobView["kind"];
  fromVersion: string;
  toVersion: string;
  step: UpdateStepId;
  status: UpdateJobView["status"];
  message: string | null;
  errorCode: ErrorCode | null;
  state: JobState;
  leaseUntil: string | null;
  createdAt: string;
  updatedAt: string;
  finishedAt: string | null;
};

type StepResult = { done: boolean; waitMs?: number };

/** Not done yet and not failed: ask again later. */
class StepWait extends Error {
  constructor(
    readonly ms: number,
    message: string,
  ) {
    super(message);
  }
}

class StepError extends Error {
  constructor(
    message: string,
    readonly code: ErrorCode = "error",
  ) {
    super(message);
  }
}

const SELECT_JOB = `SELECT id, kind, from_version as fromVersion, to_version as toVersion, step, status, message,
  error_code as errorCode, state, lease_until as leaseUntil, created_at as createdAt, updated_at as updatedAt,
  finished_at as finishedAt FROM update_jobs`;

function iso(ms = Date.now()): string {
  return new Date(ms).toISOString();
}

function parseJob(row: (Omit<UpdateJob, "state"> & { state: string }) | null): UpdateJob | null {
  if (!row) return null;
  let state: JobState = {};
  try {
    state = JSON.parse(row.state) as JobState;
  } catch {
    state = {};
  }
  return { ...row, state };
}

export async function getJob(env: Env, id: string): Promise<UpdateJob | null> {
  return parseJob(await env.DB.prepare(`${SELECT_JOB} WHERE id = ?`).bind(id).first());
}

export async function latestJob(env: Env): Promise<UpdateJob | null> {
  return parseJob(await env.DB.prepare(`${SELECT_JOB} ORDER BY created_at DESC LIMIT 1`).first());
}

export async function runningJob(env: Env): Promise<UpdateJob | null> {
  return parseJob(
    await env.DB.prepare(`${SELECT_JOB} WHERE status = 'running' ORDER BY created_at DESC LIMIT 1`).first(),
  );
}

/** The version the running one was updated from, if this Dotnote updated itself to get here. */
export async function lastUpdateFrom(env: Env, version: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT from_version as fromVersion FROM update_jobs
     WHERE kind = 'update' AND status = 'done' AND to_version = ?
     ORDER BY finished_at DESC LIMIT 1`,
  )
    .bind(version)
    .first<{ fromVersion: string }>();
  return row?.fromVersion ?? null;
}

/** A new job, unless one is already running. The check and the insert are one statement. */
export async function createJob(
  env: Env,
  kind: UpdateJob["kind"],
  fromVersion: string,
  toVersion: string,
): Promise<UpdateJob | null> {
  const id = crypto.randomUUID();
  const now = iso();
  const inserted = await env.DB.prepare(
    `INSERT INTO update_jobs (id, kind, from_version, to_version, step, status, state, created_at, updated_at)
     SELECT ?, ?, ?, ?, 'prepare', 'running', '{}', ?, ?
     WHERE NOT EXISTS (SELECT 1 FROM update_jobs WHERE status = 'running')`,
  )
    .bind(id, kind, fromVersion, toVersion, now, now)
    .run();
  if (!inserted.meta.changes) return null;
  return getJob(env, id);
}

async function saveJob(env: Env, job: UpdateJob): Promise<void> {
  job.updatedAt = iso();
  await env.DB.prepare(
    `UPDATE update_jobs SET step = ?, status = ?, message = ?, error_code = ?, state = ?, lease_until = ?,
       updated_at = ?, finished_at = ?
     WHERE id = ?`,
  )
    .bind(
      job.step,
      job.status,
      job.message,
      job.errorCode,
      JSON.stringify(job.state),
      job.leaseUntil,
      job.updatedAt,
      job.finishedAt,
      job.id,
    )
    .run();
}

export function jobView(job: UpdateJob, retryAfterMs?: number): UpdateJobView {
  const done = job.status === "done";
  const index = done ? STEPS.length : Math.max(0, STEPS.findIndex((step) => step.id === job.step));
  const step = STEPS[Math.min(index, STEPS.length - 1)]!;
  const view: UpdateJobView = {
    id: job.id,
    kind: job.kind,
    fromVersion: job.fromVersion,
    toVersion: job.toVersion,
    status: job.status,
    step: { id: step.id, label: done ? "Done" : step.label, index, total: STEPS.length },
    message: job.message,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    finishedAt: job.finishedAt,
  };
  if (job.status === "running" && retryAfterMs !== undefined) view.retryAfterMs = retryAfterMs;
  return view;
}

function classify(err: unknown): { message: string; code: ErrorCode } {
  if (err instanceof StepError) return { message: err.message, code: err.code };
  if (err instanceof CfApiError && (err.status === 401 || err.status === 403)) {
    return { message: `Cloudflare refused the request: ${err.message}`, code: "permission" };
  }
  return { message: err instanceof Error ? err.message : "The step failed.", code: "error" };
}

async function cloudflare(env: Env): Promise<{ token: string; accountId: string; scriptName: string }> {
  const scriptName = env.WORKER_NAME?.trim();
  if (!scriptName) throw new StepError("This Dotnote does not know its Worker name.");
  try {
    const minted = await mintAccessToken(env);
    return { token: minted.accessToken, accountId: minted.accountId, scriptName };
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/already being renewed/i.test(message)) throw new StepWait(3000, "Waiting for Cloudflare access");
    if (/decrypt|ciphertext/i.test(message)) {
      throw new StepError("The stored Cloudflare permission could not be read. Reconnect Cloudflare.", "permission");
    }
    throw new StepError(message || "The stored Cloudflare permission could not be renewed.", "permission");
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function prepare(env: Env, job: UpdateJob): Promise<StepResult> {
  const release = await releaseManifest(env, job.toVersion);
  const applied = await appliedMigrations(env);
  job.state.pending = pendingMigrations(release, applied, job.fromVersion).map((file) => file.name);
  job.state.migrated = 0;
  // Fail on a revoked permission or a renamed Worker before the database is touched.
  const { token, accountId, scriptName } = await cloudflare(env);
  const settings = await scriptSettings(token, accountId, scriptName);
  const unsupported = (settings.bindings ?? []).filter((binding) => PART_BINDING_TYPES.has(binding.type));
  if (unsupported.length) {
    throw new StepError(
      `This Worker has bindings the updater cannot carry over: ${unsupported.map((b) => b.name).join(", ")}.`,
    );
  }
  const count = job.state.pending.length;
  job.message = count === 0 ? null : count === 1 ? "1 database migration to apply" : `${count} database migrations to apply`;
  return { done: true };
}

/**
 * Migrations run before the new code exists, so the old Worker serves on top
 * of them for a while. They must only add (tables, columns, indexes) and be
 * safe to run twice.
 */
async function migrate(env: Env, job: UpdateJob): Promise<StepResult> {
  const pending = job.state.pending ?? [];
  if (pending.length === 0) {
    job.message = null;
    return { done: true };
  }
  const release = await releaseManifest(env, job.toVersion);
  const applied = await appliedMigrations(env);
  let ran = 0;
  for (const name of pending) {
    if (applied.has(name)) continue;
    if (ran >= MIGRATIONS_PER_STEP) break;
    const file = release.migrations.find((entry) => entry.name === name);
    if (!file) throw new StepError(`Dotnote ${release.version} no longer ships migration ${name}.`);
    await applyMigration(env, file);
    applied.add(name);
    ran += 1;
  }
  const migrated = pending.filter((name) => applied.has(name)).length;
  job.state.migrated = migrated;
  job.message = `Migrations ${migrated} of ${pending.length}`;
  return { done: migrated >= pending.length };
}

async function startUpload(env: Env, job: UpdateJob): Promise<StepResult> {
  const release = await releaseManifest(env, job.toVersion);
  const manifest: Record<string, { hash: string; size: number }> = {};
  for (const file of release.assets) manifest[file.path] = { hash: file.hash, size: file.size };
  const { token, accountId, scriptName } = await cloudflare(env);
  const session = await startAssetSession(token, accountId, scriptName, manifest);
  job.state.uploadJwt = session.jwt;
  job.state.buckets = session.buckets;
  job.state.bucket = 0;
  job.state.completionJwt = session.buckets.length === 0 ? session.jwt : undefined;
  job.message =
    session.buckets.length === 0 ? "Cloudflare already has every file" : `Uploading files, 0 of ${session.buckets.length}`;
  return { done: true };
}

async function uploadBucket(env: Env, job: UpdateJob): Promise<StepResult> {
  const buckets = job.state.buckets ?? [];
  const index = job.state.bucket ?? 0;
  if (index >= buckets.length) {
    job.state.completionJwt ??= job.state.uploadJwt;
    if (!job.state.completionJwt) throw new StepError("Cloudflare did not finish the file upload.");
    return { done: true };
  }
  if (!job.state.uploadJwt) throw new StepError("The file upload was not started.");
  const release = await releaseManifest(env, job.toVersion);
  const { accountId } = await readConnection(env);
  if (!accountId) throw new StepError("This Dotnote has no Cloudflare permission.", "permission");
  const parts = [];
  for (const hash of buckets[index]!) {
    const bytes = await assetBytes(env, hash);
    const contentType = release.assets.find((file) => file.hash === hash)?.contentType ?? "application/octet-stream";
    parts.push({ hash, base64: bytesToBase64(bytes), contentType });
  }
  const jwt = await uploadAssetBucket(accountId, job.state.uploadJwt, parts);
  if (jwt) job.state.completionJwt = jwt;
  job.state.bucket = index + 1;
  job.message = `Uploading files, ${index + 1} of ${buckets.length}`;
  if (index + 1 < buckets.length) return { done: false };
  if (!job.state.completionJwt) throw new StepError("Cloudflare did not finish the file upload.");
  return { done: true };
}

/**
 * Keep every binding the deployed script has (D1, R2, service bindings,
 * vars), refresh APP_VERSION, and keep secrets by type instead of resending them.
 */
function scriptMetadata(settings: ScriptSettings, release: ReleaseManifest, jwt: string, runWorkerFirst: boolean) {
  const bindings: ScriptBinding[] = (settings.bindings ?? []).filter(
    (binding) => !SECRET_TYPES.has(binding.type) && binding.name !== "APP_VERSION",
  );
  if (!bindings.some((binding) => binding.type === "assets")) bindings.push({ type: "assets", name: "ASSETS" });
  bindings.push({ type: "plain_text", name: "APP_VERSION", text: release.version });
  const metadata: Record<string, unknown> = {
    main_module: "index.js",
    compatibility_date: release.compatibilityDate,
    compatibility_flags: release.compatibilityFlags,
    bindings,
    keep_bindings: [...SECRET_TYPES],
    assets: {
      jwt,
      config: runWorkerFirst
        ? { not_found_handling: "single-page-application", run_worker_first: true }
        : { not_found_handling: "single-page-application" },
    },
  };
  if (typeof settings.logpush === "boolean") metadata.logpush = settings.logpush;
  if (settings.observability) metadata.observability = settings.observability;
  if (settings.tail_consumers?.length) metadata.tail_consumers = settings.tail_consumers;
  return metadata;
}

/**
 * Retried in place: once the new script is live, a later request has no
 * secret values to restore from, and a retry of the job skips `deploy`.
 */
async function keepSecrets(env: Env, token: string, accountId: string, scriptName: string): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      const present = new Set(await listSecretNames(token, accountId, scriptName));
      for (const name of KEPT_SECRETS) {
        const value = env[name];
        if (value && !present.has(name)) await putSecret(token, accountId, scriptName, name, value);
      }
      return;
    } catch (err) {
      if (attempt >= 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
    }
  }
}

async function deploy(env: Env, job: UpdateJob): Promise<StepResult> {
  // A retry after an upload that went through but was not recorded.
  if (BUILD_VERSION === job.toVersion) {
    job.state.deployedAt ??= iso();
    return { done: true };
  }
  const jwt = job.state.completionJwt;
  if (!jwt) throw new StepError("Dotnote's files are not uploaded yet.");
  const release = await releaseManifest(env, job.toVersion);
  const source = await workerSource(env, release);
  const { token, accountId, scriptName } = await cloudflare(env);
  const settings = await scriptSettings(token, accountId, scriptName);
  try {
    await putScript(token, accountId, scriptName, scriptMetadata(settings, release, jwt, true), source);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/run_worker_first|config/i.test(message)) throw err;
    await putScript(token, accountId, scriptName, scriptMetadata(settings, release, jwt, false), source);
  }
  // From here on, new requests may already reach the new code. This request
  // still runs the old one, with the secrets in its env.
  await keepSecrets(env, token, accountId, scriptName);
  job.state.deployedAt = iso();
  job.message = `Waiting for Dotnote ${job.toVersion} to answer`;
  return { done: true };
}

async function verify(env: Env, job: UpdateJob): Promise<StepResult> {
  if (BUILD_VERSION !== job.toVersion) {
    const since = Date.parse(job.state.deployedAt ?? job.updatedAt);
    if (Date.now() - since > VERIFY_TIMEOUT_MS) {
      throw new StepError(`Dotnote ${job.toVersion} was uploaded but has not answered yet.`, "unverified");
    }
    job.message = `Waiting for Dotnote ${job.toVersion} to answer`;
    return { done: false, waitMs: VERIFY_RETRY_MS };
  }
  await env.DB.prepare("SELECT 1 as ok").first();
  await env.BUCKET.list({ limit: 1 });
  await setMeta(env, "version", BUILD_VERSION);
  await setMeta(env, "updated_at", iso());
  job.message = null;
  return { done: true };
}

async function runStep(env: Env, job: UpdateJob): Promise<StepResult> {
  switch (job.step) {
    case "prepare":
      return prepare(env, job);
    case "migrate":
      return migrate(env, job);
    case "assets":
      return startUpload(env, job);
    case "upload":
      return uploadBucket(env, job);
    case "deploy":
      return deploy(env, job);
    case "verify":
      return verify(env, job);
  }
}

/** Run the job's current step if no other request holds it. */
export async function advanceJob(env: Env, jobId: string): Promise<{ job: UpdateJob; retryAfterMs?: number }> {
  const now = Date.now();
  const leased = await env.DB.prepare(
    `UPDATE update_jobs SET lease_until = ?
     WHERE id = ? AND status = 'running' AND (lease_until IS NULL OR lease_until < ?)`,
  )
    .bind(iso(now + LEASE_MS), jobId, iso(now))
    .run();
  const job = await getJob(env, jobId);
  if (!job) throw new Error("The update job is gone.");
  if (!leased.meta.changes) return { job, retryAfterMs: job.status === "running" ? BUSY_RETRY_MS : undefined };

  if (job.state.inStep) {
    job.state.interrupted = (job.state.interrupted ?? 0) + 1;
    if (job.state.interrupted > MAX_INTERRUPTED) {
      job.status = "failed";
      job.errorCode = "error";
      job.message = "The update kept stopping partway through this step.";
      job.state.inStep = undefined;
      job.leaseUntil = null;
      await saveJob(env, job);
      return { job };
    }
  }
  job.state.inStep = job.step;
  await saveJob(env, job);

  let retryAfterMs: number | undefined;
  try {
    const result = await runStep(env, job);
    job.errorCode = null;
    retryAfterMs = result.waitMs;
    if (result.done) {
      const next = STEPS.findIndex((step) => step.id === job.step) + 1;
      if (next >= STEPS.length) {
        job.status = "done";
        job.finishedAt = iso();
        job.message = null;
      } else {
        job.step = STEPS[next]!.id;
      }
    }
  } catch (err) {
    if (err instanceof StepWait) {
      retryAfterMs = err.ms;
      job.message = err.message;
    } else {
      const failure = classify(err);
      job.status = "failed";
      job.message = failure.message;
      job.errorCode = failure.code;
      console.error(JSON.stringify({ event: "update_step_failed", step: job.step, error: failure.message }));
    }
  }
  job.state.inStep = undefined;
  job.state.interrupted = 0;
  job.leaseUntil = null;
  await saveJob(env, job);
  return { job, retryAfterMs };
}

/** Resume a failed job where it stopped. Upload tokens expire, so a failed upload or deploy starts the upload over. */
export async function retryJob(env: Env, job: UpdateJob): Promise<UpdateJob | null> {
  const resumed = await env.DB.prepare(
    `UPDATE update_jobs SET status = 'running', lease_until = NULL
     WHERE id = ? AND status = 'failed' AND NOT EXISTS (SELECT 1 FROM update_jobs WHERE status = 'running')`,
  )
    .bind(job.id)
    .run();
  if (!resumed.meta.changes) return null;
  if (job.step === "upload" || job.step === "deploy") {
    job.step = "assets";
    job.state.uploadJwt = undefined;
    job.state.buckets = undefined;
    job.state.bucket = undefined;
    job.state.completionJwt = undefined;
  }
  if (job.step === "verify") job.state.deployedAt = iso();
  job.status = "running";
  job.message = null;
  job.errorCode = null;
  job.state.inStep = undefined;
  job.state.interrupted = 0;
  job.leaseUntil = null;
  await saveJob(env, job);
  return job;
}

/** Set a failed job aside, so the update is offered fresh. */
export async function cancelJob(env: Env, job: UpdateJob): Promise<UpdateJob | null> {
  const now = iso();
  await env.DB.prepare(
    `UPDATE update_jobs SET status = 'cancelled', lease_until = NULL, updated_at = ?, finished_at = ?
     WHERE id = ? AND status = 'failed'`,
  )
    .bind(now, now, job.id)
    .run();
  return getJob(env, job.id);
}
