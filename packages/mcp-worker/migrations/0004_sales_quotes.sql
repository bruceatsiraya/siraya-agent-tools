CREATE TABLE IF NOT EXISTS sales_quotes (
  id TEXT PRIMARY KEY,
  customer TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  rows_json TEXT NOT NULL
);
