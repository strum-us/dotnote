-- @since 0.2.10
CREATE TABLE IF NOT EXISTS ai_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  input_cost_usd REAL NOT NULL DEFAULT 0,
  output_cost_usd REAL NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  input_data TEXT NOT NULL DEFAULT '',
  output_data TEXT,
  status TEXT NOT NULL DEFAULT 'success',
  error_message TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_logs_user_created ON ai_logs (user_id, created_at DESC);
