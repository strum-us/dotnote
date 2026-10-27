import type { Env } from "./env";
import { randomToken } from "./crypto";
import { getManifest, readNote, readPageAsset } from "./storage";
import { titleFromMarkdown } from "@shared/title";
import { isPageAssetPath, markdownDir, pageAssetFolderName } from "@shared/page-assets";

function isAssetPathForNote(notePath: string, relativePath: string): boolean {
  const cleaned = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.includes("..") || !isPageAssetPath(cleaned)) return false;
  const dir = markdownDir(notePath);
  const folder = pageAssetFolderName(notePath);
  const prefix = dir ? `${dir}/${folder}/` : `${folder}/`;
  return cleaned.startsWith(prefix);
}

export type NoteShareRow = {
  token: string;
  userId: string;
  workspaceId: string;
  noteId: string;
  createdAt: string;
  revokedAt: string | null;
};

type ShareRowDb = {
  token: string;
  user_id: string;
  workspace_id: string;
  note_id: string;
  created_at: string;
  revoked_at: string | null;
};

function mapRow(row: ShareRowDb): NoteShareRow {
  return {
    token: row.token,
    userId: row.user_id,
    workspaceId: row.workspace_id,
    noteId: row.note_id,
    createdAt: row.created_at,
    revokedAt: row.revoked_at,
  };
}

export async function getActiveShareForNote(
  env: Env,
  workspaceId: string,
  noteId: string,
): Promise<NoteShareRow | null> {
  const row = await env.DB.prepare(
    `SELECT token, user_id, workspace_id, note_id, created_at, revoked_at
     FROM note_shares
     WHERE workspace_id = ? AND note_id = ? AND revoked_at IS NULL
     ORDER BY created_at DESC
     LIMIT 1`,
  )
    .bind(workspaceId, noteId)
    .first<ShareRowDb>();
  return row ? mapRow(row) : null;
}

export async function getActiveShareByToken(env: Env, token: string): Promise<NoteShareRow | null> {
  const row = await env.DB.prepare(
    `SELECT token, user_id, workspace_id, note_id, created_at, revoked_at
     FROM note_shares
     WHERE token = ? AND revoked_at IS NULL`,
  )
    .bind(token)
    .first<ShareRowDb>();
  return row ? mapRow(row) : null;
}

export async function createOrGetShare(
  env: Env,
  userId: string,
  workspaceId: string,
  noteId: string,
): Promise<NoteShareRow> {
  const existing = await getActiveShareForNote(env, workspaceId, noteId);
  if (existing) return existing;

  const token = randomToken();
  const createdAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO note_shares (token, user_id, workspace_id, note_id, created_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
  )
    .bind(token, userId, workspaceId, noteId, createdAt)
    .run();

  return { token, userId, workspaceId, noteId, createdAt, revokedAt: null };
}

export async function revokeShare(env: Env, workspaceId: string, noteId: string): Promise<boolean> {
  const result = await env.DB.prepare(
    `UPDATE note_shares SET revoked_at = datetime('now')
     WHERE workspace_id = ? AND note_id = ? AND revoked_at IS NULL`,
  )
    .bind(workspaceId, noteId)
    .run();
  return (result.meta.changes ?? 0) > 0;
}

export async function deleteSharesForNote(env: Env, workspaceId: string, noteId: string): Promise<void> {
  await env.DB.prepare("DELETE FROM note_shares WHERE workspace_id = ? AND note_id = ?")
    .bind(workspaceId, noteId)
    .run();
}

export async function loadPublicSharePayload(env: Env, token: string) {
  const share = await getActiveShareByToken(env, token);
  if (!share) return null;

  const manifest = await getManifest(env, share.workspaceId);
  const entry = manifest.entries.find((e) => e.id === share.noteId && e.type === "note");
  if (!entry) return null;

  const markdown = await readNote(env, share.workspaceId, share.noteId);
  if (markdown === null) return null;

  return {
    title: titleFromMarkdown(markdown),
    markdown,
    notePath: entry.path,
    updatedAt: entry.updatedAt ?? share.createdAt,
  };
}

export async function readPublicShareAsset(
  env: Env,
  token: string,
  relativePath: string,
): Promise<{ body: ReadableStream; headers: Headers } | null> {
  const share = await getActiveShareByToken(env, token);
  if (!share) return null;

  const manifest = await getManifest(env, share.workspaceId);
  const entry = manifest.entries.find((e) => e.id === share.noteId && e.type === "note");
  if (!entry) return null;

  if (!isAssetPathForNote(entry.path, relativePath)) return null;

  const obj = await readPageAsset(env, share.workspaceId, relativePath.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!obj) return null;

  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return { body: obj.body!, headers };
}
