import { DUMMY_PASSWORD_HASH, hashPassword, randomId, verifyPassword } from "./crypto";
import type { Env } from "./env";
import type { User } from "@shared/types";

export type DirectoryProfile = {
  fullName: string;
  email: string;
  cfAccountId: string | null;
  workerName: string | null;
  workerUrl: string;
};

type UserRow = {
  id: string;
  fullName: string;
  email: string;
  passwordHash: string;
  syncDisabled: number;
};

const USER_SELECT = `SELECT id, full_name as fullName, email, password_hash as passwordHash, sync_disabled as syncDisabled FROM users`;

function toUser(row: Pick<UserRow, "id" | "fullName" | "email" | "syncDisabled">): User {
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    syncDisabled: row.syncDisabled === 1,
  };
}

export async function getUserById(env: Env, userId: string): Promise<User | null> {
  const row = await env.DB.prepare(`${USER_SELECT} WHERE id = ?`).bind(userId).first<UserRow>();
  return row ? toUser(row) : null;
}

export async function ownerExists(env: Env): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM users LIMIT 1").first();
  return !!row;
}

export async function createOwner(
  env: Env,
  input: { fullName: string; email: string; password: string },
): Promise<{ ok: true; user: User } | { ok: false; error: "account_exists" | "email_taken" }> {
  if (await ownerExists(env)) return { ok: false, error: "account_exists" };
  const id = randomId();
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO users (id, full_name, email, password_hash, owner_slot, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
    )
      .bind(id, input.fullName, input.email, passwordHash, now, now)
      .run();
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message.includes("owner_slot") || message.includes("UNIQUE")) return { ok: false, error: "account_exists" };
    throw err;
  }
  await env.DB.prepare("UPDATE workspaces SET user_id = ? WHERE user_id NOT IN (SELECT id FROM users)")
    .bind(id)
    .run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id NOT IN (SELECT id FROM users)").run();
  return { ok: true, user: { id, fullName: input.fullName, email: input.email, syncDisabled: false } };
}

export async function authenticate(
  env: Env,
  email: string,
  password: string,
): Promise<User | null> {
  const row = await env.DB.prepare(`${USER_SELECT} WHERE email = ? COLLATE NOCASE`)
    .bind(email)
    .first<UserRow>();
  const stored = row?.passwordHash ?? DUMMY_PASSWORD_HASH;
  const matches = await verifyPassword(password, stored);
  if (!row || !matches || row.syncDisabled === 1) return null;
  return toUser(row);
}

export async function changeOwnerPassword(
  env: Env,
  userId: string,
  currentPassword: string,
  nextPassword: string,
): Promise<User | null> {
  const row = await env.DB.prepare(`${USER_SELECT} WHERE id = ?`).bind(userId).first<UserRow>();
  if (!row || !(await verifyPassword(currentPassword, row.passwordHash))) return null;
  const passwordHash = await hashPassword(nextPassword);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(passwordHash, now, userId)
    .run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(userId).run();
  return toUser(row);
}

export async function resetOwnerPassword(env: Env, password: string): Promise<User | null> {
  const row = await env.DB.prepare(`${USER_SELECT} LIMIT 1`).first<UserRow>();
  if (!row) return null;
  const passwordHash = await hashPassword(password);
  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(passwordHash, now, row.id)
    .run();
  await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.id).run();
  return toUser(row);
}

/** The access token must be able to read this Dotnote's Cloudflare account. It is not stored. */
export async function proveCloudflareAccount(
  env: Env,
  accessToken: string,
): Promise<"ok" | "unconfigured" | "rejected"> {
  const accountId = env.CF_ACCOUNT_ID?.trim();
  if (!accountId) return "unconfigured";
  let res: Response;
  try {
    res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}`, {
      headers: { authorization: `Bearer ${accessToken}` },
    });
  } catch {
    return "rejected";
  }
  const json = (await res.json().catch(() => null)) as { success?: boolean; result?: { id?: string } } | null;
  if (!res.ok || !json?.success) return "rejected";
  if (json.result?.id && json.result.id !== accountId) return "rejected";
  return "ok";
}
