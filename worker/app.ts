import { Hono, type Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { DomainError, type Command } from '../shared/engine';
import { ScenarioError } from '../shared/scenario';
import { defaultScenario, type SimEvent } from '../shared/simulation';
import { getScenario, getScenarioVersion, listScenarios, publishScenario } from './scenarios';
import { copyName, parseSessionName, SessionNameError, sessionRow, sessionRows } from './sessions';
import { persistEvent } from './persist';
import { AnalyticsQueryError, organizationAnalytics, parseAnalyticsQuery, type AnalyticsQuery } from './analytics';
import type { Scenario } from '../shared/simulation';
import { allowedDomain, identityFor, isOwnerEmail, normalizeEmail, organizationTenant, type Identity, type AuthContext } from './auth';
import type { Env } from './types';
import { flags } from './flags';
import { serveSimulator } from './simulator';
import { codeSummaries, consumeLoginAttempt, issueCode, pruneAuth, revokeCodes, signInWithCode, signOut } from './access-codes';
import { queueSafeEvent, ROOM_ACTOR_HEADER, type RoomActor } from './room';
import { DEFAULT_SIMULATED, MAX_SIMULATED } from './demo-class';
import { CLEF_MODEL, MAX_PHRASE_LENGTH, clefRequest, interpretClef } from './voice-intent';
import type { SessionState } from '../shared/simulation';
import {
  ALIAS_INVALID, GUEST_SCOPE_ERROR, JOIN_BLOCKED, PIN_INVALID, createGuest, dropCurrentSession, ensurePin, guestAllowed, guestFromCookie,
  joinBlocked, parseAlias, pruneGuests, purgeStatements, recordJoinFailure, sessionByPin, setGuestCookie
} from './guests';

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
// CSRF: la sesión propia autentica con una cookie, así que toda petición que cambia estado debe venir del
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
/** Hosts regionales de Soniox: una clave solo funciona en la región de su proyecto. */
const SONIOX_REGIONS = {
  eu: { region: 'eu', api: 'https://api.eu.soniox.com', websocketUrl: 'wss://stt-rt.eu.soniox.com/transcribe-websocket' },
  us: { region: 'us', api: 'https://api.soniox.com', websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket' }
} as const;

const CSP = {
  // Respuestas JSON: no se interpretan como documento.
  api: "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  // Consola React/Vite: scripts y estilos propios (sin fuentes externas); los estilos en línea de React van por CSSOM.
  console: "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; media-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests",
  // Unity WebGL: script y estilo en línea de la plantilla (cambian en cada build, no admiten hash fijo),
  // WebAssembly ('wasm-unsafe-eval'), blob: para el framework descomprimido y los workers, audio y texturas en blob:/data:.
  simulator: "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data: wss://stt-rt.eu.soniox.com wss://stt-rt.soniox.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'; upgrade-insecure-requests"
} as const;

type SurfaceKind = keyof typeof CSP;

function surfaceOf(path: string): SurfaceKind {
  if (path === '/api' || path.startsWith('/api/')) return 'api';
  if (path === '/simulador' || path.startsWith('/simulador/')) return 'simulator';
  return 'console';
}

/**
 * CSP de una superficie. La consola abre el WebSocket de tiempo real de su propio origen: `connect-src 'self'` no
 * cubre ws:/wss: en todos los navegadores, así que se añade explícitamente el origen WebSocket del propio host.
 */
export function cspFor(kind: SurfaceKind, requestUrl?: string): string {
  if (kind !== 'console' || !requestUrl) return CSP[kind];
  let socketOrigin: string | null = null;
  try {
    const url = new URL(requestUrl);
    socketOrigin = `${url.protocol === 'http:' ? 'ws:' : 'wss:'}//${url.host}`;
  } catch { socketOrigin = null; }
  return socketOrigin ? CSP.console.replace("connect-src 'self'", `connect-src 'self' ${socketOrigin}`) : CSP.console;
}

/** Copia la respuesta (las de ASSETS y Durable Objects tienen cabeceras inmutables) y añade las cabeceras de seguridad. */
export function withSecurityHeaders(response: Response, path: string, requestId: string, requestUrl?: string): Response {
  // 101 (WebSocket aceptado): la respuesta del Durable Object lleva el socket y no admite copia ni cabeceras nuevas.
  if (response.status === 101) return response;
  const kind = surfaceOf(path);
  const out = new Response(response.body, response);
  const headers = out.headers;
  headers.set('content-security-policy', cspFor(kind, requestUrl));
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('x-frame-options', kind === 'simulator' ? 'SAMEORIGIN' : 'DENY');
  // same-origin: el enlace del simulador lleva el id de sesión en la URL y no debe salir en el Referer.
  headers.set('referrer-policy', 'same-origin');
  headers.set('cross-origin-opener-policy', 'same-origin');
  headers.set('cross-origin-resource-policy', 'same-origin');
  headers.set('permissions-policy', `camera=(), microphone=${kind === 'simulator' ? '(self)' : '()'}, geolocation=(), payment=(), usb=()`);
  if (kind === 'api' && !headers.has('cache-control')) headers.set('cache-control', 'no-store');
  headers.set('x-request-id', requestId);
  return out;
}

export function createApp(demo = false) {
  const app = new Hono<AuthContext>();
  app.onError((error, c) => {
    const requestId = c.get('requestId');
    if (error instanceof HttpError) return c.json({ error: error.message }, error.status);
    const known = error instanceof DomainError || error instanceof ScenarioError || error instanceof SessionNameError;
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
    // Reasignar c.res copiaría la respuesta 101 y perdería el WebSocket: se deja tal cual.
    if (c.res.status !== 101) c.res = withSecurityHeaders(c.res, c.req.path, requestId, c.req.url);
    const identity = c.get('identity') as Identity | undefined;
    console.log(JSON.stringify({
      code: 'REQUEST', requestId, method: c.req.method, path: c.req.path, status: c.res.status, durationMs: Date.now() - started,
      tenantId: identity?.tenantId ?? null, userId: identity?.id ?? null
    }));
  });

  app.get('/api/health', c => c.json({ ok: true }));
  app.post('/api/auth/login', async c => {
    const rejected = csrfRejection(c.req.raw);
    if (rejected) return c.json({ error: rejected }, 403);
    const body = await readJson(c) as { email?: unknown; code?: unknown };
    const email = normalizeEmail(body?.email) ?? 'invalid';
    if (!await consumeLoginAttempt(c.env, email, c.req.header('cf-connecting-ip') ?? 'unknown'))
      return c.json({ error: 'Demasiados intentos. Espera un minuto.' }, 429);
    if (c.env.AUTH_LIMITER) {
      const { success } = await c.env.AUTH_LIMITER.limit({ key: email });
      if (!success) return c.json({ error: 'Demasiados intentos. Espera un minuto.' }, 429);
    }
    if (c.env.AUTH_IP_LIMITER) {
      const { success } = await c.env.AUTH_IP_LIMITER.limit({ key: c.req.header('cf-connecting-ip') ?? 'local' });
      if (!success) return c.json({ error: 'Demasiados intentos. Espera un minuto.' }, 429);
    }
    if (await signInWithCode(c, body?.email, body?.code) !== 'ok') return c.json({ error: 'Correo o código no válido.' }, 401);
    return c.json({ ok: true });
  });
  app.post('/api/auth/logout', async c => {
    const rejected = csrfRejection(c.req.raw);
    if (rejected) return c.json({ error: rejected }, 403);
    await signOut(c);
    return c.json({ ok: true });
  });
  // Simulador WebGL: static assets y, para ficheros de más de 25 MiB, R2 (ver worker/simulator.ts).
  app.on(['GET', 'HEAD'], ['/simulador', '/simulador/*'], async c => {
    if (!await identityFor(c, demo)) {
      const next = `${c.req.path}${new URL(c.req.url).search}`;
      return c.redirect(`/?next=${encodeURIComponent(next)}`, 302);
    }
    return serveSimulator(c.req.raw, c.env);
  });
  // ---------------------------------------------------------------------------------------------
  // Acceso invitado (worker/guests.ts): rutas públicas, sin identidad. Mismas reglas CSRF que el resto; límite de
  // borde por IP (AUTH_IP_LIMITER) y, contra la fuerza bruta del PIN, fallos por IP contados en D1.
  // ---------------------------------------------------------------------------------------------
  const clientIp = (c: Context<AuthContext>) => c.req.header('cf-connecting-ip') ?? 'local';
  const joinGate = async (c: Context<AuthContext>): Promise<Response | null> => {
    if (c.env.AUTH_IP_LIMITER) {
      const { success } = await c.env.AUTH_IP_LIMITER.limit({ key: clientIp(c) });
      if (!success) return c.json({ error: JOIN_BLOCKED }, 429);
    }
    if (await joinBlocked(c.env, clientIp(c))) return c.json({ error: JOIN_BLOCKED }, 429);
    return null;
  };
  app.get('/api/join/:pin', async c => {
    const gate = await joinGate(c);
    if (gate) return gate;
    const session = await sessionByPin(c.env, c.req.param('pin'));
    if (!session) {
      await recordJoinFailure(c.env, clientIp(c));
      return c.json({ error: PIN_INVALID }, 404);
    }
    return c.json({ scenarioTitle: session.scenarioTitle, sessionName: session.name ?? null, status: session.status });
  });
  app.post('/api/join', async c => {
    const rejected = csrfRejection(c.req.raw);
    if (rejected) return c.json({ error: rejected }, 403);
    const gate = await joinGate(c);
    if (gate) return gate;
    const body = await readJson(c) as { pin?: unknown; alias?: unknown } | null;
    // El alias se valida antes que el PIN: un alias no válido no debe revelar si el PIN existe.
    const alias = parseAlias(body?.alias);
    if (!alias) return c.json({ error: ALIAS_INVALID }, 400);
    const session = await sessionByPin(c.env, body?.pin);
    if (!session) {
      await recordJoinFailure(c.env, clientIp(c));
      return c.json({ error: PIN_INVALID }, 404);
    }
    // El mismo navegador vuelve a entrar en su sesión (recarga, QR escaneado otra vez): conserva su participante.
    const current = await guestFromCookie(c);
    if (current?.guest?.sessionId === session.sessionId) {
      c.set('identity', current);
      return c.json({ sessionId: session.sessionId, alias: current.name, participantId: current.id }, 201);
    }
    // Cualquier otra cookie (miembro u otro invitado) deja de valer: el navegador queda solo con el invitado nuevo.
    await dropCurrentSession(c);
    const { identity, token } = await createGuest(c.env, session, alias);
    // Unión inmediata en el motor, para que aparezca en directo en la consola del instructor.
    const joined = await room(c.env, session.tenantId, session.sessionId, {
      op: 'command', tenantId: session.tenantId, actor: identity, command: { id: crypto.randomUUID(), type: 'join' }
    });
    if (!joined.ok) {
      await c.env.DB.prepare('DELETE FROM guests WHERE id = ?').bind(identity.id).run();
      return c.json({ error: PIN_INVALID }, 404);
    }
    await persistCommandEvent(c.env, c.get('requestId'), identity, session.sessionId, 'join', joined);
    setGuestCookie(c, token);
    c.set('identity', identity);
    await audit(c.env, identity, session.sessionId, 'guest_joined', { participantId: identity.id });
    return c.json({ sessionId: session.sessionId, alias: identity.name, participantId: identity.id }, 201);
  });
  app.use('/api/*', async (c, next) => {
    const rejected = csrfRejection(c.req.raw);
    if (rejected) {
      console.warn(JSON.stringify({ code: 'CSRF_REJECTED', requestId: c.get('requestId'), method: c.req.method, path: c.req.path }));
      return c.json({ error: rejected }, 403);
    }
    const identity = await identityFor(c, demo);
    if (!identity) return c.json({ error: 'Acceso no autorizado.' }, 401);
    c.set('identity', identity);
    // Un invitado solo puede usar su sesión (lista cerrada de rutas en guests.ts).
    if (identity.guest && !guestAllowed(c.req.method, c.req.path, identity.guest.sessionId)) {
      console.warn(JSON.stringify({ code: 'GUEST_SCOPE_REJECTED', requestId: c.get('requestId'), method: c.req.method, path: c.req.path }));
      return c.json({ error: GUEST_SCOPE_ERROR }, 403);
    }
    if (!demo && c.env.API_LIMITER) {
      const { success } = await c.env.API_LIMITER.limit({ key: identity.id });
      if (!success) {
        console.warn(JSON.stringify({ code: 'RATE_LIMITED', userId: identity.id, path: c.req.path }));
        return c.json({ error: 'Demasiadas peticiones. Espera unos segundos.' }, 429);
      }
    }
    await next();
  });
  app.get('/api/me', c => {
    const identity = c.get('identity');
    if (identity.guest) {
      // Invitado: campos en plano (contrato de /unirse y /jugar) y `identity` sin correo ni organización.
      const { id, name } = identity;
      const sessionId = identity.guest.sessionId;
      return c.json({
        id, name, role: 'participant', guest: true, sessionId, flags: flags(c.env), demo,
        identity: { id, name, role: 'participant', guest: true, sessionId },
        permissions: { participate: true, manageSessions: false, manageMembers: false, assignInstructor: false, viewAccessAudit: false }
      });
    }
    return c.json({ identity, demo, flags: flags(c.env), permissions: {
      participate: true,
      manageSessions: identity.role === 'instructor',
      manageMembers: identity.role === 'instructor',
      assignInstructor: identity.role === 'instructor' && isOwnerEmail(c.env, identity.email),
      viewAccessAudit: identity.role === 'instructor'
    } });
  });
  // La región la fija el proyecto Soniox de la clave: SONIOX_REGION debe coincidir con él («eu» por defecto).
  const voiceService = (env: Env) => env.SONIOX_API_KEY
    ? { key: env.SONIOX_API_KEY, ...SONIOX_REGIONS[env.SONIOX_REGION === 'us' ? 'us' : 'eu'] }
    : demo && env.SONIOX_TEST_API_KEY
      ? { key: env.SONIOX_TEST_API_KEY, ...SONIOX_REGIONS.us }
      : null;
  app.get('/api/voice/config', c => {
    const service = voiceService(c.env);
    return c.json({ enabled: Boolean(service), region: service?.region ?? 'eu', websocketUrl: service?.websocketUrl ?? null });
  });
  app.post('/api/voice/temporary-key', async c => {
    const service = voiceService(c.env);
    if (!service) return c.json({ error: 'El reconocimiento de voz todavía no está disponible.' }, 503);
    const body = await readJson(c) as { sessionId?: unknown };
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const identity = c.get('identity');
    if (identity.role !== 'participant') return c.json({ error: 'La respuesta por voz está reservada al participante.' }, 403);
    if (identity.guest && sessionId !== identity.guest.sessionId) return c.json({ error: GUEST_SCOPE_ERROR }, 403);
    if (!/^[\w-]{8,80}$/.test(sessionId) || !await sessionFor(c.env, identity.tenantId, sessionId))
      return c.json({ error: 'Sesión no encontrada.' }, 404);
    if (c.env.VOICE_LIMITER) {
      const { success } = await c.env.VOICE_LIMITER.limit({ key: identity.id });
      if (!success) return c.json({ error: 'Demasiados intentos de voz. Espera un minuto.' }, 429);
    }
    const upstream = await fetch(`${service.api}/v1/auth/temporary-api-key`, {
      method: 'POST',
      headers: { authorization: `Bearer ${service.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        usage_type: 'transcribe_websocket',
        expires_in_seconds: 60,
        single_use: true,
        max_session_duration_seconds: 600,
        client_reference_id: identity.id
      })
    });
    if (!upstream.ok) {
      console.warn(JSON.stringify({ code: 'SONIOX_TEMP_KEY_FAILED', region: service.region, status: upstream.status, requestId: c.get('requestId') }));
      return c.json({ error: 'No se ha podido activar el micrófono. Inténtalo de nuevo.' }, 502);
    }
    const data = await upstream.json() as { api_key?: unknown; expires_at?: unknown };
    if (typeof data.api_key !== 'string' || !data.api_key.startsWith('snx_temp_'))
      return c.json({ error: 'Soniox no devolvió una credencial temporal válida.' }, 502);
    return c.json({ apiKey: data.api_key, websocketUrl: service.websocketUrl, expiresAt: data.expires_at });
  });
  // Respuesta libre por voz: Clef asigna la frase del participante a una de las opciones que está viendo.
  // Las opciones salen del estado de la sesión en el servidor (vista del participante), nunca del cliente.
  // La frase no se registra en logs ni eventos; la decisión se sigue registrando por el camino normal (Unity).
  app.post('/api/voice/interpret', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'participant') return c.json({ error: 'La respuesta por voz está reservada al participante.' }, 403);
    if (!c.env.AI) return c.json({ error: 'La interpretación de respuestas libres no está disponible.' }, 503);
    const body = await readJson(c) as { sessionId?: unknown; phrase?: unknown };
    const sessionId = typeof body.sessionId === 'string' ? body.sessionId : '';
    const phrase = typeof body.phrase === 'string' ? body.phrase.trim().slice(0, MAX_PHRASE_LENGTH) : '';
    if (!phrase) return c.json({ error: 'No se ha recibido ninguna frase.' }, 400);
    if (identity.guest && sessionId !== identity.guest.sessionId) return c.json({ error: GUEST_SCOPE_ERROR }, 403);
    if (!/^[\w-]{8,80}$/.test(sessionId) || !await sessionFor(c.env, identity.tenantId, sessionId))
      return c.json({ error: 'Sesión no encontrada.' }, 404);
    const current = await room(c.env, identity.tenantId, sessionId, { op: 'state', tenantId: identity.tenantId, actor: identity });
    if (!current.ok) return current;
    const { state } = await current.json() as { state: SessionState };
    const phase = state.status === 'active' ? state.scenario.phases[state.phaseIndex] : undefined;
    if (!phase?.options.length) return c.json({ error: 'Ahora mismo no hay opciones entre las que elegir.' }, 409);
    let result: unknown;
    try {
      result = await c.env.AI.run(CLEF_MODEL, clefRequest(phase, phrase));
    } catch (error) {
      console.warn(JSON.stringify({ code: 'CLEF_FAILED', requestId: c.get('requestId'), message: String(error).slice(0, 200) }));
      return c.json({ error: 'No he podido interpretar la respuesta. Di el número de la opción.' }, 502);
    }
    const intent = interpretClef(result, phase.options.length);
    return c.json({ ...intent, phaseId: phase.id });
  });
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
    if (role === 'instructor' && current?.role !== 'instructor' && !isOwnerEmail(c.env, identity.email)) throw new HttpError(403, 'Solo el propietario puede asignar el rol docente.');

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
    await revokeCodes(c.env, tenantId, userId);
    await audit(c.env, identity, null, 'member_deleted', { userId, role: member.role, userDeleted: (account.meta.changes ?? 0) > 0 });
    return c.json({ deleted: true });
  });

  app.get('/api/access-codes', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const [codes, events] = await Promise.all([
      codeSummaries(c.env, identity.tenantId),
      c.env.DB.prepare(`SELECT uses.code_id AS codeId, uses.user_id AS userId, uses.at, uses.outcome,
        users.display_name AS name FROM access_code_uses uses LEFT JOIN users ON users.id = uses.user_id
        WHERE uses.tenant_id = ? ORDER BY uses.at DESC LIMIT 100`).bind(identity.tenantId).all()
    ]);
    return c.json({ codes, uses: events.results });
  });
  app.post('/api/access-codes/:userId', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const userId = c.req.param('userId');
    const member = await c.env.DB.prepare(`SELECT users.email, memberships.role FROM memberships JOIN users ON users.id = memberships.user_id
      WHERE memberships.tenant_id = ? AND memberships.user_id = ?`).bind(identity.tenantId, userId).first<{ email: string; role: string }>();
    if (!member) return c.json({ error: 'Miembro no encontrado.' }, 404);
    if (member.role === 'instructor' && !isOwnerEmail(c.env, identity.email)) return c.json({ error: 'Solo el propietario puede crear códigos de docentes.' }, 403);
    const { code, id } = await issueCode(c.env, identity.tenantId, userId);
    await audit(c.env, identity, null, 'access_code_issued', { userId, codeId: id });
    return c.json({ code, codeId: id }, 201);
  });
  app.delete('/api/access-codes/:userId', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const userId = c.req.param('userId');
    const member = await c.env.DB.prepare(`SELECT users.email, memberships.role FROM memberships JOIN users ON users.id = memberships.user_id
      WHERE memberships.tenant_id = ? AND memberships.user_id = ?`).bind(identity.tenantId, userId).first<{ email: string; role: string }>();
    if (!member) return c.json({ error: 'Miembro no encontrado.' }, 404);
    if (member.role === 'instructor' && !isOwnerEmail(c.env, identity.email)) return c.json({ error: 'Solo el propietario puede revocar códigos de docentes.' }, 403);
    if (userId === identity.id) return c.json({ error: 'No puedes revocar tu propio acceso.' }, 400);
    await revokeCodes(c.env, identity.tenantId, userId);
    await audit(c.env, identity, null, 'access_code_revoked', { userId });
    return c.json({ revoked: true });
  });

  // Listado de la consola (worker/sessions.ts): una consulta a D1, sin llamadas a los Durable Objects.
  // Instructor: todas las sesiones de la organización, con recuentos. Participante: solo aquellas a las que se ha
  // unido, sin recuentos de la clase (en el modo demo local, todas, para que Unity siga la más reciente sin enlace).
  app.get('/api/sessions', async c => {
    const identity = c.get('identity');
    return c.json({ sessions: await sessionRows(c.env, identity, { allForParticipant: demo }) });
  });
  // Analítica agregada de la organización (worker/analytics.ts): solo D1, solo instructor, sin datos por persona.
  app.get('/api/analytics', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    let query: AnalyticsQuery;
    try {
      query = parseAnalyticsQuery(c.req.query());
    } catch (error) {
      if (error instanceof AnalyticsQueryError) return c.json({ error: error.message }, 400);
      throw error;
    }
    const body = await organizationAnalytics(c.env, identity.tenantId, query);
    c.header('cache-control', 'private, no-store');
    return c.json(body);
  });
  /**
   * Crea la sesión en D1 y en su Durable Object. Respuesta 201: el cuerpo del Durable Object (roomPayload del
   * instructor) más `session`, la fila del listado.
   */
  const createSessionResponse = async (env: Env, identity: Identity, scenario: Scenario, name: string | null, action: string, detail: Record<string, unknown>) => {
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await env.DB.prepare('INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at,name) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, identity.tenantId, identity.id, scenario.id, scenario.version, 'active', createdAt, name).run();
    const response = await room(env, identity.tenantId, id, { op: 'create', id, tenantId: identity.tenantId, actor: identity, scenario });
    if (!response.ok) {
      await env.DB.prepare('DELETE FROM sessions WHERE id = ? AND tenant_id = ?').bind(id, identity.tenantId).run();
      return response;
    }
    // El nombre es texto libre: no va a la auditoría, solo si la sesión tiene uno.
    await audit(env, identity, id, action, { ...detail, scenarioId: scenario.id, version: scenario.version, named: name !== null });
    const payload = await response.json() as Record<string, unknown>;
    return Response.json({ ...payload, session: await sessionRow(env, identity, id) }, { status: 201 });
  };
  app.post('/api/sessions', async c => {
    const identity = c.get('identity');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const body = await readJson(c, true) as { scenarioId?: unknown; name?: unknown } | null;
    const name = parseSessionName(body?.name, false);
    const scenarioId = typeof body?.scenarioId === 'string' ? body.scenarioId : defaultScenario.id;
    const scenario = await getScenario(c.env, identity.tenantId, scenarioId);
    if (!scenario) return c.json({ error: 'Escenario no encontrado.' }, 404);
    return createSessionResponse(c.env, identity, scenario, name, 'session_created', {});
  });
  // Renombrar: quien puede gestionar la sesión (canManage). Devuelve la fila del listado.
  app.patch('/api/sessions/:id', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const session = await sessionFor(c.env, identity.tenantId, id);
    if (!session) return c.json({ error: 'Sesión no encontrada.' }, 404);
    if (!await canManage(c.env, identity, session)) return c.json({ error: 'Solo el instructor que creó la sesión puede renombrarla.' }, 403);
    const body = await readJson(c) as { name?: unknown } | null;
    const name = parseSessionName(body?.name, true);
    await c.env.DB.prepare('UPDATE sessions SET name = ? WHERE tenant_id = ? AND id = ?').bind(name, identity.tenantId, id).run();
    await audit(c.env, identity, id, 'session_renamed', {});
    return c.json({ session: await sessionRow(c.env, identity, id) });
  });
  // Duplicar: cualquier instructor de la organización. Misma versión del escenario y nombre «… (copia)».
  app.post('/api/sessions/:id/duplicate', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const source = await c.env.DB.prepare('SELECT scenario_id AS scenarioId, scenario_version AS scenarioVersion, name FROM sessions WHERE tenant_id = ? AND id = ?')
      .bind(identity.tenantId, id).first<{ scenarioId: string; scenarioVersion: number; name: string | null }>();
    if (!source) return c.json({ error: 'Sesión no encontrada.' }, 404);
    const scenario = await getScenarioVersion(c.env, identity.tenantId, source.scenarioId, source.scenarioVersion);
    if (!scenario) return c.json({ error: 'Escenario no encontrado.' }, 404);
    return createSessionResponse(c.env, identity, scenario, copyName(source.name ?? scenario.title), 'session_duplicated', { sourceSessionId: id });
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
  // PIN de unión de invitados (worker/guests.ts). Cualquier instructor de la organización. GET lo crea si falta;
  // POST lo regenera (revoca el anterior). Una sesión finalizada ya no admite invitados (409).
  const pinResponse = async (c: Context<AuthContext>, regenerate: boolean) => {
    const identity = c.get('identity');
    const id = c.req.param('id') ?? '';
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const session = await c.env.DB.prepare('SELECT status FROM sessions WHERE tenant_id = ? AND id = ?').bind(identity.tenantId, id).first<{ status: string }>();
    if (!session) return c.json({ error: 'Sesión no encontrada.' }, 404);
    if (session.status === 'complete') return c.json({ error: 'La sesión ha finalizado y ya no admite invitados.' }, 409);
    if (regenerate) await readJson(c, true);
    const pin = await ensurePin(c.env, identity.tenantId, id, regenerate);
    if (regenerate) await audit(c.env, identity, id, 'session_pin_regenerated', {});
    c.header('cache-control', 'private, no-store');
    return c.json({ pin, joinUrl: `${new URL(c.req.url).origin}/unirse/${pin}` });
  };
  app.get('/api/sessions/:id/pin', c => pinResponse(c, false));
  app.post('/api/sessions/:id/pin', c => pinResponse(c, true));
  // Tiempo real: WebSocket con la vista de la sesión de cada identidad (ver roomPayload y SessionRoom.openLive).
  // Mismas comprobaciones que GET /api/sessions/:id (identidad, límite de peticiones y sesión de su organización)
  // y, como un WebSocket no pasa por la comprobación CSRF de tipo de contenido, Origin igual al propio origen.
  app.get('/api/sessions/:id/live', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!flags(c.env).realtime_websocket) return c.json({ error: 'El tiempo real no está activado.' }, 404);
    const rejected = liveRejection(c.req.raw, demo);
    if (rejected) {
      if (rejected.status === 403) console.warn(JSON.stringify({ code: 'WS_ORIGIN_REJECTED', requestId: c.get('requestId'), path: c.req.path }));
      return c.json({ error: rejected.message }, rejected.status);
    }
    if (!await sessionFor(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    // Asegura el estado en el Durable Object (y recupera las sesiones anteriores a la jurisdicción UE) antes del upgrade.
    const ready = await room(c.env, identity.tenantId, id, { op: 'state', tenantId: identity.tenantId, actor: identity });
    if (!ready.ok) return ready;
    const namespace = sessionNamespace(c.env);
    const stub = namespace.get(namespace.idFromName(`${identity.tenantId}:${id}`));
    // Petición interna nueva: solo lleva la identidad que fija el Worker, nunca cabeceras del cliente.
    const actor: RoomActor = { id: identity.id, name: identity.name, role: identity.role, tenantId: identity.tenantId };
    return stub.fetch('https://room.internal/live', { headers: { upgrade: 'websocket', [ROOM_ACTOR_HEADER]: JSON.stringify(actor) } });
  });
  // Clase simulada para demostraciones (worker/demo-class.ts). Solo el instructor que creó la sesión.
  app.post('/api/sessions/:id/demo-class', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const session = await sessionFor(c.env, identity.tenantId, id);
    if (!session) return c.json({ error: 'Sesión no encontrada.' }, 404);
    if (session.instructorId !== identity.id) return c.json({ error: 'Solo el instructor de la sesión puede añadir una clase simulada.' }, 403);
    const body = await readJson(c, true) as { count?: unknown } | null;
    const count = body?.count === undefined ? DEFAULT_SIMULATED : body.count;
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > MAX_SIMULATED)
      return c.json({ error: `Indica entre 1 y ${MAX_SIMULATED} participantes simulados.` }, 400);
    const response = await room(c.env, identity.tenantId, id, { op: 'demo-add', tenantId: identity.tenantId, actor: identity, count });
    if (!response.ok) return response;
    const payload = await response.json() as { demoClass?: { added?: number } };
    await audit(c.env, identity, id, 'demo_class_added', { count: payload.demoClass?.added ?? 0 });
    return c.json(payload, 201);
  });
  app.delete('/api/sessions/:id/demo-class', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (identity.role !== 'instructor') return c.json({ error: 'Acción reservada al instructor.' }, 403);
    const session = await sessionFor(c.env, identity.tenantId, id);
    if (!session) return c.json({ error: 'Sesión no encontrada.' }, 404);
    if (session.instructorId !== identity.id) return c.json({ error: 'Solo el instructor de la sesión puede retirar la clase simulada.' }, 403);
    const response = await room(c.env, identity.tenantId, id, { op: 'demo-remove', tenantId: identity.tenantId, actor: identity });
    if (!response.ok) return response;
    const payload = await response.json() as { demoClass?: { removed?: number } };
    await audit(c.env, identity, id, 'demo_class_removed', { count: payload.demoClass?.removed ?? 0 });
    return c.json(payload);
  });
  app.post('/api/sessions/:id/commands', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await sessionFor(c.env, identity.tenantId, id)) return c.json({ error: 'Sesión no encontrada.' }, 404);
    const command = parseCommand(await readJson(c));
    if (identity.guest && command.type !== 'join' && command.type !== 'decide') return c.json({ error: GUEST_SCOPE_ERROR }, 403);
    // La respuesta también pasa por roomPayload: el participante recibe solo su vista filtrada.
    const response = await room(c.env, identity.tenantId, id, { op: 'command', tenantId: identity.tenantId, actor: identity, command, client: clientKind(c.req.header('x-axyro-client')) });
    await persistCommandEvent(c.env, c.get('requestId'), identity, id, command.type, response);
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

/**
 * Motivo de rechazo del upgrade a WebSocket, o null si se acepta. Exige `Upgrade: websocket` y un `Origin` igual al
 * origen de la propia petición (un sitio ajeno no puede abrir el socket con la cookie de la persona). En la demo
 * local (createApp(true)) se admite además cualquier origen de 127.0.0.1/localhost, por el proxy de Vite.
 */
export function liveRejection(request: Request, demo = false): { status: 403 | 426; message: string } | null {
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return { status: 426, message: 'Se esperaba una conexión WebSocket.' };
  const origin = request.headers.get('origin');
  let allowed = false;
  try {
    const own = new URL(request.url);
    const from = origin ? new URL(origin) : null;
    allowed = Boolean(from && from.origin === own.origin)
      || Boolean(demo && from && ['127.0.0.1', 'localhost', '[::1]'].includes(from.hostname) && from.hostname === own.hostname);
  } catch { allowed = false; }
  return allowed ? null : { status: 403, message: 'Conexión de otro origen rechazada.' };
}

/** Comandos cuyo evento se escribe en D1 desde la API además de por la cola (ver POST /api/sessions/:id/commands). */
const PERSISTED_COMMAND_EVENTS: Partial<Record<Command['type'], SimEvent['type']>> = {
  join: 'participant_joined',
  advance: 'phase_advanced',
  pause: 'paused',
  resume: 'resumed',
  complete: 'completed'
};

/**
 * La cola persiste eventos de forma asíncrona. La unión, el avance de fase, la pausa, la reanudación y el
 * final se escriben también desde la API (persistEvent: INSERT OR IGNORE sobre (session_id, seq) y estado ordenado
 * por seq), para que el listado refleje enseguida la sesión del participante, la fase y `sessions.status`.
 */
async function persistCommandEvent(env: Env, requestId: string, identity: Identity, sessionId: string, type: Command['type'], response: Response): Promise<void> {
  const persisted = PERSISTED_COMMAND_EVENTS[type];
  if (!response.ok || !persisted) return;
  const payload = await response.clone().json() as { state?: { events?: SimEvent[] } };
  const event = payload.state?.events?.findLast(item => item.type === persisted && item.actorId === identity.id);
  if (!event) return;
  try {
    await persistEvent(env, { tenantId: identity.tenantId, sessionId, event: queueSafeEvent(event) });
  } catch (error) {
    // La cola lo reintentará: el comando ya se aplicó en el Durable Object.
    console.error(JSON.stringify({ code: 'EVENT_DIRECT_PERSIST_FAILED', requestId, sessionId, seq: event.seq, message: String(error) }));
  }
}

function clientKind(value?: string): 'unity' | undefined {
  return value === 'unity' ? 'unity' : undefined;
}

export async function purgeSession(env: Env, tenantId: string, id: string): Promise<void> {
  await room(env, tenantId, id, { op: 'purge', tenantId });
  await env.DB.batch([
    env.DB.prepare('DELETE FROM simulation_events WHERE tenant_id = ? AND session_id = ?').bind(tenantId, id),
    env.DB.prepare('DELETE FROM sessions WHERE tenant_id = ? AND id = ?').bind(tenantId, id),
    // Acceso invitado: el PIN y los invitados (alias y hash del token) desaparecen con la sesión.
    ...purgeStatements(env, tenantId, id)
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
  await pruneAuth(env, now);
  await pruneGuests(env, now);
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
  const send = (target: DurableObjectStub, payload: unknown) => target.fetch('https://room.internal/', {
    method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' }
  });
  const response = await send(stub, body);
  if (env.SESSIONS_JURISDICTION !== 'eu') return response;
  const op = (body as { op?: string }).op;
  const legacy = env.SESSIONS.get(env.SESSIONS.idFromName(`${tenantId}:${id}`));
  if (op === 'purge') {
    const oldResponse = await send(legacy, body);
    return response.ok ? response : oldResponse;
  }
  if (response.status !== 404 || (op !== 'state' && op !== 'command')) return response;

  // Las sesiones anteriores a la jurisdicción UE conservan su estado en el namespace original.
  // Recuperamos una instantánea completa solo tras comprobar que D1 la atribuye a esta organización.
  const session = await sessionFor(env, tenantId, id);
  if (!session) return response;
  const instructor = { id: session.instructorId, name: 'Recuperación', role: 'instructor' as const };
  const oldStateResponse = await send(legacy, { op: 'state', tenantId, actor: instructor });
  if (!oldStateResponse.ok) return response;
  const oldPayload = await oldStateResponse.json() as { state?: { id?: string; tenantId?: string } };
  if (oldPayload.state?.id !== id || oldPayload.state.tenantId !== tenantId) return response;
  const restored = await send(stub, { op: 'restore', id, tenantId, actor: instructor, snapshot: oldPayload.state });
  if (!restored.ok) return restored;
  console.log(JSON.stringify({ code: 'LEGACY_SESSION_RESTORED', sessionId: id }));
  return send(stub, body);
}

async function audit(env: Env, identity: Identity, sessionId: string | null, action: string, detail: Record<string, unknown>): Promise<void> {
  await env.DB.prepare('INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES (?,?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), identity.tenantId, identity.id, sessionId, action, new Date().toISOString(), JSON.stringify(detail)).run();
}
