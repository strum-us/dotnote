import {
  attachDomain,
  createD1,
  createR2,
  d1Query,
  deleteD1,
  deleteDomain,
  deleteR2,
  deleteScript,
  enableSubdomain,
  findD1,
  findR2,
  hostnameConflict,
  putScript,
  putSecret,
  scriptExists,
  startAssetSession,
  uploadAssetBucket,
  workersSubdomain,
} from "./cf-api";
import { bytesToBase64, randomGrantKey } from "./crypto";
import type { Env } from "./env";
import type { Installation } from "./install-store";
import { loadAssetBytes, loadRelease, loadWorkerSource, type ReleaseManifest } from "./release";

export const STEPS = [
  { id: "check", label: "Check the account" },
  { id: "d1", label: "Create the database" },
  { id: "migrate", label: "Apply database migrations" },
  { id: "r2", label: "Create R2 storage" },
  { id: "assets", label: "Upload Dotnote's files", waitMs: 300 },
  { id: "worker", label: "Upload Dotnote" },
  { id: "secrets", label: "Store the setup key" },
  { id: "address", label: "Turn on the address" },
  { id: "prove", label: "Wait until Dotnote answers", waitMs: 3000 },
] as const;

export type StepView = {
  status: "running" | "failed" | "ready" | "removed";
  step: { id: string; label: string; index: number; total: number };
  message: string | null;
  address: string;
  retryAfterMs?: number;
};

function dbName(workerName: string): string {
  return `${workerName}-index`;
}

function bucketName(workerName: string): string {
  return `${workerName}-data`;
}

function contentTypeFor(release: ReleaseManifest, hash: string): string {
  return release.assets.find((file) => file.hash === hash)?.contentType ?? "application/octet-stream";
}

function publish(row: Installation, retryAfterMs?: number): StepView {
  const index = Math.min(row.stepIndex, STEPS.length - 1);
  const step = STEPS[index] ?? STEPS[STEPS.length - 1];
  const view: StepView = {
    status: row.status === "ready" ? "ready" : row.status === "failed" ? "failed" : "running",
    step: { id: step.id, label: step.label, index: row.stepIndex, total: STEPS.length },
    message: row.message,
    address: row.address,
  };
  if (retryAfterMs && view.status === "running") view.retryAfterMs = retryAfterMs;
  return view;
}

async function checkAccount(token: string, row: Installation): Promise<void> {
  if (!row.state.scriptUploaded && (await scriptExists(token, row.accountId, row.workerName))) {
    throw new Error(`A Worker named ${row.workerName} is already in this account.`);
  }
  if (!row.state.d1Id && (await findD1(token, row.accountId, dbName(row.workerName)))) {
    throw new Error(`A D1 database named ${dbName(row.workerName)} is already in this account.`);
  }
  if (!row.state.r2Name && (await findR2(token, row.accountId, bucketName(row.workerName)))) {
    throw new Error(`An R2 bucket named ${bucketName(row.workerName)} is already in this account.`);
  }
  if (!row.hostname) {
    const subdomain = await workersSubdomain(token, row.accountId);
    if (!subdomain) {
      throw new Error(
        "This account has no workers.dev subdomain yet. Open Workers & Pages in the Cloudflare dashboard once, then try again.",
      );
    }
    row.state.subdomain = subdomain;
  } else if (row.zoneId && row.zoneName) {
    const conflict = await hostnameConflict(token, row.zoneId, row.zoneName, row.hostname);
    if (conflict) throw new Error(conflict);
  }
}

async function ensureD1(token: string, row: Installation): Promise<void> {
  if (row.state.d1Id) return;
  const name = dbName(row.workerName);
  try {
    row.state.d1Id = await createD1(token, row.accountId, name);
  } catch (err) {
    const existing = await findD1(token, row.accountId, name);
    if (!existing) throw err;
    row.state.d1Id = existing;
  }
}

async function migrate(token: string, env: Env, row: Installation): Promise<boolean> {
  const release = await loadRelease(env);
  if (!row.state.d1Id) throw new Error("The database was not created.");
  const start = row.state.migrationIndex ?? 0;
  const end = Math.min(release.migrations.length, start + 20);
  for (let i = start; i < end; i++) {
    await d1Query(token, row.accountId, row.state.d1Id, release.migrations[i]);
    row.state.migrationIndex = i + 1;
  }
  row.message =
    release.migrations.length === 0
      ? null
      : `Migrations ${row.state.migrationIndex ?? 0} of ${release.migrations.length}`;
  return (row.state.migrationIndex ?? 0) >= release.migrations.length;
}

