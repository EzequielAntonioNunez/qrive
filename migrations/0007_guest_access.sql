-- Acceso invitado (unión tipo «código de sala»): un PIN de seis cifras por sesión y una identidad de invitado
-- con alias, sin correo, limitada a esa sesión. El PIN se guarda en claro porque el instructor lo vuelve a ver y
-- proyectar; solo da acceso como participante a una sesión no finalizada y se revoca al finalizarla o borrarla.
CREATE TABLE IF NOT EXISTS session_pins (
  pin TEXT NOT NULL CHECK (length(pin) = 6),
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
-- Un PIN activo es único en toda la plataforma (el invitado no indica organización).
CREATE UNIQUE INDEX IF NOT EXISTS session_pins_active ON session_pins(pin) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS session_pins_by_session ON session_pins(tenant_id, session_id, revoked_at);
-- Un solo PIN activo por sesión (dos peticiones simultáneas del instructor no crean dos).
CREATE UNIQUE INDEX IF NOT EXISTS session_pins_one_active ON session_pins(tenant_id, session_id) WHERE revoked_at IS NULL;

-- Invitados: id seudónimo «guest-<uuid>», alias visible y hash del token de la cookie (nunca el token).
-- Caducan a las 12 horas o al finalizar la sesión (con un margen de lectura del informe); los borra el cron.
CREATE TABLE IF NOT EXISTS guests (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  alias TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS guests_by_session ON guests(tenant_id, session_id);
-- Alias únicos dentro de la sesión (sin distinguir mayúsculas ASCII): «Ana», «Ana 2», «Ana 3»...
CREATE UNIQUE INDEX IF NOT EXISTS guests_alias_in_session ON guests(session_id, lower(alias));
CREATE INDEX IF NOT EXISTS guests_by_expiry ON guests(expires_at);
