-- @since 0.2.2
-- Owner consent for optional Dotnote Cloud registration. Defaults to undecided, which never sends.
ALTER TABLE users ADD COLUMN diagnostics_consent TEXT NOT NULL DEFAULT 'undecided';
ALTER TABLE users ADD COLUMN diagnostics_consented_at TEXT;
ALTER TABLE users ADD COLUMN diagnostics_consent_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN diagnostics_instance_id TEXT;
ALTER TABLE users ADD COLUMN diagnostics_last_reported_at TEXT;
ALTER TABLE users ADD COLUMN diagnostics_reported_fingerprint TEXT;
