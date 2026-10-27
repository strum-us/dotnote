-- @since 0.1.0
-- One owner per Dotnote. owner_slot is always 1, so a second insert fails.
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE UNIQUE,
  password_hash TEXT NOT NULL,
  owner_slot INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (owner_slot = 1),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
