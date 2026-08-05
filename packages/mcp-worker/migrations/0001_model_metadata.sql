CREATE TABLE IF NOT EXISTS model_overrides (
  model_id TEXT PRIMARY KEY,
  patch_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL DEFAULT 'admin'
);

CREATE TABLE IF NOT EXISTS model_research (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'error')),
  query TEXT NOT NULL,
  candidate_json TEXT,
  evidence_json TEXT,
  confidence REAL,
  analysis_model TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_model_research_model_created
  ON model_research(model_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_model_research_status
  ON model_research(status, created_at DESC);

CREATE TABLE IF NOT EXISTS model_audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL,
  actor TEXT NOT NULL DEFAULT 'admin'
);

CREATE INDEX IF NOT EXISTS idx_model_audit_model_created
  ON model_audit_log(model_id, created_at DESC);
