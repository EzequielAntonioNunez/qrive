-- Un código activo por persona. Solo se almacena el hash, nunca el código entregado.
CREATE TABLE IF NOT EXISTS access_codes (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  code_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS access_codes_by_user ON access_codes(tenant_id, user_id, revoked_at);

CREATE TABLE IF NOT EXISTS access_sessions (
  token_hash TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (code_id) REFERENCES access_codes(id)
);
CREATE INDEX IF NOT EXISTS access_sessions_by_user ON access_sessions(tenant_id, user_id);
CREATE INDEX IF NOT EXISTS access_sessions_by_expiry ON access_sessions(expires_at);

-- Un registro por uso correcto o rechazado de un código conocido. Sin código ni IP en claro.
CREATE TABLE IF NOT EXISTS access_code_uses (
  id TEXT PRIMARY KEY,
  code_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'revoked')),
  FOREIGN KEY (code_id) REFERENCES access_codes(id)
);
CREATE INDEX IF NOT EXISTS access_code_uses_by_code ON access_code_uses(code_id, at DESC);
CREATE INDEX IF NOT EXISTS access_code_uses_by_at ON access_code_uses(at);
