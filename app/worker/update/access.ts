import { mintAccessToken, readConnection } from "../cf-grant";
import type { Env } from "../env";
import type { UpdateAccess } from "./policy";
import { getMeta } from "./schema";

/** app_meta keys written when the owner stores an API token (api-token.ts). */
export const TOKEN_ACCOUNT_KEY = "cf_token_account_id";
export const TOKEN_WORKER_KEY = "cf_token_worker_name";

export async function readUpdateAccess(env: Env): Promise<UpdateAccess> {
  const connection = await readConnection(env);
  if (env.CF_API_TOKEN?.trim()) {
    const [accountId, workerName] = await Promise.all([getMeta(env, TOKEN_ACCOUNT_KEY), getMeta(env, TOKEN_WORKER_KEY)]);
    return {
      credential: "token",
      accountId: accountId || env.CF_ACCOUNT_ID?.trim() || null,
      scriptName: workerName || env.WORKER_NAME?.trim() || null,
      connection,
    };
  }
  return {
    credential: connection.connected ? "grant" : null,
    accountId: connection.accountId,
    scriptName: env.WORKER_NAME?.trim() || null,
    connection,
  };
}

/**
 * A bearer token for the Cloudflare API and the script it may replace. The
 * grant is renewed (and its refresh token rotated) on every call; a stored
 * API token is used as it is.
 */
export async function cloudflareToken(env: Env): Promise<{ token: string; accountId: string; scriptName: string }> {
  const access = await readUpdateAccess(env);
  if (access.credential === "token") {
    if (!access.accountId || !access.scriptName) {
      throw new Error("This Dotnote has an API token but does not know which Cloudflare Worker it is.");
    }
    return { token: env.CF_API_TOKEN!.trim(), accountId: access.accountId, scriptName: access.scriptName };
  }
  const scriptName = access.scriptName;
  if (!scriptName) throw new Error("This Dotnote does not know its Worker name.");
  const minted = await mintAccessToken(env);
  return { token: minted.accessToken, accountId: minted.accountId, scriptName };
}
