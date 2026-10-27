export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  OAUTH_CLIENT_ID: string;
  HQ_URL: string;
  /** Copied onto each Dotnote as a secret so it can publish its directory profile. */
  HQ_DIRECTORY_TOKEN?: string;
  OAUTH_SCOPES: string;
};
