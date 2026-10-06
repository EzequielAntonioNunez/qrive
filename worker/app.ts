import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DomainError, type Command } from '../shared/engine';
import { ScenarioError } from '../shared/scenario';
import { defaultScenario } from '../shared/simulation';
import { getScenario, listScenarios, publishScenario } from './scenarios';
import { allowedDomain, identityFor, isOwnerEmail, normalizeEmail, organizationTenant, type Identity, type AuthContext } from './auth';
import type { Env } from './types';
import { flags } from './flags';
import { serveSimulator } from './simulator';

/** Error con código HTTP explícito (400 cuerpo no válido, 403, 404, 409...). */
export class HttpError extends Error {
  constructor(readonly status: ContentfulStatusCode, message: string) { super(message); }
}

const INVALID_JSON = 'Cuerpo JSON no válido.';
const MEMBER_UNAVAILABLE = 'Ese correo no se puede dar de alta en esta organización.';
const LAST_INSTRUCTOR = 'Debe quedar al menos un instructor en la organización.';
const OWNER_PROTECTED = 'No se puede modificar al propietario de la organización.';

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

/** Lee el cuerpo como JSON. Un JSON mal formado es un 400, no un 500. Con `optional`, un cuerpo vacío vale `{}`. */
async function readJson(c: Context<AuthContext>, optional = false): Promise<unknown> {
  const text = await c.req.text();
  if (!text.trim()) {
    if (optional) return {};
    throw new HttpError(400, INVALID_JSON);
  }
  try { return JSON.parse(text); } catch { throw new HttpError(400, INVALID_JSON); }
}

