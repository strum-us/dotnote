import type { Env } from "./env";

/** One app migration file. `since` is the release that first shipped it. */
export type ReleaseMigration = { name: string; since: string; statements: string[] };

/**
 * `public/release/manifest.json`, written by scripts/pack-release.mjs. Schema 1
 * had `migrations: string[]`; schema 2 groups them per file and adds what a
 * running Dotnote reads to update itself (app/worker/update/).
 */
export type ReleaseManifest = {
  schema?: number;
  version: string;
  releasedAt?: string;
  notes?: string | null;
  rolloutPercent?: number;
  workerSha256?: string;
  sizeBytes?: number;
  compatibilityDate: string;
  compatibilityFlags: string[];
  migrations: string[] | ReleaseMigration[];
  migrationsFlat?: string[];
  assets: { path: string; hash: string; size: number; contentType: string }[];
};

/** Every statement in apply order, for either schema. */
export function flatMigrations(release: ReleaseManifest): string[] {
  if (release.migrationsFlat) return release.migrationsFlat;
  return (release.migrations as (string | ReleaseMigration)[]).flatMap((entry) =>
    typeof entry === "string" ? [entry] : entry.statements,
  );
}

/** Migration files with names; empty for a schema 1 manifest. */
export function migrationFiles(release: ReleaseManifest): ReleaseMigration[] {
  return (release.migrations as (string | ReleaseMigration)[]).filter(
    (entry): entry is ReleaseMigration => typeof entry !== "string",
  );
}

async function asset(env: Env, path: string): Promise<Response> {
  return env.ASSETS.fetch(new Request(`https://assets.local${path}`));
}

export async function loadRelease(env: Env): Promise<ReleaseManifest> {
  const res = await asset(env, "/release/manifest.json");
  if (!res.ok) {
    throw new Error("This installer has no Dotnote release yet. Publish the release, then try again.");
  }
  return res.json<ReleaseManifest>();
}

export async function loadWorkerSource(env: Env): Promise<string> {
  const res = await asset(env, "/release/worker.js");
  if (!res.ok) throw new Error("The release is missing the Worker script.");
  return res.text();
}

export async function loadAssetBytes(env: Env, hash: string): Promise<Uint8Array> {
  const res = await asset(env, `/release/files/${hash}`);
  if (!res.ok) throw new Error(`The release is missing file ${hash}.`);
  return new Uint8Array(await res.arrayBuffer());
}
