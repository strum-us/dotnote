import { createHash, createPrivateKey, createPublicKey, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");
const releaseDir = path.join(root, "installer", "public", "release");
const archiveDir = path.join(releaseDir, "archive");
const bundleDir = path.join(root, "installer", ".wrangler", "pack");
const notesDir = path.join(root, "release-notes");
const keysFile = path.join(appDir, "worker", "update", "release-keys.json");
const defaultKeyFile = path.join(os.homedir(), ".dotnote", "release-signing-key.pem");

/** Releases kept under release/archive/ for rollback and pinned downloads. */
const KEEP_ARCHIVES = 10;

const MIME = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript",
  mjs: "text/javascript",
  json: "application/json",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  txt: "text/plain; charset=utf-8",
  map: "application/json",
  webmanifest: "application/manifest+json",
};

function fail(message) {
  console.error(message);
  process.exit(1);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function readJsonc(file) {
  const text = file
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  return JSON.parse(text);
}

function splitSql(sql) {
  const stripped = sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
  return stripped
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** Same rules as app/shared/version.ts. */
function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? "" };
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  if (!left || !right) throw new Error(`Cannot compare versions ${a} and ${b}`);
  for (let i = 0; i < 3; i++) {
    if (left.parts[i] !== right.parts[i]) return left.parts[i] < right.parts[i] ? -1 : 1;
  }
  if (left.pre === right.pre) return 0;
  if (!left.pre) return 1;
  if (!right.pre) return -1;
  return left.pre < right.pre ? -1 : 1;
}

/** Every migration starts with `-- @since x.y.z`: the release that first ships it. */
function migrationSince(name, sql) {
  const head = sql.split("\n").slice(0, 5).join("\n");
  const match = /^\s*--\s*@since\s+(\S+)\s*$/m.exec(head);
  if (!match) fail(`${name} needs a "-- @since x.y.z" header (the release that first ships it).`);
  if (!parseVersion(match[1])) fail(`${name} has an invalid @since version: ${match[1]}`);
  return match[1];
}

/**
 * Releases are signed so a Dotnote can update itself with no one watching:
 * it trusts a manifest only when a key in app/worker/update/release-keys.json
 * signed it. The private key comes from DOTNOTE_RELEASE_SIGNING_KEY (PEM), or
 * the file DOTNOTE_RELEASE_SIGNING_KEY_FILE, or ~/.dotnote/release-signing-key.pem.
 */
async function loadSigningKey() {
  const file = process.env.DOTNOTE_RELEASE_SIGNING_KEY_FILE || defaultKeyFile;
  const pem = process.env.DOTNOTE_RELEASE_SIGNING_KEY?.trim() || (existsSync(file) ? await readFile(file, "utf8") : "");
  if (!pem) fail(`No release signing key at ${file}. Create one with: node scripts/release-key.mjs`);
  const privateKey = createPrivateKey(pem);
  if (privateKey.asymmetricKeyType !== "ed25519") fail("The release signing key must be an Ed25519 key.");
  const raw = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(-32);
  const publicKey = raw.toString("base64");
  const listed = JSON.parse(await readFile(keysFile, "utf8")).keys.find((key) => key.publicKey === publicKey);
  if (!listed) {
    fail(
      `The signing key ${publicKey} is not in app/worker/update/release-keys.json, so Dotnotes would refuse this release. ` +
        "Run node scripts/release-key.mjs to add it.",
    );
  }
  return { privateKey, id: listed.id };
}

/** `manifest.json.sig`: a detached signature over the exact bytes of `manifest.json`. */
function signatureFile(key, bytes) {
  return JSON.stringify({ keyId: key.id, signature: sign(null, bytes, key.privateKey).toString("base64") });
}

/**
 * Front matter keys: `date`, `rollout` (percent of instances offered the
 * release), and `auto` (`false` keeps automatic updates from starting it).
 */
