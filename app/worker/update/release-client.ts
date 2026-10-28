import { isVersion } from "@shared/version";
import type { Env } from "../env";
import releaseKeys from "./release-keys.json";
import { parseSignature, verifySignature, type ReleaseKey } from "./signature";

export type ReleaseMigration = { name: string; since: string; statements: string[] };
export type ReleaseAsset = { path: string; hash: string; size: number; contentType: string };

/** Manifest schema 2 from scripts/pack-release.mjs (see installer/worker/release.ts). */
export type ReleaseManifest = {
  version: string;
  releasedAt: string | null;
  notes: string | null;
  rolloutPercent: number;
  /** False when the release notes say `auto: false`: only the owner starts it. */
  autoUpdate: boolean;
  workerSha256: string;
  sizeBytes: number;
  compatibilityDate: string;
  compatibilityFlags: string[];
  migrations: ReleaseMigration[];
  assets: ReleaseAsset[];
};

/** Shared by every request on this isolate, and by every isolate in the colo through the Cache API. */
const MANIFEST_TTL_MS = 15 * 60 * 1000;
let memo: { url: string; at: number; manifest: ReleaseManifest } | null = null;

const RELEASE_KEYS: ReleaseKey[] = releaseKeys.keys;

/** The manifest as the installer sent it, with its detached signature. Cached in this form and checked again on read. */
type SignedManifest = { body: string; signature: string };

export function installerOrigin(env: Env): string | null {
  const origin = env.INSTALLER_ORIGIN?.trim().replace(/\/$/, "");
  return origin || null;
}

function requireOrigin(env: Env): string {
  const origin = installerOrigin(env);
  if (!origin) throw new Error("This Dotnote has no installer address to fetch releases from.");
  return origin;
}

function parseManifest(value: unknown): ReleaseManifest {
  const raw = (value ?? {}) as Record<string, unknown>;
  const migrations = Array.isArray(raw.migrations) ? raw.migrations : [];
  const valid =
    typeof raw.version === "string" &&
    isVersion(raw.version) &&
    typeof raw.workerSha256 === "string" &&
    typeof raw.compatibilityDate === "string" &&
    Array.isArray(raw.assets) &&
    migrations.every((entry) => entry && typeof entry === "object" && "statements" in entry);
  if (!valid) throw new Error("The installer sent a release this Dotnote cannot read.");
  return {
    version: raw.version as string,
    releasedAt: typeof raw.releasedAt === "string" ? raw.releasedAt : null,
    notes: typeof raw.notes === "string" ? raw.notes : null,
    rolloutPercent: typeof raw.rolloutPercent === "number" ? raw.rolloutPercent : 100,
    autoUpdate: raw.autoUpdate !== false,
    workerSha256: raw.workerSha256 as string,
    sizeBytes: typeof raw.sizeBytes === "number" ? raw.sizeBytes : 0,
    compatibilityDate: raw.compatibilityDate as string,
    compatibilityFlags: Array.isArray(raw.compatibilityFlags) ? (raw.compatibilityFlags as string[]) : [],
    migrations: migrations as ReleaseMigration[],
    assets: raw.assets as ReleaseAsset[],
  };
}

/** Nothing in the manifest is read before its signature checks out. */
async function openManifest(signed: SignedManifest): Promise<ReleaseManifest> {
  const signature = parseSignature(signed.signature);
  const bytes = new TextEncoder().encode(signed.body);
  if (!signature || !(await verifySignature(RELEASE_KEYS, bytes, signature))) {
    throw new Error("The installer sent a release that is not signed by Dotnote.");
  }
  let json: unknown;
  try {
    json = JSON.parse(signed.body);
  } catch {
    throw new Error("The installer did not send a release manifest.");
  }
  return parseManifest(json);
}

async function fetchSigned(url: string): Promise<SignedManifest | null> {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`The installer answered ${res.status} for ${new URL(url).pathname}.`);
  const body = new TextDecoder().decode(await res.arrayBuffer());
  const sig = await fetch(`${url}.sig`);
  if (!sig.ok) throw new Error(`The installer has no signature for ${new URL(url).pathname}.`);
  return { body, signature: await sig.text() };
}

async function fetchManifest(url: string): Promise<ReleaseManifest | null> {
  const signed = await fetchSigned(url);
  return signed ? openManifest(signed) : null;
}

/** The app tsconfig also loads the DOM lib, whose CacheStorage has no `default`. */
function zoneCache(): Cache {
  return (caches as unknown as { default: Cache }).default;
}

async function cacheRead(url: string): Promise<ReleaseManifest | null> {
  try {
    const hit = await zoneCache().match(new Request(url));
    return hit ? await openManifest((await hit.json()) as SignedManifest) : null;
  } catch {
    return null;
  }
}

async function cacheWrite(url: string, signed: SignedManifest): Promise<void> {
  try {
    const body = JSON.stringify(signed);
    const headers = { "content-type": "application/json", "cache-control": `max-age=${MANIFEST_TTL_MS / 1000}` };
    await zoneCache().put(new Request(url), new Response(body, { headers }));
  } catch {
    /* workers.dev and local dev have no zone cache */
  }
}

/** The newest release, cached for 15 minutes so instances do not all hit the installer. */
export async function latestRelease(env: Env, options: { force?: boolean } = {}): Promise<ReleaseManifest> {
  const url = `${requireOrigin(env)}/release/manifest.json`;
  if (!options.force) {
    if (memo && memo.url === url && Date.now() - memo.at < MANIFEST_TTL_MS) return memo.manifest;
    const cached = await cacheRead(url);
    if (cached) {
      memo = { url, at: Date.now(), manifest: cached };
      return cached;
    }
  }
  const signed = await fetchSigned(url);
  if (!signed) throw new Error("The installer has no Dotnote release yet.");
  const manifest = await openManifest(signed);
  memo = { url, at: Date.now(), manifest };
  await cacheWrite(url, signed);
  return manifest;
}

/** One exact release: its archived manifest, or the latest one when that is the version asked for. */
export async function releaseManifest(env: Env, version: string): Promise<ReleaseManifest> {
  const origin = requireOrigin(env);
  const archived = await fetchManifest(`${origin}/release/archive/${encodeURIComponent(version)}/manifest.json`).catch(
    () => null,
  );
  if (archived?.version === version) return archived;
  const latest = await latestRelease(env, { force: true });
  if (latest.version === version) return latest;
  throw new Error(`The installer no longer has Dotnote ${version}.`);
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** The release's Worker bundle, checked against the manifest's hash before anything uploads it. */
export async function workerSource(env: Env, release: ReleaseManifest): Promise<Uint8Array<ArrayBuffer>> {
  const origin = requireOrigin(env);
  const urls = [
    `${origin}/release/archive/${encodeURIComponent(release.version)}/worker.js`,
    `${origin}/release/worker.js`,
  ];
  for (const url of urls) {
    const res = await fetch(url);
    if (!res.ok) continue;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if ((await sha256Hex(bytes)) === release.workerSha256) return bytes;
  }
  throw new Error(`The installer's Worker for Dotnote ${release.version} did not match its manifest.`);
}

/** A release file, checked against its name: the signed manifest names each file by the start of its SHA-256. */
export async function assetBytes(env: Env, hash: string): Promise<Uint8Array<ArrayBuffer>> {
  const res = await fetch(`${requireOrigin(env)}/release/files/${hash}`);
  if (!res.ok) throw new Error(`The release is missing file ${hash}.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  if (hash.length < 32 || !(await sha256Hex(bytes)).startsWith(hash)) {
    throw new Error(`The installer's file ${hash} did not match the release.`);
  }
  return bytes;
}
