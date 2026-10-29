import { compareVersions } from "@shared/version";
import type { Env } from "../env";
import type { ReleaseManifest, ReleaseMigration } from "./release-client";

/**
 * Tables the updater owns. They are created here rather than by a migration,
 * because the updater is what applies migrations. The installer creates
 * `schema_migrations` the same way (installer/worker/steps.ts). Columns may be
 * added but never renamed: an older Worker reads these rows after a rollback.
 */
const BOOTSTRAP = [
  "CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)",
  `CREATE TABLE IF NOT EXISTS update_jobs (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    from_version TEXT NOT NULL,
    to_version TEXT NOT NULL,
    step TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT,
    error_code TEXT,
    state TEXT NOT NULL DEFAULT '{}',
    lease_until TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    finished_at TEXT
  )`,
  "CREATE INDEX IF NOT EXISTS idx_update_jobs_created ON update_jobs(created_at)",
];

let bootstrapped = false;

export async function ensureUpdateTables(env: Env): Promise<void> {
  if (bootstrapped) return;
  await env.DB.batch(BOOTSTRAP.map((sql) => env.DB.prepare(sql)));
  bootstrapped = true;
}

export async function appliedMigrations(env: Env): Promise<Set<string>> {
  const { results } = await env.DB.prepare("SELECT name FROM schema_migrations").all<{ name: string }>();
  return new Set((results ?? []).map((row) => row.name));
}

/**
 * Files to run when moving from `fromVersion` to `release`. A file shipped in
 * `fromVersion` or earlier is already in the database, recorded or not:
 * installs before manifest schema 2 and wrangler-managed instances never
 * wrote `schema_migrations`.
 */
export function pendingMigrations(
  release: ReleaseManifest,
  applied: Set<string>,
  fromVersion: string,
): ReleaseMigration[] {
  return release.migrations.filter(
    (file) => compareVersions(file.since, fromVersion) > 0 && !applied.has(file.name),
  );
}

/** One file per D1 batch, so it lands with its `schema_migrations` row or not at all. */
export async function applyMigration(env: Env, file: ReleaseMigration): Promise<void> {
  const statements = file.statements.map((sql) => env.DB.prepare(sql));
  statements.push(
    env.DB.prepare("INSERT OR IGNORE INTO schema_migrations (name, applied_at) VALUES (?, ?)").bind(
      file.name,
      new Date().toISOString(),
    ),
  );
  await env.DB.batch(statements);
}

/** Null when the key or the table is missing (a request may run before the updater created it). */
export async function getMeta(env: Env, key: string): Promise<string | null> {
  try {
    const row = await env.DB.prepare("SELECT value FROM app_meta WHERE key = ?").bind(key).first<{ value: string }>();
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export async function deleteMeta(env: Env, key: string): Promise<void> {
  await env.DB.prepare("DELETE FROM app_meta WHERE key = ?").bind(key).run();
}

export async function setMeta(env: Env, key: string, value: string): Promise<void> {
  await env.DB.prepare(
    "INSERT INTO app_meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  )
    .bind(key, value)
    .run();
}
