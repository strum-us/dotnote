import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "./env";
import { contentHash, randomId } from "./crypto";
import {
  authenticate,
  changeOwnerPassword,
  createOwner,
  ownerExists,
  proveCloudflareAccount,
  resetOwnerPassword,
} from "./accounts";
import {
  DIAGNOSTICS_REPORT_ERROR,
  diagnosticsOffer,
  diagnosticsStatus,
  grantAndReport,
  reportDiagnostics,
  withdrawDiagnostics,
} from "./diagnostics";
import {
  appendHistory,
  deleteNoteObject,
  deletePageAssetsForNote,
  deleteWorkspaceBucketData,
  getManifest,
  movePageAssetsForNote,
  listHistory,
  mutateManifest,
  putManifest,
  readHistory,
  readNote,
  readPageAsset,
  writeNote,
  writePageAsset,
} from "./storage";
import {
  isPageAssetPath,
  MAX_PAGE_ASSET_BYTES,
  mimeTypeFromAssetFilename,
  pageAssetMarkdownUrl,
  pageAssetRelativePath,
} from "@shared/page-assets";
import { EMPTY_NOTE, titleFromMarkdown, replaceMarkdownTitle } from "@shared/title";
import {
  addFolderEntry,
  addNoteEntry,
  buildTree,
  emptyManifest,
  moveEntry,
  removeEntry,
  renameEntry,
} from "@shared/manifest";
import {
  createSession,
  destroySession,
  requireUser,
  resolveUser,
  type AppVariables,
} from "./session";
import { cloudflareRoutes } from "./cloudflare";
import { installRoutes } from "./install-routes";
import { entrySampleRoutes } from "./entry-sample";
import { llmRoutes } from "./llm";
import { runScheduledUpdate } from "./update/schedule";
import { updateRoutes } from "./update/update-routes";
import {
  createOrGetShare,
  deleteSharesForNote,
  getActiveShareForNote,
  loadPublicSharePayload,
  readPublicShareAsset,
  revokeShare,
} from "./shares";

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();

app.use(
  "/api/*",
    cors({
    origin: (origin) => origin ?? "*",
    credentials: true,
    allowHeaders: ["Content-Type"],
  }),
);

app.get("/api/health", (c) => c.json({ ok: true, service: "dotnote" }));

function rejectInvalid(result: { success: boolean }, c: Context) {
  if (!result.success) return c.json({ error: "invalid_input" }, 400);
}

const password = z.string().min(8).max(128);
const email = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((value) => value.toLowerCase());
const fullName = z.string().trim().min(1).max(80);

const accountBody = z.object({
  fullName,
  email,
  password,
  diagnosticsConsent: z.boolean().optional().default(false),
});
const loginBody = z.object({ email, password });
const passwordBody = z.object({
  currentPassword: password,
  newPassword: password,
});
const recoverBody = z.object({
  accessToken: z.string().min(10).max(8000),
  password,
});

function scheduleDiagnosticsReport(
  env: Env,
  origin: string,
  userId: string,
  waitUntil: (promise: Promise<unknown>) => void,
) {
  waitUntil(
    reportDiagnostics(env, userId, origin).catch((err: unknown) => {
      const message = err instanceof Error ? err.message : "diagnostics_failed";
      console.error(JSON.stringify({ event: "diagnostics_report_failed", error: message }));
    }),
  );
}

app.get("/api/auth/setup", async (c) => {
  const needsAccount = !(await ownerExists(c.env));
  return c.json({
    needsAccount,
    installerOrigin: c.env.INSTALLER_ORIGIN?.replace(/\/$/, "") || null,
    ...diagnosticsOffer(c.env),
  });
});

function authErrorCode(err: unknown): "password_hasher_failed" | "account_failed" {
  const message = err instanceof Error ? err.message : "";
  console.error(JSON.stringify({ event: "auth_failed", error: message }));
  if (/iteration counts above/i.test(message)) return "password_hasher_failed";
  return "account_failed";
}

