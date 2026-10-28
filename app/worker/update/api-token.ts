import type { Env } from "../env";
import { readUpdateAccess, TOKEN_ACCOUNT_KEY, TOKEN_WORKER_KEY } from "./access";
import {
  CfApiError,
  deleteSecret,
  listAccounts,
  putSecret,
  scriptSettings,
  type ScriptBinding,
  type ScriptSettings,
} from "./cf-deploy";
import { deleteMeta, ensureUpdateTables, setMeta } from "./schema";

/**
 * A Dotnote deployed with wrangler has no installer grant. The owner can give
 * it a Cloudflare API token (Workers Scripts: Edit) once instead: the token
 * stores itself on this Worker as the CF_API_TOKEN secret, and this Worker
 * keeps no other copy. Cloudflare deploys the Worker again to add the secret,
 * so requests a few seconds later see it; this one never does.
 */

export type TokenErrorCode =
  | "token_rejected"
  | "token_forbidden"
  | "need_worker"
  | "need_account"
  | "worker_not_found"
  | "not_this_worker";

export class TokenRejected extends Error {
  constructor(
    readonly code: TokenErrorCode,
    message: string,
  ) {
    super(message);
  }
}

const SECRET = "CF_API_TOKEN";

function refused(err: unknown): boolean {
  return err instanceof CfApiError && (err.status === 401 || err.status === 403);
}

function missing(err: unknown): boolean {
  return err instanceof CfApiError && (err.status === 404 || err.code === 10007);
}

/** `<worker>.<subdomain>.workers.dev` names its Worker. Other hosts do not. */
function workersDevName(host: string): string | null {
  const labels = host.toLowerCase().split(":")[0]!.split(".");
  return labels.length === 4 && labels[2] === "workers" && labels[3] === "dev" ? labels[0]! : null;
}

/**
 * The script answers for the same bindings and vars this request runs with.
 * Settings carry plain-text vars with their values, so another Dotnote in the
 * account (other WORKER_NAME, other bucket) does not match.
 */
function sameWorker(env: Env, settings: ScriptSettings, scriptName: string, host: string): boolean {
  const bindings = settings.bindings ?? [];
  const byName = new Map<string, ScriptBinding>(bindings.map((binding) => [binding.name, binding]));
  if (byName.get("DB")?.type !== "d1" || byName.get("BUCKET")?.type !== "r2_bucket") return false;
  const bucket = byName.get("BUCKET")?.bucket_name;
  if (env.R2_BUCKET_NAME && typeof bucket === "string" && bucket !== env.R2_BUCKET_NAME) return false;
  const vars = env as unknown as Record<string, unknown>;
  for (const binding of bindings) {
    if (binding.type !== "plain_text" || typeof binding.text !== "string") continue;
    const local = vars[binding.name];
    if (typeof local === "string" && local !== binding.text) return false;
  }
  const devName = workersDevName(host);
  return !devName || devName === scriptName;
}

async function accountsToTry(token: string, accountId: string | null): Promise<string[]> {
  if (accountId) return [accountId];
  try {
    return (await listAccounts(token)).map((account) => account.id);
  } catch (err) {
    // A malformed token is a 400 ("Invalid request headers"), a revoked one a 401 or 403.
    if (refused(err) || (err instanceof CfApiError && err.status === 400)) {
      throw new TokenRejected("token_rejected", "Cloudflare did not accept this token.");
    }
    throw err;
  }
}

/** Check the token can open this very Worker, then store it there. */
export async function storeApiToken(
  env: Env,
  input: { token: string; accountId?: string; workerName?: string; host: string },
): Promise<{ accountId: string; workerName: string }> {
  const token = input.token.trim();
  const workerName = input.workerName?.trim() || env.WORKER_NAME?.trim() || workersDevName(input.host);
  if (!workerName) {
    throw new TokenRejected("need_worker", "Enter the name of this Worker as Cloudflare shows it.");
  }
  const candidates = await accountsToTry(token, input.accountId?.trim() || env.CF_ACCOUNT_ID?.trim() || null);
  if (candidates.length === 0) throw new TokenRejected("token_rejected", "This token cannot open any Cloudflare account.");

  const matches: { accountId: string; settings: ScriptSettings }[] = [];
  let forbidden = false;
  for (const accountId of candidates.slice(0, 20)) {
    try {
      matches.push({ accountId, settings: await scriptSettings(token, accountId, workerName) });
    } catch (err) {
      if (refused(err)) forbidden = true;
      else if (!missing(err)) throw err;
    }
  }
  if (matches.length === 0) {
    if (forbidden) {
      throw new TokenRejected("token_forbidden", "This token cannot read Workers. Give it Workers Scripts: Edit.");
    }
    throw new TokenRejected(
      "worker_not_found",
      `No Worker named ${workerName} in the accounts this token can open. Check the Worker name and account ID.`,
    );
  }
  if (matches.length > 1) {
    throw new TokenRejected("need_account", `More than one account has a Worker named ${workerName}. Enter the account ID.`);
  }
  const [match] = matches;
  if (!sameWorker(env, match!.settings, workerName, input.host)) {
    throw new TokenRejected(
      "not_this_worker",
      `The Worker ${workerName} in that account is not this Dotnote. Check the Worker name.`,
    );
  }

  await ensureUpdateTables(env);
  await setMeta(env, TOKEN_ACCOUNT_KEY, match!.accountId);
  await setMeta(env, TOKEN_WORKER_KEY, workerName);
  try {
    await putSecret(token, match!.accountId, workerName, SECRET, token);
  } catch (err) {
    await deleteMeta(env, TOKEN_ACCOUNT_KEY);
    await deleteMeta(env, TOKEN_WORKER_KEY);
    if (refused(err)) {
      throw new TokenRejected("token_forbidden", "This token can read the Worker but not change it. Give it Workers Scripts: Edit.");
    }
    throw err;
  }
  return { accountId: match!.accountId, workerName };
}

/** The token removes itself; Cloudflare deploys the Worker again without it. */
export async function removeApiToken(env: Env): Promise<void> {
  await ensureUpdateTables(env);
  const access = await readUpdateAccess(env);
  if (access.credential !== "token") return;
  if (access.accountId && access.scriptName) {
    try {
      await deleteSecret(env.CF_API_TOKEN!.trim(), access.accountId, access.scriptName, SECRET);
    } catch (err) {
      if (!missing(err)) throw err;
    }
  }
  await deleteMeta(env, TOKEN_ACCOUNT_KEY);
  await deleteMeta(env, TOKEN_WORKER_KEY);
}
