import { mintAccessToken, readConnection } from "../cf-grant";
import type { Env } from "../env";
import type { UpdateAccess } from "./policy";

export async function readUpdateAccess(env: Env): Promise<UpdateAccess> {
  const connection = await readConnection(env);
  return {
    credential: connection.connected ? "grant" : null,
    accountId: connection.accountId,
    scriptName: env.WORKER_NAME?.trim() || null,
    connection,
  };
}

/**
 * A bearer token for the Cloudflare API and the script it may replace. The
 * grant is renewed (and its refresh token rotated) on every call.
 */
export async function cloudflareToken(env: Env): Promise<{ token: string; accountId: string; scriptName: string }> {
  const access = await readUpdateAccess(env);
  if (access.credential !== "grant") {
    throw new Error("This Dotnote has no Cloudflare permission. Reconnect Cloudflare, or repair it from the installer.");
  }
  const scriptName = access.scriptName;
  if (!scriptName) throw new Error("This Dotnote does not know its Worker name.");
  const minted = await mintAccessToken(env);
  return { token: minted.accessToken, accountId: minted.accountId, scriptName };
}
