import { contentHash } from "./crypto";
import type { Env } from "./env";

const TOKEN_URL = "https://dash.cloudflare.com/oauth2/token";

export type CloudflareConnection = {
  connected: boolean;
  accountId: string | null;
  scopes: string[];
  updatedAt: string | null;
};

type GrantRow = {
  accountId: string;
  scopes: string;
  refreshCiphertext: string;
  refreshIv: string;
  lockUntil: string | null;
  updatedAt: string;
};

function hex(buf: ArrayBuffer): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function decodeB64(value: string): Uint8Array<ArrayBuffer> {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function encodeB64(bytes: Uint8Array<ArrayBuffer>): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

async function aesKey(env: Env): Promise<CryptoKey> {
  const raw = env.CF_GRANT_KEY;
  if (!raw) throw new Error("This Dotnote has no key to store Cloudflare access.");
  const bytes = decodeB64(raw);
  if (bytes.byteLength !== 32) throw new Error("The Cloudflare grant key on this Dotnote is invalid.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encrypt(env: Env, plaintext: string): Promise<{ ciphertext: string; iv: string }> {
  const key = await aesKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { ciphertext: encodeB64(new Uint8Array(cipher)), iv: encodeB64(iv) };
}

export async function decrypt(env: Env, ciphertext: string, iv: string): Promise<string> {
  const key = await aesKey(env);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decodeB64(iv) },
    key,
    decodeB64(ciphertext),
  );
  return new TextDecoder().decode(plain);
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);
  return hex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export async function readConnection(env: Env): Promise<CloudflareConnection> {
  const empty: CloudflareConnection = { connected: false, accountId: null, scopes: [], updatedAt: null };
  try {
    const row = await env.DB.prepare(
      "SELECT account_id as accountId, scopes, updated_at as updatedAt FROM cf_grant WHERE id = 1",
    ).first<{ accountId: string; scopes: string; updatedAt: string }>();
    if (!row) return empty;
    return {
      connected: true,
      accountId: row.accountId,
      scopes: row.scopes.split(" ").filter(Boolean),
      updatedAt: row.updatedAt,
    };
  } catch {
    return empty;
  }
}

async function readGrant(env: Env): Promise<GrantRow | null> {
  return env.DB.prepare(
    `SELECT account_id as accountId, scopes, refresh_ciphertext as refreshCiphertext,
            refresh_iv as refreshIv, lock_until as lockUntil, updated_at as updatedAt
     FROM cf_grant WHERE id = 1`,
  ).first<GrantRow>();
}

async function writeGrant(env: Env, input: { accountId: string; scopes: string; refreshToken: string }): Promise<void> {
  const sealed = await encrypt(env, input.refreshToken);
  const updatedAt = new Date().toISOString();
  await env.DB.prepare(
    `INSERT INTO cf_grant (id, account_id, scopes, refresh_ciphertext, refresh_iv, lock_until, updated_at)
     VALUES (1, ?, ?, ?, ?, NULL, ?)
     ON CONFLICT(id) DO UPDATE SET
       account_id = excluded.account_id,
       scopes = excluded.scopes,
       refresh_ciphertext = excluded.refresh_ciphertext,
       refresh_iv = excluded.refresh_iv,
       lock_until = NULL,
       updated_at = excluded.updated_at`,
  )
    .bind(input.accountId, input.scopes, sealed.ciphertext, sealed.iv, updatedAt)
    .run();
}

type TokenJson = {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
};

async function exchangeRefresh(clientId: string, refreshToken: string): Promise<TokenJson> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  const json = (await res.json()) as TokenJson;
  if (!res.ok || !json.access_token) {
    throw new Error(json.error_description || json.error || "Cloudflare did not accept the stored permission.");
  }
  return json;
}

export async function acceptRefreshToken(
  env: Env,
  input: { refreshToken: string; accountId: string; scopes: string },
): Promise<void> {
  const clientId = env.CF_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("This Dotnote has no OAuth client id.");
  const existing = await readGrant(env);
  if (existing && existing.accountId !== input.accountId) {
    throw new Error("This Dotnote is already connected to a different Cloudflare account.");
  }
  const minted = await exchangeRefresh(clientId, input.refreshToken);
  await writeGrant(env, {
    accountId: input.accountId,
    scopes: minted.scope || input.scopes,
    refreshToken: minted.refresh_token || input.refreshToken,
  });
}