// ---------------------------------------------------------------------------------------------
// CSRF: Access autentica con una cookie, así que toda petición que cambia estado debe venir del
// propio origen y con cuerpo JSON (un formulario de otro sitio no puede enviar application/json
// sin una preflight CORS, que este Worker nunca autoriza).
// ---------------------------------------------------------------------------------------------
const STATE_CHANGING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/** Motivo de rechazo CSRF de la petición, o null si se acepta. */
export function csrfRejection(request: Request): string | null {
  if (!STATE_CHANGING.has(request.method)) return null;
  const site = request.headers.get('sec-fetch-site');
  const origin = request.headers.get('origin');
  if (site) {
    // Navegadores actuales: same-origin (fetch de la consola o del simulador) o none (acción directa del usuario).
    if (site !== 'same-origin' && site !== 'none') return 'Petición de otro origen rechazada.';
  } else if (origin) {
    let sameHost = false;
    try { sameHost = new URL(origin).host === new URL(request.url).host; } catch { sameHost = false; }
    if (!sameHost) return 'Petición de otro origen rechazada.';
  }
  const length = request.headers.get('content-length');
  const declaresBody = (length !== null && Number(length) > 0) || request.headers.has('transfer-encoding') || (length === null && request.body !== null);
  if (request.method === 'DELETE' && !declaresBody) return null;
  const type = (request.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  return type === 'application/json' ? null : 'El cuerpo debe enviarse como application/json.';
}

// ---------------------------------------------------------------------------------------------
// Cabeceras de seguridad. El Worker atiende /api, /simulador y las páginas HTML de la consola
// (run_worker_first en wrangler.jsonc); los ficheros con hash de /assets y /brand salen directos.
// ---------------------------------------------------------------------------------------------
const CSP = {
  // Respuestas JSON: no se interpretan como documento.
  api: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  // Consola React/Vite: scripts y estilos propios (sin fuentes externas); los estilos en línea de React van por CSSOM.
  console: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  // Unity WebGL: script y estilo en línea de la plantilla (cambian en cada build, no admiten hash fijo),
  // WebAssembly ('wasm-unsafe-eval'), blob: para el framework descomprimido y los workers, audio y texturas en blob:/data:.
  simulator: "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests"
} as const;

type SurfaceKind = keyof typeof CSP;

function surfaceOf(path: string): SurfaceKind {
  if (path === '/api' || path.startsWith('/api/')) return 'api';
  if (path === '/simulador' || path.startsWith('/simulador/')) return 'simulator';
  return 'console';
}

/** Copia la respuesta (las de ASSETS y Durable Objects tienen cabeceras inmutables) y añade las cabeceras de seguridad. */
export function withSecurityHeaders(response: Response, path: string, requestId: string): Response {
  const kind = surfaceOf(path);
  const out = new Response(response.body, response);
  const headers = out.headers;
  headers.set('content-security-policy', CSP[kind]);
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', kind === 'simulator' ? 'SAMEORIGIN' : 'DENY');
  // same-origin: el enlace del simulador lleva el id de sesión en la URL y no debe salir en el Referer.
  headers.set('referrer-policy', 'same-origin');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  if (kind === 'api' && !headers.has('cache-control')) headers.set('cache-control', 'no-store');
  headers.set('x-request-id', requestId);
  return out;
}

export function createApp(demo = false) {
  const app = new Hono<AuthContext>();
  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    const known = error instanceof DomainError || error instanceof ScenarioError;
    if (known) {
      console.warn(JSON.stringify({ code: 'API_REJECTED', requestId, path: c.req.path, message: error.message }));
      return c.json({ error: error.message }, 400);
    }
    console.error(JSON.stringify({ code: 'API_ERROR', requestId, path: c.req.path, message: String(error) }));
    return c.json({ error: 'Error interno.', requestId }, 500);
  });

  // Observabilidad: un log JSON por petición, sin PII (solo IDs seudónimos de organización y usuario).
  app.use('*', async (c, next) => {
    const started = Date.now();
    const requestId = c.req.header('cf-ray') ?? crypto.randomUUID();
    c.set('requestId', requestId);
    await next();
    c.res = withSecurityHeaders(c.res, c.req.path, requestId);
    const identity = c.get('identity') as Identity | undefined;
    console.log(JSON.stringify({
      code: 'REQUEST', requestId, method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - started,
      tenantId: identity?.tenantId ?? null, userId: identity?.id ?? null
    }));
  });

  app.get('/api/health', c => c.json({ ok: true }));
  // Simulador WebGL: static assets y, para ficheros de más de 25 MiB, R2 (ver worker/simulator.ts).
  app.on(['GET', 'HEAD'], ['/simulador', '/simulador/*'], c => serveSimulator(c.req.raw, c.env));
  app.use('/api/*', async (c, next) => {
    const rejected = csrfRejection(c.req.raw);
    if (rejected) {
      console.warn(JSON.stringify({ code: 'CSRF_REJECTED', requestId: c.get('requestId'), method: c.req.method, path: c.req.path }));
      return c.json({ error: rejected }, 403);
    }
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
    const scenario = await publishScenario(c.env, identity.tenantId, identity.id, await readJson(c));
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
  /**
   * Alta o actualización de un miembro de la organización del instructor.
   * - Un usuario pertenece a una sola organización: si el correo ya es de otra, se rechaza sin decir de cuál.
   * - Volver a dar de alta un miembro corrige su nombre y su rol.
   * - Nunca deja la organización sin instructores ni degrada al propietario inicial (BOOTSTRAP_OWNER_EMAIL).
   */
  app.post('/api/memberships', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const body = await readJson(c) as { email?: unknown; name?: unknown; role?: unknown } | null;
    const email = normalizeEmail(body?.email);
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    const role = body?.role;
    if (!email || !name || name.length > 100 || (role !== 'instructor' && role !== 'participant')) throw new DomainError('Miembro no válido.');
    const tenantId = identity.tenantId;
    const db = c.env.DB;

    const user = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
    const elsewhere = user && await db.prepare('SELECT 1 AS found FROM memberships WHERE user_id = ? AND tenant_id <> ? LIMIT 1').bind(user.id, tenantId).first();
    if (elsewhere) throw new HttpError(409, MEMBER_UNAVAILABLE);
    const current = user && await db.prepare('SELECT role FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(tenantId, user.id).first<{ role: 'instructor' | 'participant' }>();
    if (!current) {
      // El propietario inicial solo entra por el arranque, y los correos con autoalta son de la organización por defecto:
      // otra organización no puede reservarlos antes de su primer acceso.
      if (isOwnerEmail(c.env, email)) throw new HttpError(409, MEMBER_UNAVAILABLE);
      if (allowedDomain(email, c.env)) {
        const organization = await organizationTenant(c.env);
        if (organization && organization !== tenantId) throw new HttpError(409, MEMBER_UNAVAILABLE);
      }
    }

    let userId: string;
    if (!user) {
      await db.batch([
        db.prepare('INSERT OR IGNORE INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), email, name, new Date().toISOString()),
        db.prepare('INSERT OR IGNORE INTO memberships (tenant_id,user_id,role) SELECT ?, id, ? FROM users WHERE email = ?').bind(tenantId, role, email)
      ]);
      const created = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first<{ id: string }>();
      if (!created) throw new Error('Alta de miembro sin usuario.');
      userId = created.id;
    } else {
      userId = user.id;
      if (!current) {
        await db.prepare('INSERT OR IGNORE INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').bind(tenantId, userId, role).run();
      } else if (current.role === 'instructor' && role === 'participant') {
        if (isOwnerEmail(c.env, email)) throw new HttpError(409, OWNER_PROTECTED);
        // Condición en la propia sentencia: dos degradaciones simultáneas no pueden dejar la organización sin instructores.
        const demoted = await db.prepare(`UPDATE memberships SET role = 'participant' WHERE tenant_id = ? AND user_id = ? AND role = 'instructor'
          AND (SELECT COUNT(*) FROM memberships WHERE tenant_id = ? AND role = 'instructor' AND user_id <> ?) > 0`)
          .bind(tenantId, userId, tenantId, userId).run();
        if (!demoted.meta.changes) throw new HttpError(409, LAST_INSTRUCTOR);
      } else if (current.role !== role) {
        await db.prepare('UPDATE memberships SET role = ? WHERE tenant_id = ? AND user_id = ?').bind(role, tenantId, userId).run();
      }
      // El usuario solo pertenece a esta organización, así que puede corregir su nombre visible.
      await db.prepare('UPDATE users SET display_name = ? WHERE id = ?').bind(name, userId).run();
    }
    await audit(c.env, identity, null, 'member_upserted', { userId, role });
    return c.json({ member: { id: userId, email, name, role } }, 201);
  });
  /** Baja de un miembro. Si no le quedan membresías, se borra también el usuario (correo y nombre). */
  app.delete('/api/memberships/:userId', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const tenantId = identity.tenantId;
    const userId = c.req.param('userId');
    if (userId === identity.id) throw new HttpError(400, 'No puedes darte de baja a ti mismo.');
    const member = await c.env.DB.prepare(`SELECT users.email, memberships.role FROM memberships JOIN users ON users.id = memberships.user_id
      WHERE memberships.tenant_id = ? AND memberships.user_id = ?`).bind(tenantId, userId).first<{ email: string; role: string }>();
    if (!member) return c.json({ error: 'Miembro no encontrado.' }, 404);
    if (isOwnerEmail(c.env, member.email)) throw new HttpError(409, OWNER_PROTECTED);
    const [membership, account] = await c.env.DB.batch([
      c.env.DB.prepare(`DELETE FROM memberships WHERE tenant_id = ? AND user_id = ?
        AND (role <> 'instructor' OR (SELECT COUNT(*) FROM memberships WHERE tenant_id = ? AND role = 'instructor' AND user_id <> ?) > 0)`)
        .bind(tenantId, userId, tenantId, userId),
      c.env.DB.prepare('DELETE FROM users WHERE id = ? AND NOT EXISTS (SELECT 1 FROM memberships WHERE user_id = ?)').bind(userId, userId)
    ]);
    if (!membership.meta.changes) throw new HttpError(409, LAST_INSTRUCTOR);
    await audit(c.env, identity, null, 'member_deleted', { userId, role: member.role, userDeleted: (account.meta.changes ?? 0) > 0 });
    return c.json({ deleted: true });
  });

  app.get('/api/sessions', async c => {
    const identity = c.get('identity');
    const columns = 'id, scenario_id AS scenarioId, status, created_at AS createdAt, completed_at AS completedAt';
    // Instructor: todas las sesiones de la organización. Participante: solo aquellas a las que se ha unido
    // (en el modo demo local, todas, para que Unity siga la sesión más reciente sin enlace).
    const rows = identity.role === 'instructor' || demo
      ? await c.env.DB.prepare(`SELECT ${columns} FROM sessions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 50`).bind(identity.tenantId).all()
      : await c.env.DB.prepare(`SELECT ${columns} FROM sessions s WHERE s.tenant_id = ? AND EXISTS (
          SELECT 1 FROM simulation_events e WHERE e.tenant_id = s.tenant_id AND e.session_id = s.id AND e.type = 'participant_joined' AND e.actor_id = ?)
          ORDER BY s.created_at DESC LIMIT 50`).bind(identity.tenantId, identity.id).all();
    return c.json({ sessions: rows.results });
  });
  app.post('/api/sessions', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const body = await readJson(c, true) as { scenarioId?: unknown } | null;
    const scenarioId = typeof body?.scenarioId === 'string' ? body.scenarioId : defaultScenario.id;
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
  // Cualquier miembro de la organización puede leer una sesión por su id (el participante llega con el enlace del
  // simulador y aún no se ha unido). Otra organización recibe 404.
  app.get('/api/sessions/:id', async c => {
    const identity = c.get('identity');
    if (!await sessionFor(c.env, identity.tenantId, c.req.param('id'))) return c.json({ error: 'Sesión no encontrada.' }, 404);
    // Vista por rol: el Durable Object (roomPayload en worker/room.ts) devuelve al participante solo
    // `participantView(state, actor.id)` y su informe individual; por eso `actor` debe ser siempre la identidad real.
    return room(c.env, identity.tenantId, c.req.param('id'), { op: 'state', tenantId: identity.tenantId, actor: identity, client: clientKind(c.req.header('x-axyro-client')) });
  });
  app.post('/api/sessions/:id/commands', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await sessionFor(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    const command = parseCommand(await readJson(c));
    // La respuesta también pasa por roomPayload: el participante recibe solo su vista filtrada.
    const response = await room(c.env, identity.tenantId, id, { op: 'command', tenantId: identity.tenantId, actor: identity, command, client: clientKind(c.req.header('x-axyro-client')) });
    if (response.ok && command.type !== 'join' && command.type !== 'decide') await audit(c.env, identity, id, command.type, {});
    return response;
  });
  // RGPD: exportación completa de una sesión (estado, eventos con IDs seudónimos e informe). Solo su instructor.
  app.get('/api/sessions/:id/export', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const session = await sessionFor(c.env, identity.tenantId, id);
    if (!session) return c.json({ error: 'Sesión no encontrada.' }, 404);
    if (!await canManage(c.env, identity, session)) return c.json({ error: 'Solo el instructor que creó la sesión puede exportarla.' }, 403);
    const current = await room(c.env, identity.tenantId, id, { op: 'state', tenantId: identity.tenantId, actor: identity });
    const data = await current.json() as Record<string, unknown>;
    await audit(c.env, identity, id, 'session_exported', {});
    return c.json({ exportedAt: new Date().toISOString(), session: data.state, report: data.report });
  });
  // RGPD: borrado de una sesión en D1 y en su Durable Object. Queda solo la entrada de auditoría. Solo su instructor.
  app.delete('/api/sessions/:id', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const session = await sessionFor(c.env, identity.tenantId, id);
    if (!session) return c.json({ error: 'Sesión no encontrada.' }, 404);
    if (!await canManage(c.env, identity, session)) return c.json({ error: 'Solo el instructor que creó la sesión puede borrarla.' }, 403);
    await purgeSession(c.env, identity.tenantId, id);
    await audit(c.env, identity, id, 'session_deleted', {});
    return c.json({ deleted: true });
  });
  app.get('/api/sessions/:id/events', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    if (!await sessionFor(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    const rows = await c.env.DB.prepare('SELECT seq,type,at,actor_id AS actorId,detail_json AS detailJson FROM simulation_events WHERE tenant_id = ? AND session_id = ? ORDER BY seq')
      .bind(identity.tenantId, id).all();
    return c.json({ events: rows.results.map(row => ({ seq: row.seq, type: row.type, at: row.at, actorId: row.actorId, detail: JSON.parse(String(row.detailJson)) })) });
  });
  app.all('/api/*', c => c.json({ error: 'Ruta no encontrada.' }, 404));

  // Páginas de la consola (run_worker_first; HEAD también llega aquí): se sirven desde los static assets con las cabeceras de seguridad.
  app.get('*', async c => c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ error: 'No encontrado.' }, 404));
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

