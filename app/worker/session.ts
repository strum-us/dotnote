import type { Context } from "hono";
import { contentHash, randomToken } from "./crypto";
import type { Env } from "./env";
import type { User } from "@shared/types";

const COOKIE = "dotnote_session";
const MAX_AGE_DAYS = 30;

export type AppVariables = {
  user: User;
};

function parseCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
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
  const secure = c.env.DOTNOTE_DEV === "1" ? "" : "; Secure";
  c.header(
    "Set-Cookie",
    `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_DAYS * 86400}${secure}`,
  );
  return token;
}

export function clearSessionCookie(c: Context<{ Bindings: Env; Variables: AppVariables }>): void {
  c.header("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

export async function destroySession(c: Context<{ Bindings: Env; Variables: AppVariables }>): Promise<void> {
  const token = parseCookie(c.req.header("Cookie"), COOKIE);
  if (token) {
    await c.env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(await contentHash(token)).run();
  }
  clearSessionCookie(c);
}

export async function resolveUser(c: Context<{ Bindings: Env; Variables: AppVariables }>): Promise<User | null> {
  const token = parseCookie(c.req.header("Cookie"), COOKIE);
  if (!token) return null;
  const row = await c.env.DB.prepare(
    `SELECT u.id as id, u.full_name as fullName, u.email as email
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND datetime(s.expires_at) > datetime('now')`,
  )
    .bind(await contentHash(token))
    .first<User>();
  return row;
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
