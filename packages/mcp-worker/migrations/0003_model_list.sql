CREATE TABLE IF NOT EXISTS model_list_specs (
  model_id TEXT PRIMARY KEY,
  rpm INTEGER,
  tpm INTEGER,
  discount REAL,
  baseline TEXT,
  edited INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS model_list_benchmarks (
  model_id TEXT NOT NULL,
  source TEXT NOT NULL,
  ttft REAL,
  tps REAL,
  observed_at TEXT NOT NULL,
  PRIMARY KEY (model_id, source)
);

CREATE TABLE IF NOT EXISTS model_list_overrides (
  model_id TEXT PRIMARY KEY,
  values_json TEXT NOT NULL
);
