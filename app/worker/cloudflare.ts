import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { z } from "zod";
import type { Env } from "./env";
import type { AppVariables } from "./session";
import { issueReconnectCode, mintAccessToken, readConnection } from "./cf-grant";
import { putObjectToR2S3, type R2Dest } from "./r2-s3";

const COPY_BATCH_LIMIT = 40;

type UsageCategory = "notes" | "history" | "assets" | "manifests" | "other";

function categorizeKey(key: string): UsageCategory {
  const parts = key.split("/");
  if (parts.length < 3 || parts[0] !== "workspaces") return "other";
  const segment = parts[2];
  if (segment === "manifest.json") return "manifests";
  if (segment === "notes") return "notes";
  if (segment === "history") return "history";
  if (segment === "page-assets") return "assets";
  return "other";
}

function workspaceIdFromKey(key: string): string | null {
  const parts = key.split("/");
  if (parts[0] !== "workspaces" || !parts[1]) return null;
  return parts[1];
}

async function probeLatency(ms: () => Promise<void>): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const start = performance.now();
  try {
    await ms();
    return { ok: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - start),
      error: err instanceof Error ? err.message : "probe_failed",
    };
  }
}

export const cloudflareRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

cloudflareRoutes.get("/status", async (c) => {
  const checkedAt = new Date().toISOString();
  const workerName = c.env.WORKER_NAME ?? "dotnote";
  const r2BucketName = c.env.R2_BUCKET_NAME ?? "dotnote-data";
  const d1Name = c.env.D1_DATABASE_NAME ?? "dotnote-index";
  const accountId = c.env.CF_ACCOUNT_ID ?? "";
  const origin = new URL(c.req.url).origin;
  const envLabel = c.env.DOTNOTE_DEV === "1" ? "development" : "production";

  const [r2Probe, d1Probe, connection] = await Promise.all([
    probeLatency(async () => {
      await c.env.BUCKET.list({ limit: 1 });
    }),
    probeLatency(async () => {
      await c.env.DB.prepare("SELECT 1 as ok").first();
    }),
    readConnection(c.env),
  ]);

  return c.json({
    checkedAt,
    accountId: accountId || null,
    worker: {
      name: workerName,
      url: origin,
      environment: envLabel,
      ok: true,
      latencyMs: 0,
    },
    r2: {
      bucketName: r2BucketName,
      binding: "BUCKET",
      ok: r2Probe.ok,
      latencyMs: r2Probe.latencyMs,
      error: r2Probe.error ?? null,
    },
    d1: {
      databaseName: d1Name,
      binding: "DB",
      ok: d1Probe.ok,
      latencyMs: d1Probe.latencyMs,
      error: d1Probe.error ?? null,
    },
    connection,
    installerOrigin: c.env.INSTALLER_ORIGIN || null,
    links: {
      workerDashboard: accountId
        ? `https://dash.cloudflare.com/${accountId}/workers/services/view/${workerName}/production`
        : "https://dash.cloudflare.com/?to=/:account/workers-and-pages",
      r2BucketDashboard: accountId
        ? `https://dash.cloudflare.com/${accountId}/r2/default/buckets/${r2BucketName}`
        : "https://dash.cloudflare.com/?to=/:account/r2",
      createBucket: accountId
        ? `https://dash.cloudflare.com/${accountId}/r2/new`
        : "https://dash.cloudflare.com/?to=/:account/r2/new",
      r2ApiTokens: accountId
        ? `https://dash.cloudflare.com/${accountId}/r2/api-tokens`
        : "https://dash.cloudflare.com/?to=/:account/r2/api-tokens",
    },
  });
});

cloudflareRoutes.post("/reconnect", async (c) => {
  const origin = c.env.INSTALLER_ORIGIN?.replace(/\/$/, "");
  if (!origin) return c.json({ error: "This instance has no installer address." }, 400);
  let code: string;
  try {
    code = await issueReconnectCode(c.env);
  } catch {
    return c.json({ error: "Apply the latest database migration, then try again." }, 503);
  }
  const connection = await readConnection(c.env);
  const instance = new URL(c.req.url).origin;
  const url = new URL(origin);
  url.searchParams.set("mode", "reconnect");
  url.searchParams.set("instance", instance);
  url.searchParams.set("code", code);
  if (connection.accountId) url.searchParams.set("accountId", connection.accountId);
  return c.json({ url: url.toString() });
});

