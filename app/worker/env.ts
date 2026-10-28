export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  DOTNOTE_DEV?: string;
  /**
   * "true" or "1" lets this deployment register with Dotnote Cloud after the owner consents.
   * Anything else, including unset, sends nothing.
   */
  DOTNOTE_DIAGNOSTICS_ENABLED?: string;
  /** Registration endpoint. Ignored unless diagnostics are enabled and a token is set. */
  DOTNOTE_DIAGNOSTICS_URL?: string;
  /** Bearer token. Wrangler secret. Absent means reporting is skipped. */
  DOTNOTE_DIAGNOSTICS_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  WORKER_NAME?: string;
  R2_BUCKET_NAME?: string;
  D1_DATABASE_NAME?: string;
  /** Public Cloudflare OAuth client id. The refresh token stays encrypted in D1. */
  CF_OAUTH_CLIENT_ID?: string;
  /** AES-GCM key, standard base64 of 32 bytes. Set by the installer, never returned. */
  CF_GRANT_KEY?: string;
  /**
   * Cloudflare API token (Workers Scripts: Edit) for a Dotnote without an installer grant.
   * Settings › Cloudflare stores it with the token itself; this Worker keeps no other copy.
   * Wrangler users may set it with `wrangler secret put CF_API_TOKEN`.
   */
  CF_API_TOKEN?: string;
  /** sha256 hex of the one-time install code. Compared, never useful as a Cloudflare token. */
  DOTNOTE_HANDOFF?: string;
  /** Origin of the deploy page, used to send the user back to reconnect and to fetch releases. */
  INSTALLER_ORIGIN?: string;
  /**
   * Release version, bound by the installer and the self-updater so the dashboard shows it.
   * Code trusts BUILD_VERSION (worker/update/version.ts) instead, which cannot go stale.
   */
  APP_VERSION?: string;
};