app.post("/api/auth/account", zValidator("json", accountBody, rejectInvalid), async (c) => {
  const body = c.req.valid("json");
  try {
    const created = await createOwner(c.env, body);
    if (!created.ok) return c.json({ error: created.error }, 409);
    await createSession(c, created.user);
    scheduleDiagnosticsReport(c.env, new URL(c.req.url).origin, created.user.id, (promise) =>
      c.executionCtx.waitUntil(promise),
    );
    return c.json({ user: created.user });
  } catch (err) {
    return c.json({ error: authErrorCode(err) }, 500);
  }
});

app.post("/api/auth/login", zValidator("json", loginBody, rejectInvalid), async (c) => {
  const body = c.req.valid("json");
  try {
    const user = await authenticate(c.env, body.email, body.password);
    if (!user) return c.json({ error: "invalid_credentials" }, 401);
    await createSession(c, user);
    return c.json({ user });
  } catch (err) {
    return c.json({ error: authErrorCode(err) }, 500);
  }
});

app.post("/api/auth/recover", zValidator("json", recoverBody, rejectInvalid), async (c) => {
  const body = c.req.valid("json");
  const proof = await proveCloudflareAccount(c.env, body.accessToken);
  if (proof === "unconfigured") return c.json({ error: "no_cloudflare_account" }, 400);
  if (proof === "rejected") return c.json({ error: "cf_unproven" }, 403);
  try {
    const user = await resetOwnerPassword(c.env, body.password);
    if (!user) return c.json({ error: "account_missing" }, 404);
    scheduleDiagnosticsReport(c.env, new URL(c.req.url).origin, user.id, (promise) => c.executionCtx.waitUntil(promise));
    return c.json({ ok: true });
  } catch (err) {
    return c.json({ error: authErrorCode(err) }, 500);
  }
});

app.post("/api/auth/logout", async (c) => {
  await destroySession(c);
  return c.json({ ok: true });
});

app.get("/api/auth/me", async (c) => {
  const user = await resolveUser(c);
  if (!user) return c.json({ user: null });
  return c.json({ user });
});

app.get("/api/public/shares/:token", async (c) => {
  const payload = await loadPublicSharePayload(c.env, c.req.param("token"));
  if (!payload) return c.json({ error: "not_found" }, 404);
  return c.json(payload);
});

app.get("/api/public/shares/:token/assets", async (c) => {
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing_path" }, 400);
  const asset = await readPublicShareAsset(c.env, c.req.param("token"), path);
  if (!asset) return c.json({ error: "not_found" }, 404);
  return new Response(asset.body, { headers: asset.headers });
});

app.route("/api/install", installRoutes);
app.route("/api/entry-sample", entrySampleRoutes);

const authed = new Hono<{ Bindings: Env; Variables: AppVariables }>();
authed.use("*", requireUser);
authed.use("*", async (c, next) => {
  const user = c.get("user");
  const method = c.req.method;
  if (user.syncDisabled && !["GET", "HEAD", "OPTIONS"].includes(method)) {
    return c.json({ error: "sync_disabled" }, 403);
  }
  await next();
});

async function createWorkspaceRecord(
  env: Env,
  userId: string,
  name: string,
  options: { id?: string; seed?: boolean } = {},
) {
  const id = options.id ?? randomId();
  const trimmed = name.trim();
  const createdAt = new Date().toISOString();
  await env.DB.prepare("INSERT INTO workspaces (id, user_id, name, created_at) VALUES (?, ?, ?, ?)")
    .bind(id, userId, trimmed, createdAt)
    .run();
  const manifest = emptyManifest();
  if (options.seed !== false) {
    const noteId = randomId();
    const hash = await writeNote(env, id, noteId, EMPTY_NOTE);
    addNoteEntry(manifest, {
      id: noteId,
      parentPath: "",
      name: titleFromMarkdown(EMPTY_NOTE),
      contentHash: hash,
      createdAt,
      updatedAt: createdAt,
    });
  }
  await putManifest(env, id, manifest);
  return { id, name: trimmed, createdAt };
}

authed.get("/workspaces", async (c) => {
  const user = c.get("user");
  const load = () =>
    c.env.DB.prepare(
      "SELECT id, name, created_at as createdAt FROM workspaces WHERE user_id = ? ORDER BY created_at",
    )
      .bind(user.id)
      .all<{ id: string; name: string; createdAt: string }>();
  let { results } = await load();
  if (!results?.length) {
    await createWorkspaceRecord(c.env, user.id, "my-workspace");
    results = (await load()).results;
  }
  return c.json({ workspaces: results ?? [] });
});

