import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import { contentHash } from "./crypto";
import {
  acceptRefreshToken,
  consumeReconnectCode,
  grantReadable,
  handoffConsumed,
  hmacHex,
  markHandoffConsumed,
  reconnectCodeMatches,
  safeEqual,
} from "./cf-grant";
import type { Env } from "./env";

export const installRoutes = new Hono<{ Bindings: Env }>();

installRoutes.post("/prove", zValidator("json", z.object({ nonce: z.string().min(8).max(200) })), async (c) => {
  const secret = c.env.DOTNOTE_HANDOFF;
  if (!secret) return c.json({ error: "not_installing" }, 404);
  const mac = await hmacHex(secret, c.req.valid("json").nonce);
  return c.json({ mac });
});

const handoffBody = z.object({
  code: z.string().min(16).max(200),
  refreshToken: z.string().min(10).max(8000),
  accountId: z.string().min(1).max(64),
  scopes: z.string().min(1).max(4000),
});

installRoutes.post("/handoff", zValidator("json", handoffBody), async (c) => {
  const body = c.req.valid("json");
  const codeHash = await contentHash(body.code);
  const installOk = !!c.env.DOTNOTE_HANDOFF && safeEqual(codeHash, c.env.DOTNOTE_HANDOFF);
  let reconnectOk = false;
  try {
    reconnectOk = await reconnectCodeMatches(c.env, body.code);
  } catch {
    reconnectOk = false;
  }
  if (!installOk && !reconnectOk) return c.json({ error: "This setup code was not accepted." }, 403);
  // A used setup code hands over again only while there is no grant to keep, so an
  // install whose handoff never landed can still finish from the installer.
  if (installOk && !reconnectOk && (await handoffConsumed(c.env)) && (await grantReadable(c.env))) {
    return c.json({ ok: true, already: true });
  }

  try {
    await acceptRefreshToken(c.env, {
      refreshToken: body.refreshToken,
      accountId: body.accountId,
      scopes: body.scopes,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Cloudflare did not accept the permission.";
    return c.json({ error: message }, 400);
  }

  if (reconnectOk) await consumeReconnectCode(c.env, body.code);
  else await markHandoffConsumed(c.env);
  return c.json({ ok: true });
});
