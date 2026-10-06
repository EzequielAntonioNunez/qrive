import { Hono } from 'hono';
import { DomainError, type Command } from '../shared/engine';
import { ScenarioError } from '../shared/scenario';
import { getScenario, listScenarios, publishScenario } from './scenarios';
import { identityFor, type Identity, type AuthContext } from './auth';
import type { Env } from './types';
import { flags } from './flags';

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
    const known = error instanceof DomainError || error instanceof ScenarioError;
    if (known) console.warn(JSON.stringify({ code: 'API_REJECTED', path: c.req.path, message: error.message }));
    else console.error(JSON.stringify({ code: 'API_ERROR', path: c.req.path, message: String(error) }));
    return c.json({ error: known ? error.message : 'Error interno.' }, known ? 400 : 500);
  });
  app.get('/api/health', c => c.json({ ok: true }));
  app.use('/api/*', async (c, next) => {
    const identity = await identityFor(c, demo);
    if (!identity) return c.json({ error: 'Acceso no autorizado.' }, 401);
    c.set('identity', identity);
    if (!demo && c.env.API_LIMITER) {
      const { success } = await c.env.API_LIMITER.limit({ key: identity.id });
      if (!success) {
        console.warn(JSON.stringify({ code: 'RATE_LIMITED', userId: identity.id, path: c.req.path }));
        return c.json({ error: 'Demasiadas peticiones. Espera unos segundos.' }, 429);
      }
    }
    await next();
  });
  app.get('/api/me', c => c.json({ identity: c.get('identity'), demo, flags: flags(c.env) }));
  app.get('/api/scenarios', async c => c.json({ scenarios: await listScenarios(c.env, c.get('identity').tenantId) }));
  app.get('/api/scenarios/:id', async c => {
    const scenario = await getScenario(c.env, c.get('identity').tenantId, c.req.param('id'));
    return scenario ? c.json({ scenario }) : c.json({ error: 'Escenario no encontrado.' }, 404);
  });
  app.post('/api/scenarios', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const scenario = await publishScenario(c.env, identity.tenantId, identity.id, await c.req.json());
    await audit(c.env, identity, null, 'scenario_published', { scenarioId: scenario.id, version: scenario.version });
    return c.json({ scenario }, 201);
  });
  app.get('/api/memberships', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const rows = await c.env.DB.prepare(`SELECT users.id, users.email, users.display_name AS name, memberships.role
      FROM memberships JOIN users ON users.id = memberships.user_id WHERE memberships.tenant_id = ? ORDER BY users.display_name`)
      .bind(identity.tenantId).all();
    return c.json({ members: rows.results });
  });
  app.post('/api/memberships', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const body = await c.req.json() as { email?: unknown; name?: unknown; role?: unknown };
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    const role = body.role;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 || !name || name.length > 100 || !['instructor', 'participant'].includes(String(role))) throw new DomainError('Miembro no válido.');
    let user = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
    if (!user) {
      const id = crypto.randomUUID();
      await c.env.DB.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').bind(id, email, name, new Date().toISOString()).run();
      user = { id };
    }
    await c.env.DB.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?) ON CONFLICT(tenant_id,user_id) DO UPDATE SET role=excluded.role')
      .bind(identity.tenantId, user.id, role).run();
    await audit(c.env, identity, null, 'member_upserted', { userId: user.id, role });
    return c.json({ member: { id: user.id, email, name, role } }, 201);
  });
  app.get('/api/sessions', async c => {
    const rows = await c.env.DB.prepare('SELECT id, scenario_id AS scenarioId, status, created_at AS createdAt, completed_at AS completedAt FROM sessions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50').bind(c.get('identity').tenantId).all();
    return c.json({ sessions: rows.results });
  });
  app.post('/api/sessions', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const body = await c.req.json().catch(() => ({})) as { scenarioId?: unknown };
    const scenarioId = typeof body.scenarioId === 'string' ? body.scenarioId : 'supplier-negotiation';
    const scenario = await getScenario(c.env, identity.tenantId, scenarioId);
    if (!scenario) return c.json({ error: 'Escenario no encontrado.' }, 404);
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await c.env.DB.prepare('INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES (?,?,?,?,?,?,?)')
      .bind(id, identity.tenantId, identity.id, scenario.id, scenario.version, 'active', createdAt).run();
    const response = await room(c.env, identity.tenantId, id, { op: 'create', id, tenantId: identity.tenantId, actor: identity, scenario });
    if (!response.ok) {
      await c.env.DB.prepare('DELETE FROM sessions WHERE id = ? AND tenant_id = ?').bind(id, identity.tenantId).run();
      return response;
    }
    await audit(c.env, identity, id, 'session_created', { scenarioId: scenario.id, version: scenario.version });
    return new Response(response.body, { status: 201, headers: { 'content-type': 'application/json' } });
  });
  app.get('/api/sessions/:id', async c => {
    const identity = c.get('identity');
    if (!await belongs(c.env, identity.tenantId, c.req.param('id'))) return c.json({ error: 'Sesión no encontrada.' }, 404);
    return room(c.env, identity.tenantId, c.req.param('id'), { op: 'state', tenantId: identity.tenantId, actor: identity, client: clientKind(c.req.header('x-axyro-client')) });
  });
  app.post('/api/sessions/:id/commands', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await belongs(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    const command = parseCommand(await c.req.json());
    const response = await room(c.env, identity.tenantId, id, { op: 'command', tenantId: identity.tenantId, actor: identity, command, client: clientKind(c.req.header('x-axyro-client')) });
    if (response.ok && command.type !== 'join' && command.type !== 'decide') await audit(c.env, identity, id, command.type, {});
    return response;
  });
  // RGPD: exportación completa de una sesión (estado, eventos con IDs seudónimos e informe).
  app.get('/api/sessions/:id/export', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    if (!await belongs(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    const current = await room(c.env, identity.tenantId, id, { op: 'state', tenantId: identity.tenantId, actor: identity });
    const data = await current.json() as Record<string, unknown>;
    await audit(c.env, identity, id, 'session_exported', {});
    return c.json({ exportedAt: new Date().toISOString(), session: data.state, report: data.report });
  });
  // RGPD: borrado de una sesión en D1 y en su Durable Object. Queda solo la entrada de auditoría.
  app.delete('/api/sessions/:id', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    if (!await belongs(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    await purgeSession(c.env, identity.tenantId, id);
    await audit(c.env, identity, id, 'session_deleted', {});
    return c.json({ deleted: true });
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

function clientKind(value?: string): 'unity' | undefined {
  return value === 'unity' ? 'unity' : undefined;
}

export async function purgeSession(env: Env, tenantId: string, id: string): Promise<void> {
  await room(env, tenantId, id, { op: 'purge', tenantId });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM simulation_events WHERE tenant_id = ? AND session_id = ?').bind(tenantId, id),
    env.DB.prepare('DELETE FROM sessions WHERE tenant_id = ? AND id = ?').bind(tenantId, id)
  ]);
}

/** Retención: borra las sesiones finalizadas hace más de RETENTION_DAYS (365 por defecto). */
export async function applyRetention(env: Env, now = new Date()): Promise<number> {
  const days = Math.max(1, Number.parseInt(env.RETENTION_DAYS ?? '365', 10) || 365);
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  const rows = await env.DB.prepare("SELECT id, tenant_id AS tenantId FROM sessions WHERE status = 'complete' AND completed_at < ? LIMIT 200").bind(cutoff).all<{ id: string; tenantId: string }>();
  for (const row of rows.results) {
    await purgeSession(env, row.tenantId, row.id);
    await env.DB.prepare('INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), row.tenantId, 'system', row.id, 'session_retention_deleted', now.toISOString(), JSON.stringify({ retentionDays: days })).run();
  }
  if (rows.results.length) console.log(JSON.stringify({ code: 'RETENTION_APPLIED', deleted: rows.results.length, retentionDays: days }));
  return rows.results.length;
}

async function belongs(env: Env, tenantId: string, sessionId: string): Promise<boolean> {
  return !!await env.DB.prepare('SELECT id FROM sessions WHERE tenant_id = ? AND id = ?').bind(tenantId, sessionId).first();
}

async function room(env: Env, tenantId: string, id: string, body: unknown): Promise<Response> {
  const stub = env.SESSIONS.get(env.SESSIONS.idFromName(`${tenantId}:${id}`));
  return stub.fetch('https://room.internal/', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

async function audit(env: Env, identity: Identity, sessionId: string | null, action: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), identity.tenantId, identity.id, sessionId, action, new Date().toISOString(), JSON.stringify(detail)).run();
}
