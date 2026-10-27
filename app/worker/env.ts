export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  /** Same-account HQ worker (preferred in production). */
  HQ?: Fetcher;
  DOTNOTE_DEV?: string;
  HQ_URL: string;
  /** Bearer token for the HQ directory. Wrangler secret. Absent means the directory is skipped. */
  HQ_DIRECTORY_TOKEN?: string;
  CF_ACCOUNT_ID?: string;
  WORKER_NAME?: string;
  R2_BUCKET_NAME?: string;
  D1_DATABASE_NAME?: string;
  /** Public Cloudflare OAuth client id. The refresh token stays encrypted in D1. */
  CF_OAUTH_CLIENT_ID?: string;
  /** AES-GCM key, standard base64 of 32 bytes. Set by the installer, never returned. */
  CF_GRANT_KEY?: string;
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
