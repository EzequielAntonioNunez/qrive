import { Hono } from 'hono';
import { DomainError, type Command } from '../shared/engine';
import { negotiationScenario } from '../shared/simulation';
import { identityFor, type Identity, type AuthContext } from './auth';
import type { Env } from './types';

function parseCommand(value: unknown): Command {
  if (!value || typeof value !== 'object') throw new DomainError('Comando no válido.');
  const data = value as Record<string, unknown>;
  if (typeof data.id !== 'string' || !/^[\w-]{8,80}$/.test(data.id)) throw new DomainError('ID de comando no válido.');
  if (data.type === 'join' || data.type === 'advance' || data.type === 'pause' || data.type === 'resume' || data.type === 'complete') return { id: data.id, type: data.type };
  if (data.type === 'decide' && typeof data.optionId === 'string') return { id: data.id, type: data.type, optionId: data.optionId };
  if (data.type === 'incident' && typeof data.note === 'string' && typeof data.riskDelta === 'number') return { id: data.id, type: data.type, note: data.note, riskDelta: data.riskDelta };
  if (data.type === 'set-meter' && typeof data.meter === 'string' && typeof data.value === 'number') return { id: data.id, type: data.type, meter: data.meter as 'relationship' | 'margin' | 'risk', value: data.value };
  throw new DomainError('Comando no válido.');
}

export function createApp(demo = false) {
  const app = new Hono<AuthContext>();
  app.onError((error, c) => {
    console.error(JSON.stringify({ code: 'API_ERROR', path: c.req.path, message: String(error) }));
    return c.json({ error: error instanceof DomainError ? error.message : 'Error interno.' }, error instanceof DomainError ? 400 : 500);
  });
  app.get('/api/health', c => c.json({ ok: true }));
  app.use('/api/*', async (c, next) => {
    const identity = await identityFor(c, demo);
    if (!identity) return c.json({ error: 'Acceso no autorizado.' }, 401);
    c.set('identity', identity);
    await next();
  });
  app.get('/api/me', c => c.json({ identity: c.get('identity'), demo }));
  app.get('/api/scenarios', c => c.json({ scenarios: [negotiationScenario] }));
  app.get('/api/sessions', async c => {
    const rows = await c.env.DB.prepare('SELECT id, scenario_id AS scenarioId, status, created_at AS createdAt, completed_at AS completedAt FROM sessions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50').bind(c.get('identity').tenantId).all();
    return c.json({ sessions: rows.results });
  });
  app.post('/api/sessions', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await c.env.DB.prepare('INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, identity.tenantId, identity.id, negotiationScenario.id, negotiationScenario.version, 'active', createdAt).run();
    const response = await room(c.env, identity.tenantId, id, { op: 'create', id, tenantId: identity.tenantId, actor: identity });
    if (!response.ok) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND tenant_id = ?').bind(id, identity.tenantId).run();
      return response;
    }
    await audit(c.env, identity, id, 'session_created', {});
    return new Response(response.body, { status: 201, headers: { 'content-type': 'application/json' } });
  });
  app.get('/api/sessions/:id', async c => {
    const identity = c.get('identity');
    if (!await belongs(c.env, identity.tenantId, c.req.param('id'))) return c.json({ error: 'Sesión no encontrada.' }, 404);
    return room(c.env, identity.tenantId, c.req.param('id'), { op: 'state', tenantId: identity.tenantId, actor: identity });
  });
  app.post('/api/sessions/:id/commands', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await belongs(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    const command = parseCommand(await c.req.json());
    const response = await room(c.env, identity.tenantId, id, { op: 'command', tenantId: identity.tenantId, actor: identity, command });
    if (response.ok && command.type !== 'join' && command.type !== 'decide') await audit(c.env, identity, id, command.type, {});
    return response;
  });
  app.get('/api/sessions/:id/events', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await belongs(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    const rows = await c.env.DB.prepare('SELECT seq,type,at,actor_id AS actorId,detail_json AS detailJson FROM simulation_events WHERE tenant_id = ? AND session_id = ? ORDER BY seq')
      .bind(identity.tenantId, id).all();
    return c.json({ events: rows.results.map(row => ({ seq: row.seq, type: row.type, at: row.at, actorId: row.actorId, detail: JSON.parse(String(row.detailJson)) })) });
  });
  return app;
}

async function belongs(env: Env, tenantId: string, sessionId: string): Promise<boolean> {
  return !!await env.DB.prepare('SELECT id FROM sessions WHERE tenant_id = ? AND id = ?').bind(tenantId, sessionId).first();
}

async function room(env: Env, tenantId: string, id: string, body: unknown): Promise<Response> {
  const stub = env.SESSIONS.get(env.SESSIONS.idFromName(`${tenantId}:${id}`));
  return stub.fetch('https://room.internal/', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

async function audit(env: Env, identity: Identity, sessionId: string, action: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), identity.tenantId, identity.id, sessionId, action, new Date().toISOString(), JSON.stringify(detail)).run();
}
