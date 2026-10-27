import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appDir = path.join(root, "app");
const releaseDir = path.join(root, "installer", "public", "release");
const bundleDir = path.join(root, "installer", ".wrangler", "pack");

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

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.isFile() && !entry.name.endsWith(".map") && entry.name !== ".DS_Store") out.push(full);
  }
  return out;
}

const pkg = JSON.parse(await readFile(path.join(appDir, "package.json"), "utf8"));
const wrangler = readJsonc(await readFile(path.join(appDir, "wrangler.jsonc"), "utf8"));

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
if (!workerFile) {
  console.error("wrangler did not write a worker bundle");
  process.exit(1);
}

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

const migrationDir = path.join(appDir, "migrations");
const migrationNames = (await readdir(migrationDir)).filter((name) => name.endsWith(".sql")).sort();
const migrations = [];
for (const name of migrationNames) {
  migrations.push(...splitSql(await readFile(path.join(migrationDir, name), "utf8")));
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(path.join(releaseDir, "files"), { recursive: true });
await writeFile(path.join(releaseDir, "worker.js"), await readFile(path.join(bundleDir, workerFile)));
await writeFile(path.join(releaseDir, "LICENSE.md"), await readFile(path.join(root, "LICENSE.md")));
for (const [hash, bytes] of byHash) {
  await writeFile(path.join(releaseDir, "files", hash), bytes);
}
const manifest = {
  version: pkg.version,
  license: "SUL-1.0",
  compatibilityDate: wrangler.compatibility_date,
  compatibilityFlags: wrangler.compatibility_flags ?? [],
  migrations,
  assets,
};
await writeFile(path.join(releaseDir, "manifest.json"), JSON.stringify(manifest));
const bytes = (await stat(path.join(releaseDir, "worker.js"))).size + [...byHash.values()].reduce((sum, file) => sum + file.length, 0);
console.log(`Packed Dotnote ${pkg.version}: ${assets.length} files, worker ${workerFile}, ${bytes} bytes`);
