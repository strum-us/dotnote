export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  OAUTH_CLIENT_ID: string;
  /** Where an opted-in Dotnote registers. Empty or unset skips the diagnostics bindings. */
  DOTNOTE_DIAGNOSTICS_URL?: string;
  /**
   * Copied onto each Dotnote as a secret. The deployment may then register after the
   * owner consents. It is not consent by itself.
   */
  DOTNOTE_DIAGNOSTICS_TOKEN?: string;
  OAUTH_SCOPES: string;
};
