-- Migration: 0001_create_files.sql
-- DropLocker File Metadata Storage

CREATE TABLE IF NOT EXISTS files (
    id          TEXT PRIMARY KEY,
    filename    TEXT NOT NULL,
    mime_type   TEXT NOT NULL DEFAULT 'application/octet-stream',
    size        INTEGER NOT NULL,
    pinned      INTEGER NOT NULL DEFAULT 0,
    uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_files_uploaded_at ON files(uploaded_at DESC);
CREATE INDEX IF NOT EXISTS idx_files_pinned ON files(pinned);
