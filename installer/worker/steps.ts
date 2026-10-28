import {
  attachDomain,
  createD1,
  createR2,
  d1Query,
  d1QueryRows,
  deleteD1,
  deleteDomain,
  deleteR2,
  deleteScript,
  enableSubdomain,
  findD1,
  findR2,
  findWorkersDomain,
  hostnameConflict,
  listSecretNames,
  purgeR2Bucket,
  putSchedules,
  putScript,
  putSecret,
  scriptExists,
  scriptSchedules,
  scriptSettings,
  startAssetSession,
  uploadAssetBucket,
  workersSubdomain,
  type ScriptBinding,
} from "./cf-api";
import { compareVersions } from "./resource-check";
import { bytesToBase64, randomGrantKey } from "./crypto";
import type { Env } from "./env";
import type { Installation } from "./install-store";
import {
  flatMigrations,
  loadAssetBytes,
  loadRelease,
  loadWorkerSource,
  migrationFiles,
  type ReleaseManifest,
} from "./release";

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

/**
 * The Cron Trigger a Dotnote uses to update itself while no tab is open
 * (app/worker/update/schedule.ts uses the same expression). It does nothing
 * until the owner turns automatic updates on.
 */
const UPDATE_CRON = "*/30 * * * *";

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

async function wipeResources(token: string, row: Installation): Promise<void> {
  const bucket = bucketName(row.workerName);
  const d1Id = await findD1(token, row.accountId, dbName(row.workerName));
  if (row.hostname) {
    const domain = await findWorkersDomain(token, row.accountId, row.hostname);
    if (domain) await deleteDomain(token, row.accountId, domain.id);
  }
  if (await scriptExists(token, row.accountId, row.workerName)) {
    await deleteScript(token, row.accountId, row.workerName);
  }
  if (await findR2(token, row.accountId, bucket)) {
    await purgeR2Bucket(token, row.accountId, bucket);
    await deleteR2(token, row.accountId, bucket);
  }
  if (d1Id) await deleteD1(token, row.accountId, d1Id);
  row.state = {};
}

async function adoptExistingResources(token: string, row: Installation): Promise<void> {
  const d1Id = await findD1(token, row.accountId, dbName(row.workerName));
  if (d1Id) {
    row.state.d1Id = d1Id;
    row.state.d1Adopted = true;
  }
  const bucket = bucketName(row.workerName);
  if (await findR2(token, row.accountId, bucket)) {
    row.state.r2Name = bucket;
    row.state.r2Adopted = true;
  }
  if (await scriptExists(token, row.accountId, row.workerName)) {
    row.state.workerAdopted = true;
    try {
      const settings = await scriptSettings(token, row.accountId, row.workerName);
      const version = (settings.bindings ?? []).find(
        (binding) => binding.name === "APP_VERSION" && binding.type === "plain_text",
      );
      if (version && typeof version.text === "string") row.state.installedVersion = version.text;
    } catch {
      /* The Worker exists but settings could not be read. */
    }
  }
}

async function checkAccount(token: string, row: Installation): Promise<void> {
  if (row.mode === "wipe") {
    await wipeResources(token, row);
  }
  if (row.mode === "update" || row.mode === "repair") {
    await adoptExistingResources(token, row);
  } else if (row.mode === "fresh") {
    if (await scriptExists(token, row.accountId, row.workerName)) {
      throw new Error(`A Worker named ${row.workerName} is already in this account.`);
    }
    if (await findD1(token, row.accountId, dbName(row.workerName))) {
      throw new Error(`A D1 database named ${dbName(row.workerName)} is already in this account.`);
    }
    if (await findR2(token, row.accountId, bucketName(row.workerName))) {
      throw new Error(`An R2 bucket named ${bucketName(row.workerName)} is already in this account.`);
    }
  }
  if (!row.hostname) {
    const subdomain = await workersSubdomain(token, row.accountId);
    if (!subdomain) {
      throw new Error(
        "This account has no workers.dev subdomain yet. Open Workers & Pages in the Cloudflare dashboard once, then try again.",
      );
    }
    row.state.subdomain = subdomain;
  } else if (row.zoneId && row.zoneName && row.mode === "fresh") {
    const conflict = await hostnameConflict(token, row.zoneId, row.zoneName, row.hostname);
    if (conflict) throw new Error(conflict);
  }
}