async function ensureR2(token: string, row: Installation): Promise<void> {
  if (row.state.r2Name) return;
  const name = bucketName(row.workerName);
  try {
    await createR2(token, row.accountId, name);
  } catch (err) {
    if (!(await findR2(token, row.accountId, name))) throw err;
  }
  row.state.r2Name = name;
}

async function uploadAssets(token: string, env: Env, row: Installation): Promise<boolean> {
  const release = await loadRelease(env);
  if (!row.state.uploadJwt) {
    const manifest: Record<string, { hash: string; size: number }> = {};
    for (const file of release.assets) manifest[file.path] = { hash: file.hash, size: file.size };
    const session = await startAssetSession(token, row.accountId, row.workerName, manifest);
    row.state.uploadJwt = session.jwt;
    row.state.assetBuckets = session.buckets;
    row.state.assetBucket = 0;
    if (session.buckets.length === 0) {
      row.state.completionJwt = session.jwt;
      row.message = null;
      return true;
    }
    row.message = `Uploading files, 0 of ${session.buckets.length}`;
    return false;
  }
  const buckets = row.state.assetBuckets ?? [];
  const index = row.state.assetBucket ?? 0;
  if (index >= buckets.length) {
    row.state.completionJwt ??= row.state.uploadJwt;
    return true;
  }
  const parts = [];
  for (const hash of buckets[index]) {
    const bytes = await loadAssetBytes(env, hash);
    parts.push({ hash, base64: bytesToBase64(bytes), contentType: contentTypeFor(release, hash) });
  }
  const jwt = await uploadAssetBucket(row.accountId, row.state.uploadJwt, parts);
  if (jwt) row.state.completionJwt = jwt;
  row.state.assetBucket = index + 1;
  row.message = `Uploading files, ${row.state.assetBucket} of ${buckets.length}`;
  if (row.state.assetBucket < buckets.length) return false;
  if (!row.state.completionJwt) throw new Error("Cloudflare did not finish the file upload.");
  return true;
}

function scriptMetadata(env: Env, row: Installation, installerOrigin: string, release: ReleaseManifest, jwt: string) {
  return {
    main_module: "index.js",
    compatibility_date: release.compatibilityDate,
    compatibility_flags: release.compatibilityFlags,
    bindings: [
      { type: "d1", name: "DB", id: row.state.d1Id },
      { type: "r2_bucket", name: "BUCKET", bucket_name: row.state.r2Name },
      { type: "assets", name: "ASSETS" },
      { type: "plain_text", name: "HQ_URL", text: env.HQ_URL },
      { type: "plain_text", name: "WORKER_NAME", text: row.workerName },
      { type: "plain_text", name: "R2_BUCKET_NAME", text: row.state.r2Name },
      { type: "plain_text", name: "D1_DATABASE_NAME", text: dbName(row.workerName) },
      { type: "plain_text", name: "CF_ACCOUNT_ID", text: row.accountId },
      { type: "plain_text", name: "CF_OAUTH_CLIENT_ID", text: env.OAUTH_CLIENT_ID },
      { type: "plain_text", name: "INSTALLER_ORIGIN", text: installerOrigin },
    ],
    assets: {
      jwt,
      config: {
        not_found_handling: "single-page-application",
        run_worker_first: true,
      },
    },
  };
}

async function uploadWorker(token: string, env: Env, row: Installation, installerOrigin: string): Promise<void> {
  if (!row.state.d1Id || !row.state.r2Name || !row.state.completionJwt) {
    throw new Error("The database, bucket, or files are not ready.");
  }
  const release = await loadRelease(env);
  const source = await loadWorkerSource(env);
  const metadata = scriptMetadata(env, row, installerOrigin, release, row.state.completionJwt);
  try {
    await putScript(token, row.accountId, row.workerName, metadata, source);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/run_worker_first|config/i.test(message)) throw err;
    const fallback = scriptMetadata(env, row, installerOrigin, release, row.state.completionJwt);
    fallback.assets.config = { not_found_handling: "single-page-application" } as typeof fallback.assets.config;
    await putScript(token, row.accountId, row.workerName, fallback, source);
  }
  row.state.scriptUploaded = true;
}

