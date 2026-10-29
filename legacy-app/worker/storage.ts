import type { BackupSummary, StoredBackup, WorkspaceManifest } from "@shared/types";
import {
  emptyManifest,
  historyIndexKey,
  historySnapshotKey,
  manifestKey,
  noteKey,
  pageAssetKey,
  pageAssetPrefixForNote,
} from "@shared/manifest";
import { mimeTypeFromAssetFilename } from "@shared/page-assets";
import type { Env } from "./env";
import { contentHash, randomId } from "./crypto";

const MAX_BACKUPS = 100;

export async function readJson<T>(bucket: R2Bucket, key: string): Promise<T | null> {
  const obj = await bucket.get(key);
  if (!obj) return null;
  return (await obj.json()) as T;
}

export async function writeJson(bucket: R2Bucket, key: string, value: unknown): Promise<void> {
  await bucket.put(key, JSON.stringify(value), {
    httpMetadata: { contentType: "application/json" },
  });
}

export async function getManifest(env: Env, workspaceId: string): Promise<WorkspaceManifest> {
  const m = await readJson<WorkspaceManifest>(env.BUCKET, manifestKey(workspaceId));
  return m ?? emptyManifest();
}

export async function putManifest(env: Env, workspaceId: string, manifest: WorkspaceManifest): Promise<void> {
  await writeJson(env.BUCKET, manifestKey(workspaceId), manifest);
}

const MANIFEST_ATTEMPTS = 8;

/**
 * Read-modify-write the manifest with an etag precondition, retrying on
 * contention, so concurrent requests never drop each other's entries.
 * `mutate` bumps `rev` when it changes something; an unchanged manifest is
 * not rewritten.
 */
export async function mutateManifest<T>(
  env: Env,
  workspaceId: string,
  mutate: (manifest: WorkspaceManifest) => T | Promise<T>,
): Promise<{ manifest: WorkspaceManifest; value: T }> {
  const key = manifestKey(workspaceId);
  for (let attempt = 0; attempt < MANIFEST_ATTEMPTS; attempt++) {
    const current = await env.BUCKET.get(key);
    const manifest = current ? await current.json<WorkspaceManifest>() : emptyManifest();
    const rev = manifest.rev;
    const value = await mutate(manifest);
    if (manifest.rev === rev) return { manifest, value };
    const body = JSON.stringify(manifest);
    const httpMetadata = { contentType: "application/json" };
    const written = current
      ? await env.BUCKET.put(key, body, { httpMetadata, onlyIf: { etagMatches: current.etag } })
      : await env.BUCKET.put(key, body, { httpMetadata });
    if (written) return { manifest, value };
    await new Promise((resolve) => setTimeout(resolve, 10 + Math.random() * 40 * (attempt + 1)));
  }
  throw new Error("manifest_contention");
}

export async function readNote(env: Env, workspaceId: string, noteId: string): Promise<string | null> {
  const obj = await env.BUCKET.get(noteKey(workspaceId, noteId));
  if (!obj) return null;
  return obj.text();
}

export async function deleteNoteObject(env: Env, workspaceId: string, noteId: string): Promise<void> {
  await env.BUCKET.delete(noteKey(workspaceId, noteId));
}

