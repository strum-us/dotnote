CREATE TABLE IF NOT EXISTS note_shares (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  workspace_id TEXT NOT NULL,
  note_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_note_shares_note ON note_shares(workspace_id, note_id);
CREATE INDEX IF NOT EXISTS idx_note_shares_active ON note_shares(workspace_id, note_id, revoked_at);
