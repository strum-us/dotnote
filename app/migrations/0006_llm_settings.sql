CREATE TABLE IF NOT EXISTS llm_settings (
  user_id TEXT PRIMARY KEY,
  active_provider TEXT NOT NULL,
  model TEXT NOT NULL,
  api_keys TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
