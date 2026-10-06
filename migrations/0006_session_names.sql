-- Nombre opcional de la sesión, puesto por el instructor (1-80 caracteres). NULL: la consola muestra el título
-- del escenario y la fecha. Es texto libre: se queda en D1 y nunca sale a la cola ni a los eventos.
ALTER TABLE sessions ADD COLUMN name TEXT;
-- Listado de la consola: sesiones de la organización, activas y pausadas primero, las más recientes antes.
CREATE INDEX IF NOT EXISTS sessions_by_tenant_status ON sessions(tenant_id, status, created_at DESC);
-- Recuentos de participantes y fase actual por sesión (participant_joined, phase_advanced) en el listado.
CREATE INDEX IF NOT EXISTS events_by_type ON simulation_events(tenant_id, type, session_id, seq);
