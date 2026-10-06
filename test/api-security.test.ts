import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));

// Access simulado: el token «valid:<correo>» es un JWT válido para ese correo; cualquier otro se rechaza.
const jose = vi.hoisted(() => ({ jwksCreated: [] as string[], verifyOptions: [] as unknown[] }));
vi.mock('jose', () => ({
  createRemoteJWKSet: (url: URL) => { jose.jwksCreated.push(url.toString()); return 'jwks'; },
  jwtVerify: async (token: string, _keys: unknown, options: unknown) => {
    jose.verifyOptions.push(options);
    if (!token.startsWith('valid:')) throw new Error('firma no válida');
    return { payload: { email: token.slice('valid:'.length) } };
  }
}));

const { applyRetention, createApp, csrfRejection } = await import('../worker/app');

// El Worker escribe un log JSON por petición; en los tests solo hace ruido.
beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
const { catalogScenarios } = await import('../shared/simulation');

// ---------------------------------------------------------------------------------------------
// D1 sobre SQLite en memoria (node:sqlite) con las migraciones reales: las consultas con subconsultas
// y condiciones (último instructor, autoalta) se ejecutan de verdad.
// ---------------------------------------------------------------------------------------------
type Row = Record<string, unknown>;

function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  const isQuery = (sql: string) => /^\s*SELECT/i.test(sql);
  const statement = (sql: string, args: unknown[] = []) => {
    const params = args as (string | number | null)[];
    const run = () => {
      const result = db.prepare(sql).run(...params);
      return { success: true, results: [], meta: { changes: Number(result.changes) } };
    };
    const all = () => ({ success: true, results: db.prepare(sql).all(...params).map(row => ({ ...row })) as Row[], meta: { changes: 0 } });
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      first: async () => { const row = db.prepare(sql).get(...params); return row ? { ...row } : null; },
      all: async () => all(),
      run: async () => run(),
      execute: () => (isQuery(sql) ? all() : run())
    };
  };
  const d1 = {
    prepare: (sql: string) => statement(sql),
    batch: async (items: ReturnType<typeof statement>[]) => {
      db.exec('BEGIN');
      try {
        const results = items.map(item => item.execute());
        db.exec('COMMIT');
        return results;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    }
  };
  return { d1, db };
}

/** Durable Objects simulados: registran cada operación; «boom» falla para probar el 500. */
function fakeSessions() {
  const calls: { name: string; op: string }[] = [];
  const jurisdictions: string[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { op: string; command?: { type: string }; actor?: { id: string } };
        calls.push({ name, op: body.op });
        if (name.includes('boom')) throw new Error('fallo interno simulado');
        if (body.op === 'purge') return Response.json({ purged: true });
        const joined = body.op === 'command' && body.command?.type === 'join' && body.actor?.id;
        return Response.json({ state: { id: name.split(':')[1], events: joined ? [{ seq: 2, type: 'participant_joined', at: NEWER, actorId: body.actor!.id, detail: { participantId: body.actor!.id } }] : [] }, report: { score: 0 } });
      }
    }),
    jurisdiction: (value: string) => { jurisdictions.push(value); return namespace; }
  };
  return { namespace, calls, jurisdictions };
}

const OLD = '2026-01-01T00:00:00.000Z';
const NEWER = '2026-02-01T00:00:00.000Z';

function seed(db: DatabaseSync, withOwner = true) {
  db.exec(`INSERT INTO tenants (id,name,created_at) VALUES ('ufv','UFV','${OLD}'), ('other','Otra','${NEWER}')`);
  const users: [string, string, string, string, string][] = [
    ['u-owner', 'owner@identy.cloud', 'Propietario', 'ufv', 'instructor'],
    ['u-prof', 'prof@ufv.es', 'Profesora', 'ufv', 'instructor'],
    ['u-alumna', 'alumna@ufv.es', 'Alumna', 'ufv', 'participant'],
    ['u-otro', 'otro@other.org', 'Otro', 'other', 'instructor']
  ];
  for (const [id, email, name, tenant, role] of users) {
    if (!withOwner && id === 'u-owner') continue;
    db.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').run(id, email, name, OLD);
    db.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').run(tenant, id, role);
  }
}