async function storeSecrets(token: string, env: Env, row: Installation): Promise<void> {
  const grantKey = randomGrantKey();
  await putSecret(token, row.accountId, row.workerName, "CF_GRANT_KEY", grantKey);
  await putSecret(token, row.accountId, row.workerName, "DOTNOTE_HANDOFF", row.handoffHash);
  const directoryToken = env.HQ_DIRECTORY_TOKEN?.trim();
  if (directoryToken) {
    await putSecret(token, row.accountId, row.workerName, "HQ_DIRECTORY_TOKEN", directoryToken);
  }
}

async function turnOnAddress(token: string, row: Installation): Promise<void> {
  await enableSubdomain(token, row.accountId, row.workerName);
  if (row.hostname && row.zoneId && row.zoneName) {
    row.state.domainId = await attachDomain(
      token,
      row.accountId,
      row.hostname,
      row.workerName,
      row.zoneId,
      row.zoneName,
    );
  }
}

async function prove(row: Installation): Promise<boolean> {
  row.message = "The browser will confirm that Dotnote answers before it receives Cloudflare access.";
  return true;
}

async function runStep(env: Env, token: string, row: Installation, installerOrigin: string): Promise<boolean> {
  switch (STEPS[row.stepIndex]?.id) {
    case "check":
      await loadRelease(env);
      await checkAccount(token, row);
      return true;
    case "d1":
      await ensureD1(token, row);
      return true;
    case "migrate":
      return migrate(token, env, row);
    case "r2":
      await ensureR2(token, row);
      return true;
    case "assets":
      return uploadAssets(token, env, row);
    case "worker":
      await uploadWorker(token, env, row, installerOrigin);
      return true;
    case "secrets":
      await storeSecrets(token, env, row);
      return true;
    case "address":
      await turnOnAddress(token, row);
      return true;
    case "prove":
      return prove(row);
    default:
      return true;
  }
}

export async function advance(env: Env, token: string, row: Installation, installerOrigin: string): Promise<StepView> {
  try {
    if (row.stepIndex >= STEPS.length) {
      row.status = "ready";
      return publish(row);
    }
    const step = STEPS[row.stepIndex];
    const done = await runStep(env, token, row, installerOrigin);
    if (done) {
      row.stepIndex += 1;
      if (row.stepIndex >= STEPS.length) {
        row.status = "ready";
        row.message = "Dotnote is ready for its Cloudflare permission.";
      } else {
        row.status = "running";
      }
    } else {
      row.status = "running";
    }
    const waitMs = "waitMs" in step ? step.waitMs : undefined;
    return publish(row, done ? undefined : waitMs);
  } catch (err) {
    row.status = "failed";
    row.message = err instanceof Error ? err.message : "The step failed.";
    return publish(row);
  }
}

export async function removeInstallationResources(token: string, row: Installation): Promise<string | null> {
  const leftovers: string[] = [];
  if (row.state.domainId) {
    try {
      await deleteDomain(token, row.accountId, row.state.domainId);
      row.state.domainId = undefined;
    } catch (err) {
      leftovers.push(err instanceof Error ? err.message : "domain");
    }
  }
  if (row.state.scriptUploaded) {
    try {
      await deleteScript(token, row.accountId, row.workerName);
      row.state.scriptUploaded = false;
    } catch (err) {
      leftovers.push(err instanceof Error ? err.message : "worker");
    }
  }
  if (row.state.d1Id) {
    try {
      await deleteD1(token, row.accountId, row.state.d1Id);
      row.state.d1Id = undefined;
    } catch (err) {
      leftovers.push(err instanceof Error ? err.message : "database");
    }
  }
  if (row.state.r2Name) {
    try {
      await deleteR2(token, row.accountId, row.state.r2Name);
      row.state.r2Name = undefined;
    } catch (err) {
      leftovers.push(err instanceof Error ? err.message : "bucket");
    }
  }
  return leftovers.length ? leftovers.join("; ") : null;
}
