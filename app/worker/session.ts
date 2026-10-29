import type { Context } from "hono";
import { contentHash, randomToken } from "./crypto";
import type { Env } from "./env";
import type { User } from "@shared/types";

const COOKIE = "dotnote_session";
const MAX_AGE_DAYS = 30;

export type AppVariables = {
  user: User;
};

type SessionContext = Context<{ Bindings: Env; Variables: AppVariables }>;

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function crossSiteOrigin(c: SessionContext): boolean {
  const origin = c.req.header("Origin");
  if (!origin) return false;
  const allowed = (c.env.CROSS_SITE_ORIGINS ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return allowed.includes(origin);
}

function cookieAttrs(c: SessionContext): string {
  if (crossSiteOrigin(c)) return "Secure; SameSite=None; Partitioned";
  const secure = c.env.DOTNOTE_DEV === "1" ? "" : "; Secure";
  return `SameSite=Lax${secure}`;
}

export async function createSession(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  user: User,
): Promise<string> {
  const token = randomToken();
  const expires = new Date(Date.now() + MAX_AGE_DAYS * 864e5).toISOString();
  await c.env.DB.prepare("INSERT INTO sessions (token, user_id, username, expires_at) VALUES (?, ?, ?, ?)")
    .bind(await contentHash(token), user.id, user.email, expires)
    .run();
  c.header(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; ${cookieAttrs(c)}; Max-Age=${MAX_AGE_DAYS * 86400}`,
  );
  if (crossSiteOrigin(c)) c.header("X-Dotnote-Session", token);
  return token;
}

export function clearSessionCookie(c: Context<{ Bindings: Env; Variables: AppVariables }>): void {
  c.header("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; ${cookieAttrs(c)}; Max-Age=0`);
}

export async function destroySession(c: Context<{ Bindings: Env; Variables: AppVariables }>): Promise<void> {
  const token = sessionToken(c);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(await contentHash(token)).run();
  }
  clearSessionCookie(c);
}

function sessionToken(c: SessionContext): string | null {
  const header = c.req.header("Authorization");
  if (header?.startsWith("Bearer ")) {
    const bearer = header.slice("Bearer ".length).trim();
    if (bearer) return bearer;
  }
  return parseCookie(c.req.header("Cookie"), COOKIE);
}

export async function resolveUser(c: Context<{ Bindings: Env; Variables: AppVariables }>): Promise<User | null> {
  const token = sessionToken(c);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id as id, u.full_name as fullName, u.email as email, u.sync_disabled as syncDisabled
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
  )
    .bind(await contentHash(token))
    .first<{ id: string; fullName: string; email: string; syncDisabled: number }>();
  if (!row) return null;
  return {
    id: row.id,
    fullName: row.fullName,
    email: row.email,
    syncDisabled: row.syncDisabled === 1,
  };
}

export async function requireUser(
  c: Context<{ Bindings: Env; Variables: AppVariables }>,
  next: () => Promise<void>,
): Promise<Response | void> {
  const user = await resolveUser(c);
  if (!user) return c.json({ error: "unauthorized" }, 401);
  c.set("user", user);
  await next();
}