authed.post(
  "/workspaces",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(80),
      id: z.string().uuid().optional(),
      seed: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    const { name, id, seed } = c.req.valid("json");
    if (id) {
      const existing = await c.env.DB.prepare(
        "SELECT id, user_id as userId, name, created_at as createdAt FROM workspaces WHERE id = ?",
      )
        .bind(id)
        .first<{ id: string; userId: string; name: string; createdAt: string }>();
      if (existing && existing.userId !== user.id) return c.json({ error: "id_taken" }, 409);
      if (existing) return c.json({ workspace: { id: existing.id, name: existing.name, createdAt: existing.createdAt } });
    }
    const workspace = await createWorkspaceRecord(c.env, user.id, name, { id, seed });
    return c.json({ workspace });
  },
);

authed.patch(
  "/workspaces/:id",
  zValidator("json", z.object({ name: z.string().min(1).max(80) })),
  async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.param("id");
    if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
    const name = c.req.valid("json").name.trim();
    await c.env.DB.prepare("UPDATE workspaces SET name = ? WHERE id = ? AND user_id = ?")
      .bind(name, workspaceId, user.id)
      .run();
    const row = await c.env.DB.prepare(
      "SELECT id, name, created_at as createdAt FROM workspaces WHERE id = ? AND user_id = ?",
    )
      .bind(workspaceId, user.id)
      .first<{ id: string; name: string; createdAt: string }>();
    if (!row) return c.json({ error: "not_found" }, 404);
    return c.json({ workspace: row });
  },
);

authed.delete("/workspaces/:id", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  await c.env.DB.prepare("DELETE FROM note_shares WHERE workspace_id = ?").bind(workspaceId).run();
  await deleteWorkspaceBucketData(c.env, workspaceId);
  await c.env.DB.prepare("DELETE FROM workspaces WHERE id = ? AND user_id = ?").bind(workspaceId, user.id).run();
  return c.json({ ok: true });
});

async function assertWorkspace(env: Env, userId: string, workspaceId: string): Promise<boolean> {
  const row = await env.DB.prepare("SELECT id FROM workspaces WHERE id = ? AND user_id = ?")
    .bind(workspaceId, userId)
    .first();
  return !!row;
}

authed.get("/workspaces/:id/tree", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const manifest = await getManifest(c.env, workspaceId);
  return c.json({ tree: buildTree(manifest.entries), rev: manifest.rev });
});

authed.get("/workspaces/:id/manifest", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const manifest = await getManifest(c.env, workspaceId);
  return c.json({ manifest });
});