cloudflareRoutes.post("/connection/check", async (c) => {
  try {
    const minted = await mintAccessToken(c.env);
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${minted.accountId}`, {
      headers: { authorization: `Bearer ${minted.accessToken}` },
    });
    const json = (await res.json()) as {
      success?: boolean;
      errors?: { message: string }[];
      result?: { name?: string };
    };
    if (!json.success) {
      return c.json({ error: json.errors?.[0]?.message || "Cloudflare rejected the stored permission." }, 502);
    }
    return c.json({ ok: true, accountId: minted.accountId, accountName: json.result?.name ?? null });
  } catch (err) {
    const message = err instanceof Error ? err.message : "The stored permission could not be renewed.";
    return c.json({ error: message }, 400);
  }
});

cloudflareRoutes.get("/usage", async (c) => {
  const user = c.get("user");
  const computedAt = new Date().toISOString();

  const { results: workspaces } = await c.env.DB.prepare(
    "SELECT id, name FROM workspaces WHERE user_id = ? ORDER BY created_at",
  )
    .bind(user.id)
    .all<{ id: string; name: string }>();

  const byWorkspace = new Map<
    string,
    { workspaceId: string; name: string; bytes: number; objects: number; byCategory: Record<UsageCategory, number> }
  >();

  const emptyCats = (): Record<UsageCategory, number> => ({
    notes: 0,
    history: 0,
    assets: 0,
    manifests: 0,
    other: 0,
  });

  for (const ws of workspaces ?? []) {
    byWorkspace.set(ws.id, {
      workspaceId: ws.id,
      name: ws.name,
      bytes: 0,
      objects: 0,
      byCategory: emptyCats(),
    });
  }

  let totalBytes = 0;
  let objectCount = 0;
  const totalByCategory = emptyCats();

  for (const ws of workspaces ?? []) {
    const prefix = `workspaces/${ws.id}/`;
    let cursor: string | undefined;
    do {
      const listed = await c.env.BUCKET.list({ prefix, cursor, limit: 1000 });
      for (const obj of listed.objects) {
        const wsId = workspaceIdFromKey(obj.key);
        const row = wsId ? byWorkspace.get(wsId) : undefined;
        const size = obj.size;
        const cat = categorizeKey(obj.key);
        totalBytes += size;
        objectCount += 1;
        totalByCategory[cat] += size;
        if (row) {
          row.bytes += size;
          row.objects += 1;
          row.byCategory[cat] += size;
        }
      }
      cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor);
  }

  return c.json({
    computedAt,
    totalBytes,
    objectCount,
    byCategory: totalByCategory,
    byWorkspace: [...byWorkspace.values()],
    freeTierBytes: 10 * 1024 ** 3,
  });
});

const migrationCursorSchema = z.object({
  workspaceIndex: z.number().int().min(0),
  listCursor: z.string().optional(),
});

const copyBatchSchema = z.object({
  accountId: z.string().min(1).max(64),
  bucketName: z.string().min(1).max(128),
  accessKeyId: z.string().min(1).max(128),
  secretAccessKey: z.string().min(1).max(256),
  cursor: migrationCursorSchema.optional(),
});

cloudflareRoutes.post("/migration/copy-batch", zValidator("json", copyBatchSchema), async (c) => {
  const user = c.get("user");
  const body = c.req.valid("json");
  const dest: R2Dest = {
    accountId: body.accountId.trim(),
    bucketName: body.bucketName.trim(),
    accessKeyId: body.accessKeyId.trim(),
    secretAccessKey: body.secretAccessKey,
  };

  const { results: workspaces } = await c.env.DB.prepare(
    "SELECT id FROM workspaces WHERE user_id = ? ORDER BY created_at",
  )
    .bind(user.id)
    .all<{ id: string }>();

  const workspaceIds = (workspaces ?? []).map((w) => w.id);
  if (workspaceIds.length === 0) {
    return c.json({
      done: true,
      copied: 0,
      bytesCopied: 0,
      cursor: null,
      errors: [] as { key: string; message: string }[],
    });
  }

  let workspaceIndex = body.cursor?.workspaceIndex ?? 0;
  let listCursor = body.cursor?.listCursor;
  let copied = 0;
  let bytesCopied = 0;
  const errors: { key: string; message: string }[] = [];

  while (workspaceIndex < workspaceIds.length && copied < COPY_BATCH_LIMIT) {
    const wsId = workspaceIds[workspaceIndex]!;
    const prefix = `workspaces/${wsId}/`;
    const pageSize = COPY_BATCH_LIMIT - copied;
    const listed = await c.env.BUCKET.list({ prefix, cursor: listCursor, limit: pageSize });

    if (listed.objects.length === 0) {
      workspaceIndex += 1;
      listCursor = undefined;
      continue;
    }

    for (const obj of listed.objects) {
      if (copied >= COPY_BATCH_LIMIT) break;
      const source = await c.env.BUCKET.get(obj.key);
      if (!source) {
        errors.push({ key: obj.key, message: "source_missing" });
        continue;
      }
      const bytes = await source.arrayBuffer();
      const contentType = source.httpMetadata?.contentType;
      const put = await putObjectToR2S3(dest, obj.key, bytes, contentType);
      if (!put.ok) {
        errors.push({ key: obj.key, message: `${put.status}: ${put.message}` });
        continue;
      }
      copied += 1;
      bytesCopied += bytes.byteLength;
    }

    if (copied >= COPY_BATCH_LIMIT) {
      if (listed.truncated) {
        listCursor = listed.cursor;
      }
      break;
    }

    if (listed.truncated) {
      listCursor = listed.cursor;
    } else {
      workspaceIndex += 1;
      listCursor = undefined;
    }
  }

  const done = workspaceIndex >= workspaceIds.length;
  const nextCursor = done ? null : { workspaceIndex, listCursor };

  return c.json({
    done,
    copied,
    bytesCopied,
    cursor: nextCursor,
    errors,
    workspaceCount: workspaceIds.length,
  });
});