/** Exchange the stored refresh token for an access token and keep the rotated refresh token. */
export async function mintAccessToken(env: Env): Promise<{ accessToken: string; accountId: string }> {
  const clientId = env.CF_OAUTH_CLIENT_ID;
  if (!clientId) throw new Error("This Dotnote has no OAuth client id.");
  const now = new Date().toISOString();
  const until = new Date(Date.now() + 20_000).toISOString();
  const locked = await env.DB.prepare(
    "UPDATE cf_grant SET lock_until = ? WHERE id = 1 AND (lock_until IS NULL OR lock_until < ?)",
  )
    .bind(until, now)
    .run();
  if (!locked.meta.changes) throw new Error("Cloudflare access is already being renewed.");
  try {
    const row = await readGrant(env);
    if (!row) throw new Error("This Dotnote has no Cloudflare permission yet.");
    const refreshToken = await decrypt(env, row.refreshCiphertext, row.refreshIv);
    const minted = await exchangeRefresh(clientId, refreshToken);
    await writeGrant(env, {
      accountId: row.accountId,
      scopes: minted.scope || row.scopes,
      refreshToken: minted.refresh_token || refreshToken,
    });
    return { accessToken: minted.access_token!, accountId: row.accountId };
  } catch (err) {
    await env.DB.prepare("UPDATE cf_grant SET lock_until = NULL WHERE id = 1").run();
    throw err;
  }
}

/**
 * Whether the current setup code was already used. The marker holds the
 * DOTNOTE_HANDOFF hash it consumed, so an installer update or repair (which
 * puts a new hash) can hand over once more. "1" is the marker from before it
 * named the hash.
 */
export async function handoffConsumed(env: Env): Promise<boolean> {
  try {
    const row = await env.DB.prepare("SELECT value FROM install_state WHERE key = 'handoff_done'").first<{
      value: string;
    }>();
    const value = row?.value;
    if (!value) return false;
    if (value === "1") return true;
    return !!env.DOTNOTE_HANDOFF && safeEqual(value, env.DOTNOTE_HANDOFF);
  } catch {
    return false;
  }
}

export async function markHandoffConsumed(env: Env): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO install_state (key, value) VALUES ('handoff_done', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  )
    .bind(env.DOTNOTE_HANDOFF || "1")
    .run();
}

/** A stored grant this Dotnote can still decrypt with its CF_GRANT_KEY. */
export async function grantReadable(env: Env): Promise<boolean> {
  try {
    const row = await readGrant(env);
    if (!row) return false;
    await decrypt(env, row.refreshCiphertext, row.refreshIv);
    return true;
  } catch {
    return false;
  }
}

export async function reconnectCodeMatches(env: Env, code: string): Promise<boolean> {
  const codeHash = await contentHash(code);
  const row = await env.DB.prepare("SELECT expires_at as expiresAt FROM cf_reconnect WHERE code_hash = ?")
    .bind(codeHash)
    .first<{ expiresAt: string }>();
  if (!row) return false;
  if (Date.parse(row.expiresAt) < Date.now()) {
    await env.DB.prepare("DELETE FROM cf_reconnect WHERE code_hash = ?").bind(codeHash).run();
    return false;
  }
  return true;
}

export async function consumeReconnectCode(env: Env, code: string): Promise<void> {
  const codeHash = await contentHash(code);
  await env.DB.prepare("DELETE FROM cf_reconnect WHERE code_hash = ?").bind(codeHash).run();
}

export async function issueReconnectCode(env: Env): Promise<string> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const code = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const codeHash = await contentHash(code);
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  await env.DB.prepare("DELETE FROM cf_reconnect WHERE expires_at < ?").bind(new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO cf_reconnect (code_hash, expires_at) VALUES (?, ?)").bind(codeHash, expiresAt).run();
  return code;
}