/** Remove every R2 object under `workspaces/{workspaceId}/`. */
export async function deleteWorkspaceBucketData(env: Env, workspaceId: string): Promise<void> {
  const prefix = `workspaces/${workspaceId}/`;
  let cursor: string | undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: 1000 });
    if (listed.objects.length > 0) {
      await Promise.all(listed.objects.map((obj) => env.BUCKET.delete(obj.key)));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function writePageAsset(
  env: Env,
  workspaceId: string,
  relativePath: string,
  body: ArrayBuffer | ReadableStream,
  mimeType?: string,
): Promise<void> {
  const filename = relativePath.split("/").pop() ?? "asset";
  const contentType = mimeType ?? mimeTypeFromAssetFilename(filename);
  await env.BUCKET.put(pageAssetKey(workspaceId, relativePath), body, {
    httpMetadata: { contentType },
    customMetadata: { relativePath },
  });
}

export async function readPageAsset(
  env: Env,
  workspaceId: string,
  relativePath: string,
): Promise<R2ObjectBody | null> {
  return env.BUCKET.get(pageAssetKey(workspaceId, relativePath));
}

export async function deletePageAssetsForNote(
  env: Env,
  workspaceId: string,
  notePath: string,
): Promise<void> {
  const prefix = pageAssetPrefixForNote(workspaceId, notePath);
  let cursor: string | undefined;
  do {
    const listed = await env.BUCKET.list({ prefix, cursor, limit: 100 });
    if (listed.objects.length > 0) {
      await Promise.all(listed.objects.map((obj) => env.BUCKET.delete(obj.key)));
    }
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

/** Copy page assets when a note's vault path changes, then remove the old prefix. */
export async function movePageAssetsForNote(
  env: Env,
  workspaceId: string,
  oldNotePath: string,
  newNotePath: string,
): Promise<void> {
  const oldPrefix = pageAssetPrefixForNote(workspaceId, oldNotePath);
  const newPrefix = pageAssetPrefixForNote(workspaceId, newNotePath);
  if (oldPrefix === newPrefix) return;
  let cursor: string | undefined;
  do {
    const listed = await env.BUCKET.list({ prefix: oldPrefix, cursor, limit: 100 });
    await Promise.all(
      listed.objects.map(async (obj) => {
        const suffix = obj.key.slice(oldPrefix.length);
        const destKey = newPrefix + suffix;
        const body = await env.BUCKET.get(obj.key);
        if (!body) return;
        await env.BUCKET.put(destKey, body.body, {
          httpMetadata: body.httpMetadata,
          customMetadata: body.customMetadata,
        });
        await env.BUCKET.delete(obj.key);
      }),
    );
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

export async function writeNote(
  env: Env,
  workspaceId: string,
  noteId: string,
  content: string,
): Promise<string> {
  const hash = await contentHash(content);
  await env.BUCKET.put(noteKey(workspaceId, noteId), content, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
    customMetadata: { contentHash: hash },
  });
  return hash;
}

type HistoryIndex = { backupIds: BackupSummary[] };

export async function appendHistory(
  env: Env,
  workspaceId: string,
  noteId: string,
  content: string,
  trigger: "manual" | "auto",
): Promise<StoredBackup> {
  const idKey = historyIndexKey(workspaceId, noteId);
  const index = (await readJson<HistoryIndex>(env.BUCKET, idKey)) ?? { backupIds: [] };
  const backupId = `${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${randomId()}`;
  const createdAt = new Date().toISOString();
  const summary: BackupSummary = { backupId, createdAt, trigger };
  await env.BUCKET.put(historySnapshotKey(workspaceId, noteId, backupId), content, {
    httpMetadata: { contentType: "text/markdown; charset=utf-8" },
  });
  index.backupIds.unshift(summary);
  if (index.backupIds.length > MAX_BACKUPS) {
    const removed = index.backupIds.splice(MAX_BACKUPS);
    for (const r of removed) {
      await env.BUCKET.delete(historySnapshotKey(workspaceId, noteId, r.backupId));
    }
  }
  await writeJson(env.BUCKET, idKey, index);
  return { ...summary, content };
}

export async function listHistory(env: Env, workspaceId: string, noteId: string): Promise<BackupSummary[]> {
  const index = await readJson<HistoryIndex>(env.BUCKET, historyIndexKey(workspaceId, noteId));
  return index?.backupIds ?? [];
}

export async function readHistory(
  env: Env,
  workspaceId: string,
  noteId: string,
  backupId: string,
): Promise<StoredBackup | null> {
  const obj = await env.BUCKET.get(historySnapshotKey(workspaceId, noteId, backupId));
  if (!obj) return null;
  const content = await obj.text();
  const index = await readJson<HistoryIndex>(env.BUCKET, historyIndexKey(workspaceId, noteId));
  const meta = index?.backupIds.find((b) => b.backupId === backupId);
  if (!meta) return null;
  return { ...meta, content };
}
