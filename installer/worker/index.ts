import { Hono } from "hono";
import { getAccount, listAccounts, listZones, workersSubdomain } from "./cf-api";
import { assertInstallMode, classifyResources, type InstallMode } from "./resource-check";
import { randomKey, safeEqual, sha256Hex } from "./crypto";
import type { Env } from "./env";
import {
  deleteInstallation,
  getInstallation,
  insertInstallation,
  listInstallations,
  rekeyInstallation,
  saveInstallation,
  type Installation,
} from "./install-store";
import { loadRelease } from "./release";
import { advance, removeInstallationResources, replaceHandoff, STEPS } from "./steps";

const app = new Hono<{ Bindings: Env }>();

function fail(message: string, status: 400 | 401 | 403 | 404 | 409 | 503 = 400) {
  return { body: { error: { code: "error", message } }, status };
}

function bearer(request: Request): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Expected a JSON object.");
  return parsed as Record<string, unknown>;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function validName(name: string): boolean {
  return /^[a-z][a-z0-9-]{0,40}$/.test(name) && !name.endsWith("-");
}

async function configResponse(env: Env): Promise<Response> {
  let releaseVersion: string | null = null;
  try {
    releaseVersion = (await loadRelease(env)).version;
  } catch {
    releaseVersion = null;
  }
  return Response.json({
    clientId: env.OAUTH_CLIENT_ID?.trim() || null,
    scopes: (env.OAUTH_SCOPES ?? "").split(/\s+/).filter(Boolean),
    releaseVersion,
  });
}

app.all("/api/*", async (c) => {
  if (new URL(c.req.url).pathname === "/api/config") return configResponse(c.env);
  const token = bearer(c.req.raw);
  if (!token) return c.json({ error: { code: "unauthorized", message: "Connect Cloudflare first." } }, 401);
  let body: Record<string, unknown> = {};
  if (c.req.method !== "GET") {
    try {
      body = await readJson(c.req.raw);
    } catch {
      return c.json({ error: { code: "bad_request", message: "The request body was not JSON." } }, 400);
    }
  }
  try {
    return await handle(c.env, token, new URL(c.req.url), body);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The installer could not finish that request.";
    return c.json({ error: { code: "error", message } }, 400);
  }
});

async function handle(env: Env, token: string, url: URL, body: Record<string, unknown>): Promise<Response> {
  const path = url.pathname;
  if (path === "/api/accounts") {
    const accounts = await listAccounts(token);
    return Response.json({ accounts });
  }
  if (path === "/api/account") {
    const accountId = str(body.accountId);
    const account = await getAccount(token, accountId);
    const workersDevSubdomain = await workersSubdomain(token, account.id);
    return Response.json({ id: account.id, name: account.name, workersDevSubdomain });
  }
  if (path === "/api/zones") {
    const accountId = str(body.accountId);
    await getAccount(token, accountId);
    const zones = await listZones(token, accountId);
    return Response.json({ zones });
  }
  if (path === "/api/check") {
    return Response.json(await checkNames(token, body));
  }
  if (path === "/api/installations/find") {
    const accountId = str(body.accountId);
    await getAccount(token, accountId);
    const rows = await listInstallations(env, accountId);
    return Response.json({
      installations: rows.map((row) => ({
        id: row.id,
        workerName: row.workerName,
        address: row.address,
        status: row.status,
        message: row.message,
        stepIndex: row.stepIndex,
        stepTotal: STEPS.length,
        createdAt: row.createdAt,
      })),
    });
  }
  if (path === "/api/installations") {
    return createInstallation(env, token, body);
  }

  const stepMatch = /^\/api\/installations\/([^/]+)\/(step|cleanup|complete|resume)$/.exec(path);
  if (!stepMatch) return Response.json({ error: { code: "not_found", message: "Unknown request." } }, { status: 404 });
  const row = await getInstallation(env, stepMatch[1]);
  if (!row) return Response.json({ error: { code: "not_found", message: "That installation is gone." } }, { status: 404 });
  await getAccount(token, row.accountId);
  const action = stepMatch[2];
  if (action === "cleanup") return cleanup(env, token, row);
  // Like cleanup, resuming needs only Cloudflare access to the account: the
  // browser that started the install may be gone, and its key with it.
  if (action === "resume") return resumeHere(env, token, row, body);
  const key = str(body.key);
  if (!key || !safeEqual(await sha256Hex(key), row.keyHash)) {
    return Response.json({ error: { code: "forbidden", message: "This browser cannot continue that installation." } }, { status: 403 });
  }
  if (action === "complete") {
    if (row.status !== "ready") {
      return Response.json({ error: { code: "conflict", message: "Dotnote is not ready yet." } }, { status: 409 });
    }
    await deleteInstallation(env, row.id);
    return Response.json({ ok: true });
  }
  const view = await advance(env, token, row, url.origin);
  await saveInstallation(env, row);
  return Response.json(view);
}

async function checkNames(token: string, body: Record<string, unknown>): Promise<unknown> {
  const accountId = str(body.accountId);
  const workerName = str(body.workerName);
  await getAccount(token, accountId);
  if (!validName(workerName)) {
    return {
      worker: "invalid",
      database: "invalid",
      bucket: "invalid",
      hostname: null,
      suggestedMode: "blocked",
      blockReason: "Use a short lowercase name.",
      installedVersion: null,
      d1Id: null,
    };
  }
  return classifyResources(
    token,
    accountId,
    workerName,
    str(body.hostname),
    str(body.zoneId),
    str(body.zoneName),
  );
}

