import { Hono } from "hono";
import type { Env } from "./env";
import { getUserById } from "./accounts";
import { createSession, type AppVariables } from "./session";

type EntrySampleEnv = Env & {
  ENTRY_SAMPLE_USER_ID?: string;
  ENTRY_SAMPLE_WORKSPACE_ID?: string;
};

export const entrySampleRoutes = new Hono<{ Bindings: EntrySampleEnv; Variables: AppVariables }>();

entrySampleRoutes.post("/enter", async (c) => {
  const userId = c.env.ENTRY_SAMPLE_USER_ID?.trim();
  const workspaceId = c.env.ENTRY_SAMPLE_WORKSPACE_ID?.trim();
  if (!userId || !workspaceId) return c.json({ error: "not_configured" }, 404);

  const user = await getUserById(c.env, userId);
  if (!user) return c.json({ error: "not_configured" }, 404);
  if (!user.syncDisabled) return c.json({ error: "forbidden" }, 403);

  const row = await c.env.DB.prepare("SELECT id FROM workspaces WHERE id = ? AND user_id = ?")
    .bind(workspaceId, userId)
    .first();
  if (!row) return c.json({ error: "not_configured" }, 404);

  await createSession(c, user);
  c.header("Cache-Control", "no-store");
  return c.json({ user, workspaceId });
});
