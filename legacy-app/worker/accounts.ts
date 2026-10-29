import {
  DIAGNOSTICS_CONSENT_VERSION,
  asDiagnosticsConsent,
  type DiagnosticsConsent,
} from "@shared/diagnostics";
import { DUMMY_PASSWORD_HASH, hashPassword, randomId, verifyPassword } from "./crypto";
import type { Env } from "./env";
import type { User } from "@shared/types";

export type StoredDiagnostics = {
  consent: DiagnosticsConsent;
  consentVersion: number;
  consentedAt: string | null;
  instanceId: string | null;
  lastReportedAt: string | null;
  reportedFingerprint: string | null;
  email: string;
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
  input: { fullName: string; email: string; password: string; diagnosticsConsent?: boolean },
): Promise<{ ok: true; user: User } | { ok: false; error: "account_exists" | "email_taken" }> {
  if (await ownerExists(env)) return { ok: false, error: "account_exists" };
  const id = randomId();
  const passwordHash = await hashPassword(input.password);
  const now = new Date().toISOString();
  const consent = input.diagnosticsConsent ? "granted" : "undecided";
  const consentedAt = input.diagnosticsConsent ? now : null;
  const consentVersion = input.diagnosticsConsent ? DIAGNOSTICS_CONSENT_VERSION : 0;
  const instanceId = input.diagnosticsConsent ? crypto.randomUUID() : null;
  try {
    await env.DB.prepare(
      `INSERT INTO users (
         id, full_name, email, password_hash, owner_slot, created_at, updated_at,
         diagnostics_consent, diagnostics_consented_at, diagnostics_consent_version, diagnostics_instance_id
       )
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        id,
        input.fullName,
        input.email,
        passwordHash,
        now,
        now,
        consent,
        consentedAt,
        consentVersion,
        instanceId,
      )
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

const DIAGNOSTICS_SELECT = `SELECT diagnostics_consent as consent, diagnostics_consent_version as consentVersion,
  diagnostics_consented_at as consentedAt, diagnostics_instance_id as instanceId,
  diagnostics_last_reported_at as lastReportedAt, diagnostics_reported_fingerprint as reportedFingerprint,
  email FROM users`;

type DiagnosticsRow = {
  consent: string;
  consentVersion: number;
  consentedAt: string | null;
  instanceId: string | null;
  lastReportedAt: string | null;
  reportedFingerprint: string | null;
  email: string;
};

function toStored(row: DiagnosticsRow): StoredDiagnostics {
  return {
    consent: asDiagnosticsConsent(row.consent),
    consentVersion: row.consentVersion,
    consentedAt: row.consentedAt,
    instanceId: row.instanceId,
    lastReportedAt: row.lastReportedAt,
    reportedFingerprint: row.reportedFingerprint,
    email: row.email,
  };
}

export async function readDiagnostics(env: Env, userId: string): Promise<StoredDiagnostics | null> {
  const row = await env.DB.prepare(`${DIAGNOSTICS_SELECT} WHERE id = ?`).bind(userId).first<DiagnosticsRow>();
  return row ? toStored(row) : null;
}

export async function grantDiagnosticsConsent(env: Env, userId: string): Promise<StoredDiagnostics | null> {
  const current = await readDiagnostics(env, userId);
  if (!current) return null;
  const now = new Date().toISOString();
  const instanceId = current.instanceId ?? crypto.randomUUID();
  await env.DB.prepare(
    `UPDATE users SET diagnostics_consent = 'granted', diagnostics_consented_at = ?, diagnostics_consent_version = ?,
       diagnostics_instance_id = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(now, DIAGNOSTICS_CONSENT_VERSION, instanceId, now, userId)
    .run();
  return readDiagnostics(env, userId);
}

export async function denyDiagnosticsConsent(env: Env, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE users SET diagnostics_consent = 'denied', diagnostics_consent_version = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(DIAGNOSTICS_CONSENT_VERSION, now, userId)
    .run();
}

/** Forget the local registration id after Dotnote Cloud has deleted it, or when there is nothing to delete. */
export async function clearDiagnosticsRegistration(env: Env, userId: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE users SET diagnostics_consent = 'denied', diagnostics_consent_version = ?, diagnostics_instance_id = NULL,
       diagnostics_last_reported_at = NULL, diagnostics_reported_fingerprint = NULL, updated_at = ? WHERE id = ?`,
  )
    .bind(DIAGNOSTICS_CONSENT_VERSION, now, userId)
    .run();
}

export async function markDiagnosticsReported(env: Env, userId: string, fingerprint: string): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    `UPDATE users SET diagnostics_last_reported_at = ?, diagnostics_reported_fingerprint = ?, updated_at = ? WHERE id = ?`,
  )
    .bind(now, fingerprint, now, userId)
    .run();
}