function parseMode(value: unknown): InstallMode {
  const mode = str(value);
  if (mode === "update" || mode === "repair" || mode === "wipe") return mode;
  return "fresh";
}

async function createInstallation(env: Env, token: string, body: Record<string, unknown>): Promise<Response> {
  if (!env.OAUTH_CLIENT_ID?.trim()) {
    const error = fail("The OAuth client is not configured on this installer yet.", 503);
    return Response.json(error.body, { status: error.status });
  }
  const accountId = str(body.accountId);
  const workerName = str(body.workerName);
  const handoffHash = str(body.handoffHash).toLowerCase();
  const hostname = str(body.hostname) || null;
  const zoneId = str(body.zoneId) || null;
  const zoneName = str(body.zoneName) || null;
  if (!validName(workerName)) {
    return Response.json({ error: { code: "bad_request", message: "Use a short lowercase name." } }, { status: 400 });
  }
  if (!/^[a-f0-9]{64}$/.test(handoffHash)) {
    return Response.json({ error: { code: "bad_request", message: "The setup key was not accepted." } }, { status: 400 });
  }
  const mode = parseMode(body.mode);
  if (mode === "wipe") {
    if (body.confirmWipe !== true) {
      return Response.json(
        { error: { code: "bad_request", message: "Confirm that you want to delete Dotnote data." } },
        { status: 400 },
      );
    }
    if (str(body.workerNameConfirm) !== workerName) {
      return Response.json(
        { error: { code: "bad_request", message: "Type the Worker name exactly to confirm data deletion." } },
        { status: 400 },
      );
    }
  }

  const account = await getAccount(token, accountId);
  const release = await loadRelease(env);
  let address: string;
  if (hostname) {
    if (!zoneId || !zoneName || hostname === zoneName || !hostname.endsWith(`.${zoneName}`)) {
      return Response.json(
        { error: { code: "bad_request", message: "Choose a name on a domain this account already has." } },
        { status: 400 },
      );
    }
    address = `https://${hostname}`;
  } else {
    const subdomain = await workersSubdomain(token, account.id);
    if (!subdomain) {
      return Response.json(
        {
          error: {
            code: "bad_request",
            message:
              "This account has no workers.dev subdomain yet. Open Workers & Pages in the Cloudflare dashboard once, then check again.",
          },
        },
        { status: 400 },
      );
    }
    address = `https://${workerName}.${subdomain}.workers.dev`;
  }

  const check = await assertInstallMode(
    token,
    account.id,
    workerName,
    hostname ?? "",
    zoneId ?? "",
    zoneName ?? "",
    mode,
  );

  const now = new Date().toISOString();
  const key = randomKey();
  const row: Installation = {
    id: crypto.randomUUID(),
    keyHash: await sha256Hex(key),
    accountId: account.id,
    accountName: account.name,
    workerName,
    hostname,
    zoneId: hostname ? zoneId : null,
    zoneName: hostname ? zoneName : null,
    address,
    handoffHash,
    releaseVersion: release.version,
    mode,
    stepIndex: 0,
    status: "running",
    message: null,
    state: {
      installedVersion: check.installedVersion ?? undefined,
      ...(mode === "update" || mode === "repair"
        ? {
            d1Id: check.d1Id ?? undefined,
            ...(check.d1Id ? { d1Adopted: true } : {}),
          }
        : {}),
    },
    createdAt: now,
    updatedAt: now,
  };
  await insertInstallation(env, row);
  return Response.json({
    installationId: row.id,
    key,
    address: row.address,
    releaseVersion: row.releaseVersion,
  });
}

/**
 * Continue an installation in this browser. The old browser key and setup code
 * stop working; an install that already reached its handoff gets the new code
 * on the Worker, so this browser can hand over the Cloudflare permission.
 */
async function resumeHere(env: Env, token: string, row: Installation, body: Record<string, unknown>): Promise<Response> {
  const handoffHash = str(body.handoffHash).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(handoffHash)) {
    return Response.json({ error: { code: "bad_request", message: "The setup key was not accepted." } }, { status: 400 });
  }
  const key = randomKey();
  row.keyHash = await sha256Hex(key);
  await replaceHandoff(token, row, handoffHash);
  await rekeyInstallation(env, row);
  return Response.json({
    installationId: row.id,
    key,
    address: row.address,
    releaseVersion: row.releaseVersion,
  });
}

async function cleanup(env: Env, token: string, row: Installation): Promise<Response> {
  const leftover = await removeInstallationResources(token, row);
  if (leftover) {
    row.status = "failed";
    row.message = leftover;
    await saveInstallation(env, row);
    return Response.json(
      {
        status: "failed",
        message: leftover,
        address: row.address,
        step: { id: "cleanup", label: "Remove", index: row.stepIndex, total: STEPS.length },
      },
      { status: 409 },
    );
  }
  await deleteInstallation(env, row.id);
  return Response.json({ status: "removed", message: null, address: row.address });
}

// Running Dotnotes fetch releases from here to update themselves. A missing file
// must be a 404, not the SPA's index.html.
app.get("/release/*", async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  const type = res.headers.get("content-type") ?? "";
  if (res.ok && type.startsWith("text/html")) {
    return c.json({ error: { code: "not_found", message: "That release file does not exist." } }, 404);
  }
  return res;
});

app.all("*", async (c) => c.env.ASSETS.fetch(c.req.raw));

export default app;
