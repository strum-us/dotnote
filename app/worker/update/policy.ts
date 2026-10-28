import type { UpdateBlockedReason } from "@shared/types";
import type { CloudflareConnection } from "../cf-grant";
import type { Env } from "../env";
import type { ReleaseManifest } from "./release-client";

/**
 * Who may update and when, without I/O (access.ts reads the inputs). Type
 * imports only, so app/test can load this file directly.
 */

/** Enough to read the script's settings, upload files, and replace the script. */
export const REQUIRED_SCOPES = ["workers-scripts.read", "workers-scripts.write"];

/**
 * How this Dotnote reaches the Cloudflare API to replace itself: the OAuth
 * grant the installer handed over, or an API token the owner stored as the
 * CF_API_TOKEN secret. A stored token wins: the owner added it later, usually
 * because there is no grant or it stopped working.
 */
export type UpdateAccess = {
  credential: "grant" | "token" | null;
  accountId: string | null;
  scriptName: string | null;
  connection: CloudflareConnection;
};

type PolicyEnv = Pick<Env, "DOTNOTE_DEV" | "INSTALLER_ORIGIN" | "WORKER_NAME" | "CF_OAUTH_CLIENT_ID" | "CF_GRANT_KEY" | "CF_ACCOUNT_ID">;

export function blockedReason(env: PolicyEnv, access: UpdateAccess): UpdateBlockedReason | null {
  if (env.DOTNOTE_DEV === "1") return "development";
  if (!env.INSTALLER_ORIGIN?.trim()) return "no_installer";
  if (access.credential === "token") return access.accountId && access.scriptName ? null : "unconfigured";
  if (!env.WORKER_NAME?.trim() || !env.CF_OAUTH_CLIENT_ID || !env.CF_GRANT_KEY) return "unconfigured";
  if (!access.connection.connected) return "not_connected";
  if (!REQUIRED_SCOPES.every((scope) => access.connection.scopes.includes(scope))) return "missing_scopes";
  return null;
}

/** Stable 0–99 bucket per instance, so a staged rollout reaches the same instances as it widens. */
export function rolloutBucket(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0) % 100;
}

/** Outside a staged rollout until its percentage reaches this instance's bucket. */
export function rolloutHeld(
  env: PolicyEnv,
  access: UpdateAccess,
  release: Pick<ReleaseManifest, "rolloutPercent">,
  host: string,
): boolean {
  if (release.rolloutPercent >= 100) return false;
  const key = `${access.accountId ?? env.CF_ACCOUNT_ID ?? ""}:${access.scriptName || env.WORKER_NAME?.trim() || host}`;
  return rolloutBucket(key) >= release.rolloutPercent;
}

export type AutomaticSkip =
  | "off"
  | "blocked"
  | "up_to_date"
  | "needs_owner"
  | "rollout_held"
  | "tried_before";

/**
 * Why a cron run leaves the latest release alone, or null to start it. Only
 * releases that need nothing from the owner start on their own, and a release
 * whose update failed, was dismissed, or was rolled back is left to the owner.
 */
export function automaticSkip(input: {
  enabled: boolean;
  blocked: boolean;
  newer: boolean;
  release: Pick<ReleaseManifest, "autoUpdate">;
  held: boolean;
  triedBefore: boolean;
}): AutomaticSkip | null {
  if (!input.enabled) return "off";
  if (input.blocked) return "blocked";
  if (!input.newer) return "up_to_date";
  if (!input.release.autoUpdate) return "needs_owner";
  if (input.held) return "rollout_held";
  if (input.triedBefore) return "tried_before";
  return null;
}
