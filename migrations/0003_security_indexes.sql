-- Índices para las comprobaciones de seguridad y la retención.
-- Membresías de un usuario (resolución de identidad y comprobación de «ya pertenece a otra organización»).
CREATE INDEX IF NOT EXISTS memberships_by_user ON memberships(user_id);
-- Purga del registro de auditoría por antigüedad (AUDIT_RETENTION_DAYS).
CREATE INDEX IF NOT EXISTS audit_by_at ON audit_log(at);
-- Retención de sesiones no finalizadas por fecha de creación.
CREATE INDEX IF NOT EXISTS sessions_by_created ON sessions(created_at);
-- Sesiones a las que se ha unido un participante (GET /api/sessions con rol participante).
CREATE INDEX IF NOT EXISTS events_by_actor ON simulation_events(tenant_id, actor_id, type);