function retentionDays(value: string | undefined, fallback: number): number {
  return Math.max(1, Number.parseInt(value ?? String(fallback), 10) || fallback);
}

/**
 * Retención (tarea programada diaria):
 * - Sesiones finalizadas hace más de RETENTION_DAYS (365 por defecto) y sesiones no finalizadas creadas hace más de ese plazo.
 * - Entradas de audit_log con más de AUDIT_RETENTION_DAYS (730 por defecto).
 * Devuelve el número de sesiones borradas (como máximo 200 por ejecución).
 */
export async function applyRetention(env: Env, now = new Date()): Promise<number> {
  const days = retentionDays(env.RETENTION_DAYS, 365);
  const auditDays = retentionDays(env.AUDIT_RETENTION_DAYS, 730);
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  const rows = await env.DB.prepare(`SELECT id, tenant_id AS tenantId, status FROM sessions
    WHERE (status = 'complete' AND COALESCE(completed_at, created_at) < ?) OR (status <> 'complete' AND created_at < ?) LIMIT 200`)
    .bind(cutoff, cutoff).all<{ id: string; tenantId: string; status: string }>();
  for (const row of rows.results) {
    await purgeSession(env, row.tenantId, row.id);
    await env.DB.prepare('INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES (?,?,?,?,?,?,?)')
      .bind(crypto.randomUUID(), row.tenantId, 'system', row.id, 'session_retention_deleted', now.toISOString(), JSON.stringify({ retentionDays: days, completed: row.status === 'complete' })).run();
  }
  const auditCutoff = new Date(now.getTime() - auditDays * 86400000).toISOString();
  const pruned = await env.DB.prepare('DELETE FROM audit_log WHERE at < ?').bind(auditCutoff).run();
  const auditDeleted = pruned?.meta?.changes ?? 0;
  if (rows.results.length || auditDeleted) console.log(JSON.stringify({ code: 'RETENTION_APPLIED', deleted: rows.results.length, retentionDays: days, auditDeleted, auditRetentionDays: auditDays }));
  return rows.results.length;
}

