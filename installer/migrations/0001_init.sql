CREATE TABLE IF NOT EXISTS installations (
  id TEXT PRIMARY KEY,
  key_hash TEXT NOT NULL,
  account_id TEXT NOT NULL,
  account_name TEXT NOT NULL,
  worker_name TEXT NOT NULL,
  hostname TEXT,
  zone_id TEXT,
  zone_name TEXT,
  address TEXT NOT NULL,
  handoff_hash TEXT NOT NULL,
  release_version TEXT NOT NULL,
  step_index INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  message TEXT,
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_install_account ON installations(account_id);