async function ensureD1(token: string, row: Installation): Promise<void> {
  if (row.state.d1Id) return;
  const name = dbName(row.workerName);
  try {
    row.state.d1Id = await createD1(token, row.accountId, name);
    row.state.d1Created = true;
  } catch (err) {
    const existing = await findD1(token, row.accountId, name);
    if (!existing) throw err;
    row.state.d1Id = existing;
    row.state.d1Adopted = true;
  }
}

/**
 * Mark every migration file as applied, so the Dotnote's own updater only runs
 * files added by later releases. Same table as app/worker/update/schema.ts.
 */
async function recordMigrations(token: string, row: Installation, release: ReleaseManifest): Promise<void> {
  const files = migrationFiles(release);
  if (!row.state.d1Id || files.length === 0) return;
  await d1Query(
    token,
    row.accountId,
    row.state.d1Id,
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const now = new Date().toISOString();
  const values = files.map((file) => `('${file.name.replace(/'/g, "''")}', '${now}')`).join(", ");
  await d1Query(
    token,
    row.accountId,
    row.state.d1Id,
    `INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES ${values}`,
  );
}

async function pendingMigrationStatements(token: string, row: Installation, release: ReleaseManifest): Promise<string[]> {
  const fromVersion = row.state.installedVersion ?? "0.0.0";
  const files = migrationFiles(release).filter((file) => compareVersions(file.since, fromVersion) > 0);
  if (!row.state.d1Id || files.length === 0) return [];
  await d1Query(
    token,
    row.accountId,
    row.state.d1Id,
    "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const appliedRows = await d1QueryRows<{ name: string }>(
    token,
    row.accountId,
    row.state.d1Id,
    "SELECT name FROM schema_migrations",
  );
  const applied = new Set(appliedRows.map((entry) => entry.name));
  return files.filter((file) => !applied.has(file.name)).flatMap((file) => file.statements);
}

async function migrate(token: string, env: Env, row: Installation): Promise<boolean> {
  const release = await loadRelease(env);
  const statements =
    row.mode === "update" || row.mode === "repair"
      ? await pendingMigrationStatements(token, row, release)
      : flatMigrations(release);
  if (!row.state.d1Id) throw new Error("The database was not created.");
  const start = row.state.migrationIndex ?? 0;
  const end = Math.min(statements.length, start + 20);
  for (let i = start; i < end; i++) {
    await d1Query(token, row.accountId, row.state.d1Id, statements[i]!);
    row.state.migrationIndex = i + 1;
  }
  row.message =
    statements.length === 0 ? null : `Migrations ${row.state.migrationIndex ?? 0} of ${statements.length}`;
  const done = (row.state.migrationIndex ?? 0) >= statements.length;
  if (done && row.mode === "fresh") await recordMigrations(token, row, release);
  if (done && (row.mode === "update" || row.mode === "repair")) {
    await recordPendingMigrationFiles(token, row, release);
  }
  return done;
}

async function recordPendingMigrationFiles(token: string, row: Installation, release: ReleaseManifest): Promise<void> {
  const fromVersion = row.state.installedVersion ?? "0.0.0";
  const files = migrationFiles(release).filter((file) => compareVersions(file.since, fromVersion) > 0);
  if (!row.state.d1Id || files.length === 0) return;
  const appliedRows = await d1QueryRows<{ name: string }>(
    token,
    row.accountId,
    row.state.d1Id,
    "SELECT name FROM schema_migrations",
  );
  const applied = new Set(appliedRows.map((entry) => entry.name));
  const pending = files.filter((file) => !applied.has(file.name));
  if (!pending.length) return;
  const now = new Date().toISOString();
  const values = pending.map((file) => `('${file.name.replace(/'/g, "''")}', '${now}')`).join(", ");
  await d1Query(
    token,
    row.accountId,
    row.state.d1Id,
    `INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES ${values}`,
  );
}

async function ensureR2(token: string, row: Installation): Promise<void> {
  if (row.state.r2Name) return;
  const name = bucketName(row.workerName);
  try {
    await createR2(token, row.accountId, name);
    row.state.r2Created = true;
  } catch (err) {
    if (!(await findR2(token, row.accountId, name))) throw err;
    row.state.r2Adopted = true;
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
  const diagnosticsUrl = env.DOTNOTE_DIAGNOSTICS_URL?.trim();
  return {
    main_module: "index.js",
    compatibility_date: release.compatibilityDate,
    compatibility_flags: release.compatibilityFlags,
    bindings: [
      { type: "d1", name: "DB", id: row.state.d1Id },
      { type: "r2_bucket", name: "BUCKET", bucket_name: row.state.r2Name },
      { type: "assets", name: "ASSETS" },
      // ENABLED allows a registration after the owner consents. It is not consent.
      ...(diagnosticsUrl
        ? [
            { type: "plain_text", name: "DOTNOTE_DIAGNOSTICS_URL", text: diagnosticsUrl },
            { type: "plain_text", name: "DOTNOTE_DIAGNOSTICS_ENABLED", text: "true" },
          ]
        : []),
      { type: "plain_text", name: "WORKER_NAME", text: row.workerName },
      { type: "plain_text", name: "R2_BUCKET_NAME", text: row.state.r2Name },
      { type: "plain_text", name: "D1_DATABASE_NAME", text: dbName(row.workerName) },
      { type: "plain_text", name: "CF_ACCOUNT_ID", text: row.accountId },
      { type: "plain_text", name: "CF_OAUTH_CLIENT_ID", text: env.OAUTH_CLIENT_ID },
      { type: "plain_text", name: "INSTALLER_ORIGIN", text: installerOrigin },
      { type: "plain_text", name: "APP_VERSION", text: release.version },
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

const SECRET_BINDING_TYPES = new Set(["secret_text", "secret_key"]);

/**
 * What a Dotnote needs to update itself. A Worker deployed with wrangler may
 * lack some of them; update and repair add the missing ones and keep the rest.
 */
function selfUpdateVars(env: Env, row: Installation, installerOrigin: string): ScriptBinding[] {
  return [
    { type: "plain_text", name: "WORKER_NAME", text: row.workerName },
    { type: "plain_text", name: "CF_ACCOUNT_ID", text: row.accountId },
    { type: "plain_text", name: "CF_OAUTH_CLIENT_ID", text: env.OAUTH_CLIENT_ID },
    { type: "plain_text", name: "INSTALLER_ORIGIN", text: installerOrigin },
  ];
}

function scriptMetadataUpdate(
  settings: Awaited<ReturnType<typeof scriptSettings>>,
  release: ReleaseManifest,
  jwt: string,
  runWorkerFirst: boolean,
  missingVars: ScriptBinding[],
) {
  const bindings: ScriptBinding[] = (settings.bindings ?? []).filter(
    (binding) => !SECRET_BINDING_TYPES.has(binding.type) && binding.name !== "APP_VERSION",
  );
  if (!bindings.some((binding) => binding.type === "assets")) {
    bindings.push({ type: "assets", name: "ASSETS" });
  }
  for (const binding of missingVars) {
    if (!bindings.some((existing) => existing.name === binding.name)) bindings.push(binding);
  }
  bindings.push({ type: "plain_text", name: "APP_VERSION", text: release.version });
  return {
    main_module: "index.js",
    compatibility_date: release.compatibilityDate,
    compatibility_flags: release.compatibilityFlags,
    bindings,
    keep_bindings: [...SECRET_BINDING_TYPES],
    assets: {
      jwt,
      config: runWorkerFirst
        ? { not_found_handling: "single-page-application", run_worker_first: true }
        : { not_found_handling: "single-page-application" },
    },
  };
}

async function uploadWorker(token: string, env: Env, row: Installation, installerOrigin: string): Promise<void> {
  if (!row.state.d1Id || !row.state.r2Name || !row.state.completionJwt) {
    throw new Error("The database, bucket, or files are not ready.");
  }
  const release = await loadRelease(env);
  const source = await loadWorkerSource(env);
  const useUpdate = row.mode === "update" || row.mode === "repair";
  const vars = selfUpdateVars(env, row, installerOrigin);
  const metadata = useUpdate
    ? scriptMetadataUpdate(
        await scriptSettings(token, row.accountId, row.workerName),
        release,
        row.state.completionJwt,
        true,
        vars,
      )
    : scriptMetadata(env, row, installerOrigin, release, row.state.completionJwt);
  try {
    await putScript(token, row.accountId, row.workerName, metadata, source);
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (!/run_worker_first|config/i.test(message)) throw err;
    if (useUpdate) {
      const fallback = scriptMetadataUpdate(
        await scriptSettings(token, row.accountId, row.workerName),
        release,
        row.state.completionJwt,
        false,
        vars,
      );
      await putScript(token, row.accountId, row.workerName, fallback, source);
    } else {
      const fallback = scriptMetadata(env, row, installerOrigin, release, row.state.completionJwt);
      fallback.assets.config = { not_found_handling: "single-page-application" } as typeof fallback.assets.config;
      await putScript(token, row.accountId, row.workerName, fallback, source);
    }
  }
  row.state.scriptUploaded = true;
  await ensureUpdateSchedule(token, row);
}

/** Keeps the script's other Cron Triggers. A failure here only delays automatic updates. */
async function ensureUpdateSchedule(token: string, row: Installation): Promise<void> {
  try {
    const crons = row.state.workerAdopted ? await scriptSchedules(token, row.accountId, row.workerName) : [];
    if (crons.includes(UPDATE_CRON)) return;
    await putSchedules(token, row.accountId, row.workerName, [...crons, UPDATE_CRON]);
  } catch (err) {
    console.error(
      JSON.stringify({ event: "install_schedule_failed", error: err instanceof Error ? err.message : String(err) }),
    );
  }
}

async function storeSecrets(token: string, env: Env, row: Installation): Promise<void> {
  if (row.mode === "update" || row.mode === "repair") {
    // A new CF_GRANT_KEY could not decrypt a grant stored under the old one, so
    // only a Worker that never had one gets a key (a wrangler deploy, say).
    const present = new Set(await listSecretNames(token, row.accountId, row.workerName));
    if (!present.has("CF_GRANT_KEY")) {
      await putSecret(token, row.accountId, row.workerName, "CF_GRANT_KEY", randomGrantKey());
    }
    await putSecret(token, row.accountId, row.workerName, "DOTNOTE_HANDOFF", row.handoffHash);
    return;
  }
  const grantKey = randomGrantKey();
  await putSecret(token, row.accountId, row.workerName, "CF_GRANT_KEY", grantKey);
  await putSecret(token, row.accountId, row.workerName, "DOTNOTE_HANDOFF", row.handoffHash);
  const diagnosticsToken = env.DOTNOTE_DIAGNOSTICS_TOKEN?.trim();
  if (diagnosticsToken) {
    await putSecret(token, row.accountId, row.workerName, "DOTNOTE_DIAGNOSTICS_TOKEN", diagnosticsToken);
  }
}

/**
 * Puts a new setup code on the Worker when the browser that held the old one
 * is gone. Before the `secrets` step the step itself stores it.
 */
export async function replaceHandoff(token: string, row: Installation, handoffHash: string): Promise<void> {
  row.handoffHash = handoffHash;
  const secretsStep = STEPS.findIndex((step) => step.id === "secrets");
  if (row.stepIndex > secretsStep) {
    await putSecret(token, row.accountId, row.workerName, "DOTNOTE_HANDOFF", handoffHash);
  }
}

async function turnOnAddress(token: string, row: Installation): Promise<void> {
  await enableSubdomain(token, row.accountId, row.workerName);
  if (row.hostname && row.zoneId && row.zoneName) {
    const existing = await findWorkersDomain(token, row.accountId, row.hostname);
    if (existing?.service === row.workerName) {
      row.state.domainId = existing.id;
      return;
    }
    row.state.domainId = await attachDomain(
      token,
      row.accountId,
      row.hostname,
      row.workerName,
      row.zoneId,
      row.zoneName,
    );
    row.state.domainCreated = true;
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
  if (row.mode === "update" || row.mode === "repair") {
    const leftovers: string[] = [];
    if (row.state.domainCreated && row.state.domainId) {
      try {
        await deleteDomain(token, row.accountId, row.state.domainId);
        row.state.domainId = undefined;
      } catch (err) {
        leftovers.push(err instanceof Error ? err.message : "domain");
      }
    }
    return leftovers.length ? leftovers.join("; ") : null;
  }

  const leftovers: string[] = [];
  if (row.state.domainCreated && row.state.domainId) {
    try {
      await deleteDomain(token, row.accountId, row.state.domainId);
      row.state.domainId = undefined;
    } catch (err) {
      leftovers.push(err instanceof Error ? err.message : "domain");
    }
  }
  if (row.state.scriptUploaded && !row.state.workerAdopted) {
    try {
      await deleteScript(token, row.accountId, row.workerName);
      row.state.scriptUploaded = false;
    } catch (err) {
      leftovers.push(err instanceof Error ? err.message : "worker");
    }
  }
  if (row.state.d1Id && row.state.d1Created) {
    try {
      await deleteD1(token, row.accountId, row.state.d1Id);
      row.state.d1Id = undefined;
    } catch (err) {
      leftovers.push(err instanceof Error ? err.message : "database");
    }
  }
  if (row.state.r2Name && row.state.r2Created) {
    try {
      await deleteR2(token, row.accountId, row.state.r2Name);
      row.state.r2Name = undefined;
    } catch (err) {
      leftovers.push(err instanceof Error ? err.message : "bucket");
    }
  }
  return leftovers.length ? leftovers.join("; ") : null;
}