async function sessionFor(env: Env, tenantId: string, sessionId: string): Promise<{ instructorId: string } | null> {
  return env.DB.prepare('SELECT instructor_id AS instructorId FROM sessions WHERE tenant_id = ? AND id = ?').bind(tenantId, sessionId).first<{ instructorId: string }>();
}

/** Exportar o borrar: el instructor que creó la sesión; si ya no es miembro, cualquier instructor de la organización. */
async function canManage(env: Env, identity: Identity, session: { instructorId: string }): Promise<boolean> {
  if (identity.role !== 'instructor') return false;
  if (session.instructorId === identity.id) return true;
  return !await env.DB.prepare('SELECT 1 AS found FROM memberships WHERE tenant_id = ? AND user_id = ?').bind(identity.tenantId, session.instructorId).first();
}

/** Espacio de nombres de los Durable Objects de sesión; con SESSIONS_JURISDICTION = "eu", restringido a la UE. */
function sessionNamespace(env: Env): DurableObjectNamespace {
  return env.SESSIONS_JURISDICTION === 'eu' ? env.SESSIONS.jurisdiction('eu') : env.SESSIONS;
}

async function room(env: Env, tenantId: string, id: string, body: unknown): Promise<Response> {
  const namespace = sessionNamespace(env);
  const stub = namespace.get(namespace.idFromName(`${tenantId}:${id}`));
  return stub.fetch('https://room.internal/', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
}

async function audit(env: Env, identity: Identity, sessionId: string | null, action: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), identity.tenantId, identity.id, sessionId, action, new Date().toISOString(), JSON.stringify(detail)).run();
}