function parseNotes(text) {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  const meta = {};
  if (match) {
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^\s*([A-Za-z]+)\s*:\s*(.*?)\s*$/.exec(line);
      if (kv) meta[kv[1]] = kv[2];
    }
  }
  return { meta, body: (match ? text.slice(match[0].length) : text).trim() };
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && !entry.name.endsWith(".map") && entry.name !== ".DS_Store") out.push(full);
  }
  return out;
}

async function readArchivedManifests() {
  if (!existsSync(archiveDir)) return [];
  const out = [];
  for (const entry of await readdir(archiveDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(archiveDir, entry.name, "manifest.json");
    if (!existsSync(file)) continue;
    try {
      const manifest = JSON.parse(await readFile(file, "utf8"));
      if (typeof manifest.version === "string" && parseVersion(manifest.version)) out.push(manifest);
    } catch {
      /* skip a broken archive entry */
    }
  }
  return out.sort((a, b) => compareVersions(b.version, a.version));
}

const signingKey = await loadSigningKey();
const pkg = JSON.parse(await readFile(path.join(appDir, "package.json"), "utf8"));
const wrangler = readJsonc(await readFile(path.join(appDir, "wrangler.jsonc"), "utf8"));
if (!parseVersion(pkg.version)) fail(`app/package.json has an invalid version: ${pkg.version}`);

const migrationDir = path.join(appDir, "migrations");
const migrationNames = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
const migrations = [];
for (const name of migrationNames) {
  const sql = await readFile(path.join(migrationDir, name), "utf8");
  const since = migrationSince(name, sql);
  if (compareVersions(since, pkg.version) > 0) {
    fail(`${name} is marked @since ${since}, newer than the release being packed (${pkg.version}).`);
  }
  const previous = migrations[migrations.length - 1];
  if (previous && compareVersions(since, previous.since) < 0) {
    fail(`${name} (@since ${since}) sorts after ${previous.name} (@since ${previous.since}). Keep @since in file order.`);
  }
  migrations.push({ name: name.replace(/\.sql$/, ""), since, statements: splitSql(sql) });
}

const notesFile = path.join(notesDir, `${pkg.version}.md`);
let notes = null;
let releasedAt = new Date().toISOString();
let rolloutPercent = 100;
let autoUpdate = true;
if (existsSync(notesFile)) {
  const parsed = parseNotes(await readFile(notesFile, "utf8"));
  notes = parsed.body || null;
  if (parsed.meta.date && !Number.isNaN(Date.parse(parsed.meta.date))) {
    releasedAt = new Date(parsed.meta.date).toISOString();
  }
  if (parsed.meta.rollout !== undefined) {
    const value = Number(parsed.meta.rollout.replace(/%$/, ""));
    if (!Number.isFinite(value) || value < 0 || value > 100) fail(`Invalid rollout in ${notesFile}: ${parsed.meta.rollout}`);
    rolloutPercent = Math.round(value);
  }
  if (parsed.meta.auto !== undefined) {
    const value = parsed.meta.auto.toLowerCase();
    if (!["true", "false", "yes", "no"].includes(value)) fail(`Invalid auto in ${notesFile}: ${parsed.meta.auto}`);
    autoUpdate = value === "true" || value === "yes";
  }
} else {
  console.warn(`No release notes at release-notes/${pkg.version}.md; the update dialog will show none.`);
}

run("pnpm", ["--filter", "dotnote-app", "build"], root);
await rm(bundleDir, { recursive: true, force: true });
await mkdir(bundleDir, { recursive: true });
run(
  "pnpm",
  [
    "--filter",
    "dotnote-app",
    "exec",
    "wrangler",
    "deploy",
    "--dry-run",
    "--outdir",
    bundleDir,
    "--no-upload-source-maps",
  ],
  root,
);

const bundleFiles = (await readdir(bundleDir)).filter((name) => name.endsWith(".js") && !name.endsWith(".js.map"));
const workerFile = bundleFiles.includes("index.js") ? "index.js" : bundleFiles[0];
if (!workerFile) fail("wrangler did not write a worker bundle");
const workerBytes = await readFile(path.join(bundleDir, workerFile));

const distDir = path.join(appDir, "dist");
const files = await walk(distDir);
const assets = [];
const byHash = new Map();
for (const file of files) {
  const bytes = await readFile(file);
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const rel = path.relative(distDir, file).split(path.sep).join("/");
  const ext = path.extname(file).slice(1).toLowerCase();
  assets.push({
    path: `/${rel}`,
    hash,
    size: bytes.length,
    contentType: MIME[ext] ?? "application/octet-stream",
  });
  if (!byHash.has(hash)) byHash.set(hash, bytes);
}

const sizeBytes = workerBytes.length + [...byHash.values()].reduce((sum, file) => sum + file.length, 0);
const manifest = {
  schema: 2,
  version: pkg.version,
  releasedAt,
  notes,
  rolloutPercent,
  autoUpdate,
  license: "SUL-1.0",
  compatibilityDate: wrangler.compatibility_date,
  compatibilityFlags: wrangler.compatibility_flags ?? [],
  workerSha256: createHash("sha256").update(workerBytes).digest("hex"),
  sizeBytes,
  migrations,
  // Flat statement list in file order, for installers that read manifest schema 1.
  migrationsFlat: migrations.flatMap((file) => file.statements),
  assets,
};

// Earlier releases stay: files/ is content-addressed and shared, archive/<version>/ keeps each manifest and Worker.
await mkdir(path.join(releaseDir, "files"), { recursive: true });
const versionDir = path.join(archiveDir, pkg.version);
await rm(versionDir, { recursive: true, force: true });
await mkdir(versionDir, { recursive: true });

await writeFile(path.join(releaseDir, "worker.js"), workerBytes);
await writeFile(path.join(versionDir, "worker.js"), workerBytes);
await writeFile(path.join(releaseDir, "LICENSE.md"), await readFile(path.join(root, "LICENSE.md")));
for (const [hash, bytes] of byHash) {
  await writeFile(path.join(releaseDir, "files", hash), bytes);
}
const manifestBytes = Buffer.from(JSON.stringify(manifest));
const manifestSignature = signatureFile(signingKey, manifestBytes);
for (const dir of [versionDir, releaseDir]) {
  await writeFile(path.join(dir, "manifest.json"), manifestBytes);
  await writeFile(path.join(dir, "manifest.json.sig"), manifestSignature);
}

// Trim old archives, then drop asset files that no kept release refers to.
const archived = await readArchivedManifests();
for (const old of archived.slice(KEEP_ARCHIVES)) {
  await rm(path.join(archiveDir, old.version), { recursive: true, force: true });
}
const kept = archived.slice(0, KEEP_ARCHIVES);
// Archives packed before releases were signed, or under an older key, are signed now so going back to them still works.
for (const release of kept) {
  const file = path.join(archiveDir, release.version, "manifest.json");
  await writeFile(`${file}.sig`, signatureFile(signingKey, await readFile(file)));
}
const referenced = new Set(kept.flatMap((release) => (release.assets ?? []).map((file) => file.hash)));
let pruned = 0;
for (const name of await readdir(path.join(releaseDir, "files"))) {
  if (referenced.has(name) || byHash.has(name)) continue;
  await rm(path.join(releaseDir, "files", name), { force: true });
  pruned += 1;
}
await writeFile(
  path.join(archiveDir, "index.json"),
  JSON.stringify({
    latest: pkg.version,
    releases: kept.map((release) => ({
      version: release.version,
      releasedAt: release.releasedAt ?? null,
      sizeBytes: release.sizeBytes ?? null,
    })),
  }),
);

console.log(
  `Packed Dotnote ${pkg.version}: ${assets.length} files, worker ${workerFile}, ${sizeBytes} bytes, ` +
    `${migrations.length} migrations, rollout ${rolloutPercent}%${autoUpdate ? "" : ", manual only"}, ` +
    `${kept.length} archived, signed with key ${signingKey.id}` +
    (pruned ? `, pruned ${pruned} unused files` : ""),
);