authed.post(
  "/workspaces/:id/folders",
  zValidator(
    "json",
    z.object({
      id: z.string().uuid().optional(),
      parentPath: z.string(),
      name: z.string().min(1).max(80),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.param("id");
    if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
    const { id = randomId(), parentPath, name } = c.req.valid("json");
    const now = new Date().toISOString();
    const { manifest, value: entry } = await mutateManifest(c.env, workspaceId, (m) =>
      addFolderEntry(m, { id, parentPath, name, createdAt: now, updatedAt: now }),
    );
    return c.json({ entry, rev: manifest.rev, manifest });
  },
);

type NoteWrite = { content: string; parentPath?: string; baseHash?: string };

/**
 * Write a note's content and its manifest entry. Creates the entry when it is
 * missing and `parentPath` is given, so replayed creates and saves of notes
 * the server lost both converge. The manifest is updated first, so a write
 * that loses a conflict never touches the note body.
 */
async function writeNoteEntry(env: Env, workspaceId: string, noteId: string, input: NoteWrite) {
  const hash = await contentHash(input.content);
  const now = new Date().toISOString();
  const name = titleFromMarkdown(input.content);
  const { manifest, value } = await mutateManifest(env, workspaceId, (m) => {
    const entry = m.entries.find((e) => e.id === noteId && e.type === "note");
    if (!entry) {
      if (input.parentPath === undefined) return { error: "not_found" as const };
      const parentPath = input.parentPath;
      return {
        entry: addNoteEntry(m, {
          id: noteId,
          parentPath,
          name,
          contentHash: hash,
          createdAt: now,
          updatedAt: now,
        }),
      };
    }
    if (input.baseHash && entry.contentHash && input.baseHash !== entry.contentHash && entry.contentHash !== hash) {
      return { error: "conflict" as const, serverHash: entry.contentHash };
    }
    if (entry.contentHash === hash && entry.name === name) return { entry };
    entry.name = name;
    entry.contentHash = hash;
    entry.updatedAt = now;
    m.rev += 1;
    return { entry };
  });
  if ("error" in value) return { ...value, manifest };
  await writeNote(env, workspaceId, noteId, input.content);
  return { entry: value.entry, contentHash: hash, manifest };
}

authed.post(
  "/workspaces/:id/notes",
  zValidator(
    "json",
    z.object({
      id: z.string().uuid().optional(),
      parentPath: z.string(),
      content: z.string().optional(),
      historyTrigger: z.enum(["manual", "auto"]).optional(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.param("id");
    if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
    const { id = randomId(), parentPath, content = EMPTY_NOTE, historyTrigger } = c.req.valid("json");
    const result = await writeNoteEntry(c.env, workspaceId, id, { content, parentPath });
    if ("error" in result) return c.json({ error: result.error }, 409);
    if (historyTrigger) {
      await appendHistory(c.env, workspaceId, id, content, historyTrigger);
    }
    return c.json({ entry: result.entry, content, rev: result.manifest.rev, manifest: result.manifest });
  },
);

authed.put(
  "/workspaces/:id/assets",
  zValidator(
    "json",
    z.object({
      notePath: z.string().min(1),
      filename: z
        .string()
        .min(1)
        .max(200)
        .regex(/^[^/\\]+$/, "invalid_filename"),
      contentBase64: z.string().min(1),
      mimeType: z.string().optional(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.param("id");
    if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
    const { notePath, filename, contentBase64, mimeType } = c.req.valid("json");
    const relativePath = pageAssetRelativePath(notePath, filename);
    const binary = Uint8Array.from(atob(contentBase64), (ch) => ch.charCodeAt(0));
    await writePageAsset(c.env, workspaceId, relativePath, binary.buffer, mimeType);
    return c.json({ relativePath, markdownUrl: pageAssetMarkdownUrl(notePath, filename) });
  },
);

authed.put("/workspaces/:id/assets/raw", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const notePath = c.req.query("notePath") ?? "";
  const filename = c.req.query("filename") ?? "";
  if (
    !notePath ||
    notePath.includes("..") ||
    notePath.includes("\\") ||
    !/^[^/\\]+$/.test(filename) ||
    filename.length > 200
  ) {
    return c.json({ error: "invalid_asset" }, 400);
  }
  const declared = Number(c.req.header("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > MAX_PAGE_ASSET_BYTES) return c.json({ error: "too_large" }, 413);
  const relativePath = pageAssetRelativePath(notePath, filename);
  if (!isPageAssetPath(relativePath)) return c.json({ error: "invalid_asset" }, 400);
  const body = c.req.raw.body;
  if (!body) return c.json({ error: "empty" }, 400);
  const headerType = c.req.header("content-type");
  const mimeType =
    headerType && headerType !== "application/octet-stream" ? headerType : mimeTypeFromAssetFilename(filename);
  await writePageAsset(c.env, workspaceId, relativePath, body, mimeType);
  return c.json({ relativePath, markdownUrl: pageAssetMarkdownUrl(notePath, filename) });
});

authed.get("/workspaces/:id/assets", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const path = c.req.query("path");
  if (!path) return c.json({ error: "missing_path" }, 400);
  const obj = await readPageAsset(c.env, workspaceId, path);
  if (!obj) return c.json({ error: "not_found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
});

authed.get("/workspaces/:id/notes/:noteId", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  const noteId = c.req.param("noteId");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const content = await readNote(c.env, workspaceId, noteId);
  if (content === null) return c.json({ error: "not_found" }, 404);
  const manifest = await getManifest(c.env, workspaceId);
  const entry = manifest.entries.find((e) => e.id === noteId && e.type === "note");
  return c.json({ content, entry, rev: manifest.rev });
});

authed.put(
  "/workspaces/:id/notes/:noteId",
  zValidator(
    "json",
    z.object({
      content: z.string(),
      baseHash: z.string().optional(),
      historyTrigger: z.enum(["manual", "auto"]).optional(),
      parentPath: z.string().optional(),
    }),
  ),
  async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.param("id");
    const noteId = c.req.param("noteId");
    if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
    const { content, baseHash, historyTrigger, parentPath } = c.req.valid("json");
    const result = await writeNoteEntry(c.env, workspaceId, noteId, { content, baseHash, parentPath });
    if ("error" in result) {
      if (result.error === "not_found") return c.json({ error: "not_found" }, 404);
      return c.json({ error: "conflict", serverHash: result.serverHash }, 409);
    }
    if (historyTrigger) {
      await appendHistory(c.env, workspaceId, noteId, content, historyTrigger);
    }
    return c.json({ contentHash: result.contentHash, rev: result.manifest.rev, entry: result.entry });
  },
);

authed.post(
  "/workspaces/:id/entries/:entryId/move",
  zValidator("json", z.object({ parentPath: z.string() })),
  async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.param("id");
    const entryId = c.req.param("entryId");
    if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
    const { parentPath } = c.req.valid("json");
    const before = await getManifest(c.env, workspaceId);
    const prior = before.entries.find((e) => e.id === entryId);
    if (!prior) return c.json({ error: "not_found" }, 404);
    const oldNotePath = prior.type === "note" ? prior.path : null;
    const { manifest, value: entry } = await mutateManifest(c.env, workspaceId, (m) => moveEntry(m, entryId, parentPath));
    if (!entry) return c.json({ error: "not_found" }, 404);
    if (oldNotePath && entry.type === "note" && entry.path !== oldNotePath) {
      await movePageAssetsForNote(c.env, workspaceId, oldNotePath, entry.path);
    }
    return c.json({ entry, rev: manifest.rev, manifest });
  },
);

authed.patch(
  "/workspaces/:id/entries/:entryId",
  zValidator("json", z.object({ name: z.string().min(1).max(120) })),
  async (c) => {
    const user = c.get("user");
    const workspaceId = c.req.param("id");
    const entryId = c.req.param("entryId");
    if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
    const { name } = c.req.valid("json");
    const current = await getManifest(c.env, workspaceId);
    const target = current.entries.find((e) => e.id === entryId);
    if (!target) return c.json({ error: "not_found" }, 404);
    let noteHash: string | undefined;
    if (target.type === "note") {
      const body = (await readNote(c.env, workspaceId, entryId)) ?? EMPTY_NOTE;
      const next = replaceMarkdownTitle(body, name.trim().replace(/\.md$/i, "") || "Untitled");
      noteHash = await writeNote(c.env, workspaceId, entryId, next);
    }
    const { manifest, value: entry } = await mutateManifest(c.env, workspaceId, (m) => {
      const renamed = renameEntry(m, entryId, name);
      if (renamed && noteHash) {
        renamed.contentHash = noteHash;
        renamed.updatedAt = new Date().toISOString();
      }
      return renamed;
    });
    if (!entry) return c.json({ error: "not_found" }, 404);
    return c.json({ entry, rev: manifest.rev, manifest });
  },
);

authed.delete("/workspaces/:id/entries/:entryId", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  const entryId = c.req.param("entryId");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const { manifest, value: removed } = await mutateManifest(c.env, workspaceId, (m) => removeEntry(m, entryId));
  for (const entry of removed) {
    if (entry.type === "note") {
      await deleteSharesForNote(c.env, workspaceId, entry.id);
      await deletePageAssetsForNote(c.env, workspaceId, entry.path);
      await deleteNoteObject(c.env, workspaceId, entry.id);
    }
  }
  return c.json({ removed: removed.length, rev: manifest.rev, manifest });
});

authed.get("/workspaces/:id/notes/:noteId/history", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  const noteId = c.req.param("noteId");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const backups = await listHistory(c.env, workspaceId, noteId);
  return c.json({ backups });
});

authed.get("/workspaces/:id/notes/:noteId/history/:backupId", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  const noteId = c.req.param("noteId");
  const backupId = c.req.param("backupId");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const backup = await readHistory(c.env, workspaceId, noteId, backupId);
  if (!backup) return c.json({ error: "not_found" }, 404);
  return c.json({ backup });
});

authed.get("/workspaces/:id/notes/:noteId/share", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  const noteId = c.req.param("noteId");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const share = await getActiveShareForNote(c.env, workspaceId, noteId);
  if (!share) return c.json({ active: false });
  const origin = new URL(c.req.url).origin;
  return c.json({
    active: true,
    token: share.token,
    url: `${origin}/s/${share.token}`,
    createdAt: share.createdAt,
  });
});

authed.post("/workspaces/:id/notes/:noteId/share", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  const noteId = c.req.param("noteId");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  const manifest = await getManifest(c.env, workspaceId);
  const entry = manifest.entries.find((e) => e.id === noteId && e.type === "note");
  if (!entry) return c.json({ error: "not_found" }, 404);
  const share = await createOrGetShare(c.env, user.id, workspaceId, noteId);
  const origin = new URL(c.req.url).origin;
  return c.json({
    active: true,
    token: share.token,
    url: `${origin}/s/${share.token}`,
    createdAt: share.createdAt,
  });
});

authed.delete("/workspaces/:id/notes/:noteId/share", async (c) => {
  const user = c.get("user");
  const workspaceId = c.req.param("id");
  const noteId = c.req.param("noteId");
  if (!(await assertWorkspace(c.env, user.id, workspaceId))) return c.json({ error: "not_found" }, 404);
  await revokeShare(c.env, workspaceId, noteId);
  return c.json({ active: false });
});

authed.get("/account/diagnostics", async (c) => {
  const origin = new URL(c.req.url).origin;
  let reportError: string | null = null;
  try {
    await reportDiagnostics(c.env, c.get("user").id, origin);
  } catch (err) {
    const message = err instanceof Error ? err.message : "diagnostics_failed";
    console.error(JSON.stringify({ event: "diagnostics_report_failed", error: message }));
    reportError = DIAGNOSTICS_REPORT_ERROR;
  }
  const status = await diagnosticsStatus(c.env, c.get("user").id, origin, reportError);
  if (!status) return c.json({ error: "account_missing" }, 404);
  return c.json(status);
});

authed.patch(
  "/account/diagnostics",
  zValidator("json", z.object({ consent: z.boolean(), unregister: z.boolean().optional().default(false) })),
  async (c) => {
    const user = c.get("user");
    const origin = new URL(c.req.url).origin;
    const body = c.req.valid("json");
    let reportError: string | null = null;
    try {
      if (body.consent) {
        await grantAndReport(c.env, user.id, origin);
      } else {
        await withdrawDiagnostics(c.env, user.id, origin, body.unregister);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "diagnostics_failed";
      console.error(JSON.stringify({ event: "diagnostics_report_failed", error: message }));
      reportError = body.consent
        ? DIAGNOSTICS_REPORT_ERROR
        : "Sending is off, but Dotnote Cloud still has this registration. Try deleting it again.";
    }
    const status = await diagnosticsStatus(c.env, user.id, origin, reportError);
    if (!status) return c.json({ error: "account_missing" }, 404);
    return c.json(status);
  },
);

authed.post("/auth/password", zValidator("json", passwordBody, rejectInvalid), async (c) => {
  const body = c.req.valid("json");
  try {
    const user = await changeOwnerPassword(c.env, c.get("user").id, body.currentPassword, body.newPassword);
    if (!user) return c.json({ error: "password_mismatch" }, 401);
    await createSession(c, user);
    return c.json({ user });
  } catch (err) {
    return c.json({ error: authErrorCode(err) }, 500);
  }
});

authed.route("/cloudflare", cloudflareRoutes);
authed.route("/llm", llmRoutes);
authed.route("/update", updateRoutes);

app.route("/api", authed);

app.all("*", async (c) => {
  return c.env.ASSETS.fetch(c.req.raw);
});

export default {
  fetch: app.fetch,
  /** The update Cron Trigger (update/cron.ts). */
  scheduled(_controller, env, ctx) {
    ctx.waitUntil(
      runScheduledUpdate(env).catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        console.error(JSON.stringify({ event: "scheduled_update_failed", error: message }));
      }),
    );
  },
} satisfies ExportedHandler<Env>;
