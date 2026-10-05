CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('instructor', 'participant')),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id) REFERENCES tenants(id),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  instructor_id TEXT NOT NULL,
  scenario_id TEXT NOT NULL,
  scenario_version INTEGER NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (tenant_id) REFERENCES tenants(id)
);
CREATE INDEX IF NOT EXISTS sessions_by_tenant ON sessions(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS simulation_events (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  PRIMARY KEY (session_id, seq),
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  session_id TEXT,
  action TEXT NOT NULL,
  at TEXT NOT NULL,
  detail_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_by_tenant ON audit_log(tenant_id, at DESC);
