-- @since 0.1.0
CREATE TABLE IF NOT EXISTS cf_grant (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  account_id TEXT NOT NULL,
  scopes TEXT NOT NULL,
  refresh_ciphertext TEXT NOT NULL,
  refresh_iv TEXT NOT NULL,
  lock_until TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cf_reconnect (
  code_hash TEXT PRIMARY KEY,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS install_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