function setup(options: { withOwner?: boolean; vars?: Record<string, string> } = {}) {
  const { d1, db } = createD1();
  seed(db, options.withOwner ?? true);
  const sessions = fakeSessions();
  const assets: string[] = [];
  const env = {
    DB: d1,
    SESSIONS: sessions.namespace,
    ASSETS: { fetch: async (request: Request) => { assets.push(new URL(request.url).pathname); return new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } }); } },
    ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com',
    ACCESS_AUD: 'aud-de-prueba',
    BOOTSTRAP_OWNER_EMAIL: 'owner@identy.cloud',
    ALLOWED_EMAIL_DOMAINS: 'ufv.es',
    LEGACY_ACCESS_AUTH: 'true',
    ACCESS_CODE_PEPPER: 'test-only-pepper-with-at-least-32-characters',
    ...options.vars
  };
  const app = createApp(false);
  const call = (method: string, path: string, init: { as?: string; body?: unknown; raw?: string; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' };
    if (init.as) headers['cf-access-jwt-assertion'] = `valid:${init.as}`;
    const hasBody = init.body !== undefined || init.raw !== undefined;
    if (hasBody) headers['content-type'] = 'application/json';
    Object.assign(headers, init.headers);
    for (const [key, value] of Object.entries(headers)) if (value === '') delete headers[key];
    const body = init.raw ?? (init.body !== undefined ? JSON.stringify(init.body) : undefined);
    return app.request(`https://axyro.test${path}`, { method, headers, body }, env as never);
  };
  return { db, env, call, sessions, assets };
}

const PROF = 'prof@ufv.es';
const OWNER = 'owner@identy.cloud';
const ALUMNA = 'alumna@ufv.es';
const OTRO = 'otro@other.org';
const MEMBER_UNAVAILABLE = 'Ese correo no se puede dar de alta en esta organización.';

describe('límite de acceso por código', () => {
  it('bloquea el sexto intento consecutivo aunque el limitador de borde no responda', async () => {
    const { call, db } = setup();
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await call('POST', '/api/auth/login', { body: { email: 'prueba@example.com', code: '000000' } })).status).toBe(401);
    }
    expect((await call('POST', '/api/auth/login', { body: { email: 'prueba@example.com', code: '000000' } })).status).toBe(429);
    expect(db.prepare('SELECT MAX(attempts) AS n FROM access_login_limits').get()).toEqual({ n: 6 });
    expect((await call('POST', '/api/auth/login', { body: { email: 'otra@example.com', code: '000000' } })).status).toBe(401);
  });
});

describe('códigos personales de seis cifras', () => {
  it('emite un código único y permite entrar sin Cloudflare Access; registra cada uso', async () => {
    const prepared = setup();
    const ownerIssue = await prepared.call('POST', '/api/access-codes/u-owner', { as: OWNER, body: {} });
    const ownerCode = (await ownerIssue.json() as { code: string }).code;
    const ownerLogin = await prepared.call('POST', '/api/auth/login', { body: { email: OWNER, code: ownerCode } });
    const ownerCookie = ownerLogin.headers.get('set-cookie')?.split(';')[0] ?? '';
    prepared.env.LEGACY_ACCESS_AUTH = 'false';
    const issue = await prepared.call('POST', '/api/access-codes/u-alumna', { headers: { cookie: ownerCookie }, body: {} });
    expect(issue.status).toBe(201);
    const { code } = await issue.json() as { code: string };
    expect(code).toMatch(/^\d{6}$/);
    expect(prepared.db.prepare('SELECT code_hash FROM access_codes WHERE user_id = ?').get('u-alumna')).not.toHaveProperty('code', code);
    const wrongEmail = await prepared.call('POST', '/api/auth/login', { body: { email: PROF, code } });
    expect(wrongEmail.status).toBe(401);
    const login = await prepared.call('POST', '/api/auth/login', { body: { email: ALUMNA, code } });
    expect(login.status).toBe(200);
    const cookie = login.headers.get('set-cookie')?.split(';')[0] ?? '';
    expect(cookie).toMatch(/^axyro_session=/);
    const me = await prepared.call('GET', '/api/me', { headers: { cookie } });
    expect(me.status).toBe(200);
    expect((await me.json() as { identity: { role: string } }).identity.role).toBe('participant');
    expect((await prepared.call('POST', '/api/sessions', { headers: { cookie }, body: { scenarioId: 'x' } })).status).toBe(403);
    expect(prepared.db.prepare("SELECT COUNT(*) AS total FROM access_code_uses WHERE outcome = 'accepted'").get()).toMatchObject({ total: 2 });
    expect((await prepared.call('DELETE', '/api/access-codes/u-alumna', { headers: { cookie: ownerCookie } })).status).toBe(200);
    expect((await prepared.call('GET', '/api/me', { headers: { cookie } })).status).toBe(401);
    expect((await prepared.call('POST', '/api/auth/login', { body: { email: ALUMNA, code } })).status).toBe(401);
    expect(prepared.db.prepare("SELECT COUNT(*) AS total FROM access_code_uses WHERE outcome = 'revoked'").get()).toMatchObject({ total: 1 });
  });
});

