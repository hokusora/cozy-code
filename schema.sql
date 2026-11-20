-- Cloudflare D1 & Local SQLite Schema for Canvas Notebook
CREATE TABLE IF NOT EXISTS notebooks (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  blocks_json TEXT NOT NULL, -- JSON array: [{ id, type, language, content, order, engine }]
  updated_at INTEGER NOT NULL,
  is_deleted INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_workspace ON notebooks(workspace_id, updated_at);
