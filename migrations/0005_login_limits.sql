-- El bloqueo de intentos de un código de seis cifras debe ser transaccional, no depender de
-- la propagación del limitador de borde entre peticiones consecutivas.
CREATE TABLE IF NOT EXISTS access_login_limits (
  key_hash TEXT PRIMARY KEY,
  window_start TEXT NOT NULL,
  attempts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS access_login_limits_by_window ON access_login_limits(window_start);