describe('micrófono WebGL con Soniox UE', () => {
  it('solo entrega una clave temporal a participantes autenticados de una sesión propia', async () => {
    const context = setup({ vars: { SONIOX_EU_API_KEY: 'server-only-eu-key' } });
    const sessionId = 'session-12345678';
    context.db.prepare("INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES (?,?,?,'x',1,'active',?)")
      .run(sessionId, 'ufv', 'u-prof', NEWER);
    const originalFetch = globalThis.fetch;
    const upstream = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.eu.soniox.com/v1/auth/temporary-api-key');
      expect(init?.headers).toMatchObject({ authorization: 'Bearer server-only-eu-key' });
      expect(JSON.parse(String(init?.body))).toMatchObject({ usage_type: 'transcribe_websocket', single_use: true, max_session_duration_seconds: 600 });
      return Response.json({ api_key: 'snx_temp_test-key', expires_at: NEWER }, { status: 201 });
    });
    globalThis.fetch = upstream as typeof fetch;
    try {
      const config = await context.call('GET', '/api/voice/config', { as: ALUMNA });
      expect(await config.json()).toMatchObject({ enabled: true, region: 'eu', websocketUrl: 'wss://stt-rt.eu.soniox.com/transcribe-websocket' });
      expect((await context.call('POST', '/api/voice/temporary-key', { body: { sessionId } })).status).toBe(401);
      expect((await context.call('POST', '/api/voice/temporary-key', { as: PROF, body: { sessionId } })).status).toBe(403);
      expect((await context.call('POST', '/api/voice/temporary-key', { as: ALUMNA, body: { sessionId: 'missing-12345678' } })).status).toBe(404);
      const grant = await context.call('POST', '/api/voice/temporary-key', { as: ALUMNA, body: { sessionId } });
      expect(grant.status).toBe(200);
      expect(grant.headers.get('cache-control')).toBe('no-store');
      expect(await grant.json()).toMatchObject({ apiKey: 'snx_temp_test-key', websocketUrl: 'wss://stt-rt.eu.soniox.com/transcribe-websocket' });
      expect(upstream).toHaveBeenCalledTimes(1);
    } finally { globalThis.fetch = originalFetch; }
  });

  it('mantiene el micrófono inactivo sin clave UE y solo lo permite en el simulador', async () => {
    const { call } = setup();
    expect(await (await call('GET', '/api/voice/config', { as: ALUMNA })).json()).toMatchObject({ enabled: false, region: 'eu' });
    expect((await call('POST', '/api/voice/temporary-key', { as: ALUMNA, body: { sessionId: 'session-12345678' } })).status).toBe(503);
    const page = await call('GET', '/');
    const simulator = await call('GET', '/simulador/index.html', { as: ALUMNA });
    expect(page.headers.get('permissions-policy')).toContain('microphone=()');
    expect(simulator.headers.get('permissions-policy')).toContain('microphone=(self)');
    expect(simulator.headers.get('content-security-policy')).toContain('wss://stt-rt.eu.soniox.com');
  });

  it('solo en la API local permite probar la clave global sin activar esa región en producción', async () => {
    const { env } = setup({ vars: { SONIOX_TEST_API_KEY: 'local-test-key' } });
    const local = createApp(true);
    const live = createApp(false);
    const headers = { 'x-demo-user': 'participant', 'sec-fetch-site': 'same-origin' };
    const config = await local.request('http://127.0.0.1:8787/api/voice/config', { headers }, env as never);
    expect(await config.json()).toMatchObject({ enabled: true, region: 'us', websocketUrl: 'wss://stt-rt.soniox.com/transcribe-websocket' });
    const prodConfig = await live.request('https://axyro.test/api/voice/config', { headers, method: 'GET' }, env as never);
    expect(prodConfig.status).toBe(401);
    const liveAsMember = await live.request('https://axyro.test/api/voice/config', { headers: { ...headers, 'cf-access-jwt-assertion': `valid:${ALUMNA}` } }, env as never);
    expect(await liveAsMember.json()).toMatchObject({ enabled: false, region: 'eu' });
  });
});

describe('identidad con Cloudflare Access', () => {
  it('verifica el JWT solo con RS256 y reutiliza el JWKS entre peticiones', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/me', { as: PROF })).status).toBe(200);
    expect((await call('GET', '/api/me', { as: ALUMNA })).status).toBe(200);
    expect(jose.jwksCreated).toEqual(['https://equipo.cloudflareaccess.com/cdn-cgi/access/certs']);
    expect(jose.verifyOptions.at(-1)).toMatchObject({ algorithms: ['RS256'], issuer: 'https://equipo.cloudflareaccess.com', audience: 'aud-de-prueba' });
  });

  it('rechaza peticiones sin token o con un token no válido', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/me')).status).toBe(401);
    expect((await call('GET', '/api/me', { headers: { 'cf-access-jwt-assertion': 'falso' } })).status).toBe(401);
  });

  it('resuelve de forma determinista a la organización más antigua si un usuario tuviera varias membresías', async () => {
    const { db, call } = setup();
    db.exec("INSERT INTO memberships (tenant_id,user_id,role) VALUES ('other','u-alumna','instructor')");
    const me = await (await call('GET', '/api/me', { as: ALUMNA })).json() as { identity: { tenantId: string; role: string } };
    expect(me.identity).toMatchObject({ tenantId: 'ufv', role: 'participant' });
  });
});

