import type { Env } from "./env";

export type ReleaseManifest = {
  version: string;
  compatibilityDate: string;
  compatibilityFlags: string[];
  migrations: string[];
  assets: { path: string; hash: string; size: number; contentType: string }[];
};

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
