-- Escenarios como datos versionados. tenant_id NULL = escenario de catálogo disponible para todas las organizaciones.
-- Una versión publicada es inmutable: los cambios crean una versión nueva.
CREATE TABLE IF NOT EXISTS scenarios (
  id TEXT NOT NULL,
  version INTEGER NOT NULL,
  tenant_id TEXT,
  title TEXT NOT NULL,
  definition_json TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (id, version)
);
CREATE INDEX IF NOT EXISTS scenarios_by_tenant ON scenarios(tenant_id, id, version DESC);