describe('autoalta por dominio (ALLOWED_EMAIL_DOMAINS)', () => {
  it('con * admite cualquier correo verificado por Access, siempre como participante', async () => {
    const { call } = setup({ vars: { ALLOWED_EMAIL_DOMAINS: '*' } });
    for (const email of ['persona@gmail.com', 'persona@alumnos.ufv.es', 'persona@otro.org']) {
      const response = await call('GET', '/api/me', { as: email });
      expect(response.status, email).toBe(200);
      const { identity } = await response.json() as { identity: Record<string, string> };
      expect(identity).toMatchObject({ email, role: 'participant', tenantId: 'ufv' });
    }
    expect((await call('GET', '/api/me')).status).toBe(401);
  });

  it('da de alta como participante en la organización del propietario a una cuenta @ufv.es nueva', async () => {
    const { db, call } = setup();
    const response = await call('GET', '/api/me', { as: 'Ana.Garcia@UFV.es' });
    expect(response.status).toBe(200);
    const { identity } = await response.json() as { identity: Record<string, string> };
    expect(identity).toMatchObject({ tenantId: 'ufv', role: 'participant', name: 'Ana Garcia', email: 'ana.garcia@ufv.es' });
    // Un segundo acceso reutiliza el mismo usuario.
    const again = await (await call('GET', '/api/me', { as: 'ana.garcia@ufv.es' })).json() as { identity: Record<string, string> };
    expect(again.identity.id).toBe(identity.id);
    expect(db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = ?").get(identity.id)).toEqual({ n: 1 });
  });

  it('no deja entrar a otros dominios ni a subdominios o dominios parecidos', async () => {
    const { call } = setup();
    for (const email of ['alguien@gmail.com', 'alguien@alumnos.ufv.es', 'alguien@ufv.es.evil.com', 'alguien@notufv.es']) {
      expect((await call('GET', '/api/me', { as: email })).status, email).toBe(401);
    }
  });

  it('nunca promueve a instructor y no hay autoalta si no se conoce la organización', async () => {
    const { call } = setup({ withOwner: false });
    expect((await call('GET', '/api/me', { as: 'nueva@ufv.es' })).status).toBe(401);
    const withDefault = setup({ vars: { DEFAULT_TENANT_ID: 'other' } });
    const { identity } = await (await withDefault.call('GET', '/api/me', { as: 'nueva@ufv.es' })).json() as { identity: Record<string, string> };
    expect(identity).toMatchObject({ tenantId: 'other', role: 'participant' });
  });

  it('sin ALLOWED_EMAIL_DOMAINS no hay autoalta', async () => {
    const { call } = setup({ vars: { ALLOWED_EMAIL_DOMAINS: '' } });
    expect((await call('GET', '/api/me', { as: 'nueva@ufv.es' })).status).toBe(401);
  });
});

describe('membresías', () => {
  it('rechaza dar de alta a un usuario que ya pertenece a otra organización, sin revelar cuál', async () => {
    const { call } = setup();
    const response = await call('POST', '/api/memberships', { as: OTRO, body: { email: 'ALUMNA@ufv.es', name: 'Robada', role: 'participant' } });
    expect(response.status).toBe(409);
    const body = await response.json() as { error: string };
    expect(body.error).toBe(MEMBER_UNAVAILABLE);
    expect(JSON.stringify(body)).not.toContain('ufv');
    // También en el otro sentido, con un usuario creado por la otra organización.
    expect((await call('POST', '/api/memberships', { as: OTRO, body: { email: 'externo@other.org', name: 'Externo', role: 'participant' } })).status).toBe(201);
    expect((await call('POST', '/api/memberships', { as: PROF, body: { email: 'externo@other.org', name: 'Externo', role: 'instructor' } })).status).toBe(409);
  });

  it('impide que otra organización reserve el correo del propietario o cuentas con autoalta', async () => {
    const { call } = setup({ withOwner: false });
    expect((await call('POST', '/api/memberships', { as: OTRO, body: { email: OWNER, name: 'Propietario', role: 'instructor' } })).status).toBe(409);
    const withOwner = setup();
    expect((await withOwner.call('POST', '/api/memberships', { as: OTRO, body: { email: 'futura@ufv.es', name: 'Futura', role: 'participant' } })).status).toBe(409);
    expect((await withOwner.call('POST', '/api/memberships', { as: PROF, body: { email: 'futura@ufv.es', name: 'Futura', role: 'participant' } })).status).toBe(201);
  });

  it('no degrada al último instructor ni al propietario inicial', async () => {
    const { call, db } = setup();
    const last = await call('POST', '/api/memberships', { as: OTRO, body: { email: OTRO, name: 'Otro', role: 'participant' } });
    expect(last.status).toBe(409);
    expect((await last.json() as { error: string }).error).toBe('Debe quedar al menos un instructor en la organización.');
    const owner = await call('POST', '/api/memberships', { as: PROF, body: { email: OWNER, name: 'Propietario', role: 'participant' } });
    expect(owner.status).toBe(409);
    expect(db.prepare("SELECT role FROM memberships WHERE user_id = 'u-owner'").get()).toEqual({ role: 'instructor' });
    // Con otro instructor (el propietario) en la organización, la profesora sí puede pasar a participante.
    expect((await call('POST', '/api/memberships', { as: PROF, body: { email: PROF, name: 'Profesora', role: 'participant' } })).status).toBe(201);
    expect(db.prepare("SELECT role FROM memberships WHERE user_id = 'u-prof'").get()).toEqual({ role: 'participant' });
  });

  it('permite corregir el nombre al volver a dar de alta y no promueve sin pedirlo', async () => {
    const { call, db } = setup();
    const response = await call('POST', '/api/memberships', { as: PROF, body: { email: ALUMNA, name: 'Alumna Corregida', role: 'participant' } });
    expect(response.status).toBe(201);
    expect(db.prepare("SELECT display_name AS name FROM users WHERE id = 'u-alumna'").get()).toEqual({ name: 'Alumna Corregida' });
    expect(db.prepare("SELECT role FROM memberships WHERE user_id = 'u-alumna'").get()).toEqual({ role: 'participant' });
  });

  it('valida el miembro y reserva el alta al instructor', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/memberships', { as: PROF, body: { email: 'no-es-un-correo', name: 'X', role: 'participant' } })).status).toBe(400);
    expect((await call('POST', '/api/memberships', { as: PROF, body: { email: 'x@ufv.es', name: 'X', role: 'admin' } })).status).toBe(400);
    expect((await call('POST', '/api/memberships', { as: ALUMNA, body: { email: 'x@ufv.es', name: 'X', role: 'participant' } })).status).toBe(403);
  });

  it('DELETE borra la membresía y el usuario sin dejar PII en la auditoría', async () => {
    const { call, db } = setup();
    expect((await call('DELETE', '/api/memberships/u-alumna', { as: ALUMNA })).status).toBe(403);
    expect((await call('DELETE', '/api/memberships/u-alumna', { as: OTRO })).status).toBe(404);
    expect((await call('DELETE', '/api/memberships/u-prof', { as: PROF })).status).toBe(400);
    expect((await call('DELETE', '/api/memberships/u-owner', { as: PROF })).status).toBe(409);
    const response = await call('DELETE', '/api/memberships/u-alumna', { as: PROF });
    expect(response.status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM memberships WHERE user_id = 'u-alumna'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'u-alumna'").get()).toEqual({ n: 0 });
    const entry = db.prepare("SELECT tenant_id AS tenantId, actor_id AS actorId, detail_json AS detail FROM audit_log WHERE action = 'member_deleted'").get() as Row;
    expect(entry).toMatchObject({ tenantId: 'ufv', actorId: 'u-prof' });
    expect(JSON.parse(String(entry.detail))).toEqual({ userId: 'u-alumna', role: 'participant', userDeleted: true });
    expect(String(entry.detail)).not.toContain('@');
  });

  it('DELETE conserva el usuario si aún tiene otra membresía', async () => {
    const { call, db } = setup();
    db.exec("INSERT INTO memberships (tenant_id,user_id,role) VALUES ('other','u-alumna','participant')");
    expect((await call('DELETE', '/api/memberships/u-alumna', { as: PROF })).status).toBe(200);
    expect(db.prepare("SELECT COUNT(*) AS n FROM users WHERE id = 'u-alumna'").get()).toEqual({ n: 1 });
  });
});

describe('CSRF y cuerpo de las peticiones', () => {
  const member = { email: 'nuevo@ufv.es', name: 'Nuevo', role: 'participant' };

  it('rechaza con 403 un Origin ajeno o una petición cross-site', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/memberships', { as: PROF, body: member, headers: { 'sec-fetch-site': '', origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('POST', '/api/memberships', { as: PROF, body: member, headers: { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' } })).status).toBe(403);
    expect((await call('POST', '/api/memberships', { as: PROF, body: member, headers: { 'sec-fetch-site': 'same-site' } })).status).toBe(403);
    expect((await call('DELETE', '/api/memberships/u-alumna', { as: PROF, headers: { 'sec-fetch-site': '', origin: 'https://evil.example' } })).status).toBe(403);
  });

  it('acepta el mismo origen y clientes sin cabeceras de navegador (Unity de escritorio, scripts)', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/memberships', { as: PROF, body: member, headers: { 'sec-fetch-site': '', origin: 'https://axyro.test' } })).status).toBe(201);
    expect((await call('POST', '/api/memberships', { as: PROF, body: { ...member, email: 'otro.nuevo@ufv.es' }, headers: { 'sec-fetch-site': '' } })).status).toBe(201);
  });

  it('exige application/json salvo en DELETE sin cuerpo', async () => {
    const { call } = setup();
    const plain = await call('POST', '/api/memberships', { as: PROF, raw: JSON.stringify(member), headers: { 'content-type': 'text/plain' } });
    expect(plain.status).toBe(403);
    const form = await call('POST', '/api/memberships', { as: PROF, raw: 'email=x', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(form.status).toBe(403);
    expect((await call('POST', '/api/memberships', { as: PROF, body: member, headers: { 'content-type': 'application/json; charset=utf-8' } })).status).toBe(201);
    // DELETE sin cuerpo ni Content-Type: pasa el filtro CSRF (404 porque el miembro no existe).
    expect((await call('DELETE', '/api/memberships/no-existe', { as: PROF })).status).toBe(404);
  });

  it('csrfRejection no afecta a métodos seguros', () => {
    expect(csrfRejection(new Request('https://axyro.test/api/me', { headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' } }))).toBeNull();
  });

  it('devuelve 400 «Cuerpo JSON no válido.» ante JSON mal formado', async () => {
    const { call } = setup();
    for (const path of ['/api/memberships', '/api/scenarios', '/api/sessions/s1/commands']) {
      const response = await call('POST', path, { as: PROF, raw: '{"email": ' });
      if (path.endsWith('/commands')) continue; // la sesión no existe: 404 antes de leer el cuerpo
      expect(response.status, path).toBe(400);
      expect(await response.json()).toEqual({ error: 'Cuerpo JSON no válido.' });
    }
    expect((await call('POST', '/api/memberships', { as: PROF, raw: '' })).status).toBe(400);
  });
});

describe('catálogo de escenarios', () => {
  const custom = (id: string, version = 1) => ({ ...structuredClone(catalogScenarios[0]), id, version });

  it('reserva los IDs del catálogo aunque aún no estén en D1, con un mensaje genérico', async () => {
    const { call, db } = setup();
    expect(db.prepare('SELECT COUNT(*) AS n FROM scenarios').get()).toEqual({ n: 0 });
    const response = await call('POST', '/api/scenarios', { as: PROF, body: custom(catalogScenarios[0].id, catalogScenarios[0].version + 1) });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Ese identificador no está disponible.' });
  });

  it('da el mismo mensaje si el ID es de otra organización y deja publicar versiones propias', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/scenarios', { as: OTRO, body: custom('propio-otra') })).status).toBe(201);
    const taken = await call('POST', '/api/scenarios', { as: PROF, body: custom('propio-otra') });
    expect(taken.status).toBe(400);
    expect(await taken.json()).toEqual({ error: 'Ese identificador no está disponible.' });
    expect((await call('POST', '/api/scenarios', { as: OTRO, body: custom('propio-otra', 2) })).status).toBe(201);
  });
});

describe('autorización de sesiones', () => {
  function withSessions() {
    const context = setup();
    const insert = context.db.prepare("INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES (?,?,?,'x',1,'active',?)");
    insert.run('s-prof', 'ufv', 'u-prof', '2026-10-01T00:00:00.000Z');
    insert.run('s-owner', 'ufv', 'u-owner', '2026-10-02T00:00:00.000Z');
    insert.run('s-huerfana', 'ufv', 'u-ya-no-esta', '2026-10-03T00:00:00.000Z');
    insert.run('s-otra', 'other', 'u-otro', '2026-10-04T00:00:00.000Z');
    insert.run('s-boom', 'ufv', 'u-prof', '2026-10-05T00:00:00.000Z');
    context.db.exec(`INSERT INTO simulation_events (tenant_id,session_id,seq,type,at,actor_id,detail_json) VALUES
      ('ufv','s-prof',2,'participant_joined','2026-10-01T00:01:00.000Z','u-alumna','{}'),
      ('ufv','s-owner',2,'decision','2026-10-02T00:01:00.000Z','u-alumna','{}')`);
    return context;
  }

  it('el instructor ve todas las sesiones de su organización; el participante solo aquellas a las que se unió', async () => {
    const { call } = withSessions();
    const asProf = await (await call('GET', '/api/sessions', { as: PROF })).json() as { sessions: { id: string }[] };
    expect(asProf.sessions.map(item => item.id)).toEqual(['s-boom', 's-huerfana', 's-owner', 's-prof']);
    const asAlumna = await (await call('GET', '/api/sessions', { as: ALUMNA })).json() as { sessions: { id: string }[] };
    expect(asAlumna.sessions.map(item => item.id)).toEqual(['s-prof']);
  });

  it('muestra la sesión inmediatamente después de unirse, antes de que procese la cola', async () => {
    const { call, db } = withSessions();
    db.prepare("INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES (?,?,?,'x',1,'active',?)")
      .run('s-nueva', 'ufv', 'u-prof', NEWER);
    const before = await (await call('GET', '/api/sessions', { as: ALUMNA })).json() as { sessions: { id: string }[] };
    expect(before.sessions.some(session => session.id === 's-nueva')).toBe(false);
    const joined = await call('POST', '/api/sessions/s-nueva/commands', { as: ALUMNA, body: { id: 'join-nueva-0001', type: 'join' } });
    expect(joined.status).toBe(200);
    const after = await (await call('GET', '/api/sessions', { as: ALUMNA })).json() as { sessions: { id: string }[] };
    expect(after.sessions.some(session => session.id === 's-nueva')).toBe(true);
    expect(db.prepare("SELECT detail_json FROM simulation_events WHERE session_id = 's-nueva'").get()).toEqual({ detail_json: '{"participantId":"u-alumna"}' });
  });

  it('el participante puede leer una sesión de su organización por id, pero no sus eventos', async () => {
    const { call } = withSessions();
    expect((await call('GET', '/api/sessions/s-owner', { as: ALUMNA })).status).toBe(200);
    expect((await call('GET', '/api/sessions/s-otra', { as: ALUMNA })).status).toBe(404);
    expect((await call('GET', '/api/sessions/s-prof/events', { as: ALUMNA })).status).toBe(403);
    expect((await call('GET', '/api/sessions/s-prof/events', { as: PROF })).status).toBe(200);
  });

  it('exportar y borrar quedan para el instructor creador (o cualquiera si el creador ya no es miembro)', async () => {
    const { call, sessions, db } = withSessions();
    expect((await call('GET', '/api/sessions/s-owner/export', { as: PROF })).status).toBe(403);
    expect((await call('GET', '/api/sessions/s-prof/export', { as: ALUMNA })).status).toBe(403);
    expect((await call('GET', '/api/sessions/s-otra/export', { as: PROF })).status).toBe(404);
    expect((await call('GET', '/api/sessions/s-prof/export', { as: PROF })).status).toBe(200);
    expect((await call('GET', '/api/sessions/s-huerfana/export', { as: PROF })).status).toBe(200);
    expect((await call('DELETE', '/api/sessions/s-owner', { as: PROF })).status).toBe(403);
    expect((await call('DELETE', '/api/sessions/s-prof', { as: PROF })).status).toBe(200);
    expect(sessions.calls).toContainEqual({ name: 'ufv:s-prof', op: 'purge' });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = 's-prof'").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE id = 's-owner'").get()).toEqual({ n: 1 });
  });

  it('usa la jurisdicción UE de los Durable Objects si SESSIONS_JURISDICTION = "eu"', async () => {
    const plain = withSessions();
    await plain.call('GET', '/api/sessions/s-prof', { as: PROF });
    expect(plain.sessions.jurisdictions).toEqual([]);
    const eu = setup({ vars: { SESSIONS_JURISDICTION: 'eu' } });
    eu.db.exec("INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES ('s1','ufv','u-prof','x',1,'active','2026-10-01')");
    expect((await eu.call('GET', '/api/sessions/s1', { as: PROF })).status).toBe(200);
    expect(eu.sessions.jurisdictions).toEqual(['eu']);
  });
});

describe('cabeceras y observabilidad', () => {
  it('añade request id (cf-ray si existe) y cabeceras de seguridad a la API', async () => {
    const { call } = setup();
    const response = await call('GET', '/api/me', { as: PROF, headers: { 'cf-ray': '8f0000000000abcd-MAD' } });
    expect(response.headers.get('x-request-id')).toBe('8f0000000000abcd-MAD');
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('strict-transport-security')).toContain('max-age=');
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('cache-control')).toBe('no-store');
    const generated = await call('GET', '/api/health');
    expect(generated.headers.get('x-request-id')).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('registra una línea JSON por petición con IDs seudónimos y sin correos', async () => {
    const { call } = setup();
    const log = vi.mocked(console.log);
    log.mockClear();
    await call('GET', '/api/me', { as: 'nueva.alumna@ufv.es' });
    const lines = log.mock.calls.map(args => String(args[0]));
    const request = lines.map(line => JSON.parse(line) as Record<string, unknown>).find(entry => entry.code === 'REQUEST');
    expect(request).toMatchObject({ method: 'GET', path: '/api/me', status: 200, tenantId: 'ufv' });
    expect(typeof request?.durationMs).toBe('number');
    expect(typeof request?.userId).toBe('string');
    expect(lines.join('\n')).not.toContain('@');
  });

  it('en un 500 devuelve el requestId y no el detalle del error', async () => {
    const context = setup();
    context.db.exec("INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES ('s-boom','ufv','u-prof','x',1,'active','2026-10-01')");
    const response = await context.call('GET', '/api/sessions/s-boom', { as: PROF });
    expect(response.status).toBe(500);
    const body = await response.json() as { error: string; requestId: string };
    expect(body.error).toBe('Error interno.');
    expect(body.requestId).toBe(response.headers.get('x-request-id'));
    expect(JSON.stringify(body)).not.toContain('simulado');
  });

  it('sirve la consola con CSP estricta y el simulador con la CSP de Unity WebGL', async () => {
    const { call, assets } = setup();
    const page = await call('GET', '/');
    expect(page.status).toBe(200);
    expect(assets).toEqual(['/']);
    const consoleCsp = page.headers.get('content-security-policy') ?? '';
    expect(consoleCsp).toContain("frame-ancestors 'none'");
    expect(consoleCsp).toContain("script-src 'self';");
    expect(page.headers.get('x-frame-options')).toBe('DENY');
    const simulator = await call('GET', '/simulador/');
    const simulatorCsp = simulator.headers.get('content-security-policy') ?? '';
    expect(simulatorCsp).toContain("'wasm-unsafe-eval'");
    expect(simulatorCsp).toContain('worker-src');
    expect(simulator.headers.get('strict-transport-security')).toBeTruthy();
  });

  it('una ruta /api desconocida es un 404 JSON, no la consola', async () => {
    const { call, assets } = setup();
    const response = await call('GET', '/api/no-existe', { as: PROF });
    expect(response.status).toBe(404);
    expect(assets).toEqual([]);
  });
});

describe('retención', () => {
  it('purga sesiones no finalizadas antiguas y auditoría vencida, y conserva lo reciente', async () => {
    const { d1, db } = createD1();
    seed(db);
    const sessions = fakeSessions();
    const insert = db.prepare("INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at,completed_at) VALUES (?,'ufv','u-prof','x',1,?,?,?)");
    insert.run('activa-antigua', 'active', '2025-09-01T00:00:00.000Z', null);
    insert.run('pausada-antigua', 'paused', '2025-09-01T00:00:00.000Z', null);
    insert.run('activa-reciente', 'active', '2026-09-01T00:00:00.000Z', null);
    insert.run('completa-antigua', 'complete', '2025-08-01T00:00:00.000Z', '2025-08-02T00:00:00.000Z');
    insert.run('completa-reciente', 'complete', '2025-08-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
    const audit = db.prepare("INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES (?,'ufv','u-prof',NULL,'x',?,'{}')");
    audit.run('audit-vieja', '2024-01-01T00:00:00.000Z');
    audit.run('audit-reciente', '2026-01-01T00:00:00.000Z');
    const env = { DB: d1, SESSIONS: sessions.namespace, RETENTION_DAYS: '365' } as never;

    const deleted = await applyRetention(env, new Date('2026-10-06T00:00:00.000Z'));
    expect(deleted).toBe(3);
    const remaining = db.prepare('SELECT id FROM sessions ORDER BY id').all().map(row => row.id);
    expect(remaining).toEqual(['activa-reciente', 'completa-reciente']);
    expect(sessions.calls.map(item => item.name).sort()).toEqual(['ufv:activa-antigua', 'ufv:completa-antigua', 'ufv:pausada-antigua']);
    const audits = db.prepare('SELECT id, action FROM audit_log ORDER BY id').all() as Row[];
    expect(audits.map(row => row.id)).not.toContain('audit-vieja');
    expect(audits.map(row => row.id)).toContain('audit-reciente');
    expect(audits.filter(row => row.action === 'session_retention_deleted')).toHaveLength(3);
  });

  it('respeta AUDIT_RETENTION_DAYS', async () => {
    const { d1, db } = createD1();
    seed(db);
    db.exec("INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES ('a','ufv','u-prof',NULL,'x','2026-08-01T00:00:00.000Z','{}')");
    await applyRetention({ DB: d1, SESSIONS: fakeSessions().namespace, AUDIT_RETENTION_DAYS: '30' } as never, new Date('2026-10-06T00:00:00.000Z'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()).toEqual({ n: 0 });
  });
});
