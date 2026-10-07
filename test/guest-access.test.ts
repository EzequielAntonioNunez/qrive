import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
// Access simulado (solo para el instructor de los tests): «valid:<correo>» es un JWT válido para ese correo.
vi.mock('jose', () => ({
  createRemoteJWKSet: () => 'jwks',
  jwtVerify: async (token: string) => {
    if (!token.startsWith('valid:')) throw new Error('firma no válida');
    return { payload: { email: token.slice('valid:'.length) } };
  }
}));

const { applyRetention, createApp } = await import('../worker/app');
const { roomPayload } = await import('../worker/room');
const { dedupeAlias, parseAlias, JOIN_FAILURE_LIMIT, GUEST_SCOPE_ERROR, PIN_INVALID } = await import('../worker/guests');
const { applyCommand, createSession } = await import('../shared/engine');
const { defaultScenario } = await import('../shared/simulation');
type SessionState = import('../shared/simulation').SessionState;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

type Row = Record<string, unknown>;

/** D1 sobre SQLite en memoria con las migraciones reales. */
function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  const isQuery = (sql: string) => /^\s*(SELECT|WITH)/i.test(sql);
  const statement = (sql: string, args: unknown[] = []) => {
    const params = args as (string | number | null)[];
    const run = () => ({ success: true, results: [], meta: { changes: Number(db.prepare(sql).run(...params).changes) } });
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
      try { const results = items.map(item => item.execute()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  return { d1, db };
}

/** Durable Objects simulados con el motor real y roomPayload: el filtrado por identidad es el de producción. */
function fakeRooms() {
  const states = new Map<string, SessionState>();
  const live: { name: string; headers: Headers }[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (_url: string, init: RequestInit) => {
        if (init.body === undefined) { live.push({ name, headers: new Headers(init.headers) }); return Response.json({ live: true }); }
        const body = JSON.parse(String(init.body));
        if (body.op === 'purge') { states.delete(name); return Response.json({ purged: true }); }
        let state = states.get(name);
        if (!state || state.tenantId !== body.tenantId) return Response.json({ error: 'Sesión no encontrada.' }, { status: 404 });
        if (body.op === 'command') {
          try { state = applyCommand(state, body.command, body.actor, new Date().toISOString()).state; } catch (error) {
            return Response.json({ error: (error as Error).message }, { status: 400 });
          }
          states.set(name, state);
        }
        return Response.json(roomPayload(state, body.actor, {}));
      }
    }),
    jurisdiction: () => namespace
  };
  return { namespace, states, live };
}

const T0 = '2026-10-07T08:00:00.000Z';
const SESSION = 'sesion-aula-0001';
const OTHER_SESSION = 'sesion-aula-0002';
const FOREIGN_SESSION = 'sesion-otra-0001';
const PROF = 'prof@ufv.es';
const ALUMNA = 'alumna@ufv.es';
const OTRO = 'otro@other.org';

function setup() {
  const { d1, db } = createD1();
  db.exec(`INSERT INTO tenants (id,name,created_at) VALUES ('ufv','UFV','${T0}'), ('other','Otra','${T0}')`);
  for (const [id, email, name, tenant, role] of [
    ['u-prof', PROF, 'Profesora', 'ufv', 'instructor'], ['u-alumna', ALUMNA, 'Alumna', 'ufv', 'participant'], ['u-otro', OTRO, 'Otro', 'other', 'instructor']
  ]) {
    db.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').run(id, email, name, T0);
    db.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').run(tenant, id, role);
  }
  db.prepare('INSERT INTO scenarios (id,version,tenant_id,title,definition_json,created_by,created_at) VALUES (?,?,NULL,?,?,?,?)')
    .run(defaultScenario.id, defaultScenario.version, defaultScenario.title, JSON.stringify(defaultScenario), 'system', T0);
  const rooms = fakeRooms();
  const addSession = (id: string, tenant: string, instructor: string, name: string | null = null) => {
    db.prepare("INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at,name) VALUES (?,?,?,?,?,'active',?,?)")
      .run(id, tenant, instructor, defaultScenario.id, defaultScenario.version, T0, name);
    rooms.states.set(`${tenant}:${id}`, createSession(id, tenant, { id: instructor, name: 'Docente', role: 'instructor' }, T0, defaultScenario));
  };
  addSession(SESSION, 'ufv', 'u-prof', 'Clase de IA');
  addSession(OTHER_SESSION, 'ufv', 'u-prof');
  addSession(FOREIGN_SESSION, 'other', 'u-otro');
  const assets: string[] = [];
  const env: Record<string, unknown> = {
    DB: d1,
    SESSIONS: rooms.namespace,
    ASSETS: { fetch: async (request: Request) => { assets.push(new URL(request.url).pathname); return new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } }); } },
    ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com',
    ACCESS_AUD: 'aud-de-prueba',
    LEGACY_ACCESS_AUTH: 'true',
    ACCESS_CODE_PEPPER: 'test-only-pepper-with-at-least-32-characters',
    FEATURE_FLAGS: '{"realtime_websocket":true}'
  };
  const app = createApp(false);
  const call = (method: string, path: string, init: { as?: string; cookie?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.7' };
    if (init.as) headers['cf-access-jwt-assertion'] = `valid:${init.as}`;
    if (init.cookie) headers.cookie = init.cookie;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    Object.assign(headers, init.headers);
    return app.request(`https://axyro.test${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }, env as never);
  };
  const pinOf = async (id = SESSION) => (await (await call('GET', `/api/sessions/${id}/pin`, { as: PROF })).json() as { pin: string }).pin;
  const join = async (pin: string, alias: string, cookie?: string) => {
    const response = await call('POST', '/api/join', { body: { pin, alias }, cookie });
    const setCookie = response.headers.get('set-cookie') ?? '';
    return { response, setCookie, cookie: setCookie.split(';')[0], body: await response.json() as Record<string, string> };
  };
  return { db, env, call, rooms, assets, pinOf, join };
}

describe('PIN de la sesión', () => {
  it('lo crea al pedirlo, lo mantiene, lo regenera y solo lo gestiona un instructor de la organización', async () => {
    const { call, db } = setup();
    const first = await call('GET', `/api/sessions/${SESSION}/pin`, { as: PROF });
    expect(first.status).toBe(200);
    const { pin, joinUrl } = await first.json() as { pin: string; joinUrl: string };
    expect(pin).toMatch(/^\d{6}$/);
    expect(joinUrl).toBe(`https://axyro.test/unirse/${pin}`);
    expect((await (await call('GET', `/api/sessions/${SESSION}/pin`, { as: PROF })).json() as { pin: string }).pin).toBe(pin);

    const regenerated = await call('POST', `/api/sessions/${SESSION}/pin`, { as: PROF, body: {} });
    expect(regenerated.status).toBe(200);
    const next = (await regenerated.json() as { pin: string }).pin;
    expect(next).not.toBe(pin);
    expect((await call('GET', `/api/join/${pin}`)).status).toBe(404);
    expect((await call('GET', `/api/join/${next}`)).status).toBe(200);
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_pins WHERE session_id = ? AND revoked_at IS NULL').get(SESSION)).toEqual({ n: 1 });

    expect((await call('GET', `/api/sessions/${SESSION}/pin`, { as: ALUMNA })).status).toBe(403);
    expect((await call('GET', `/api/sessions/${SESSION}/pin`, { as: OTRO })).status).toBe(404);
    expect((await call('GET', `/api/sessions/${SESSION}/pin`)).status).toBe(401);
    // Cada sesión tiene su propio PIN.
    expect(await (await call('GET', `/api/sessions/${OTHER_SESSION}/pin`, { as: PROF })).json()).not.toMatchObject({ pin: next });
  });

  it('se revoca al finalizar la sesión y desaparece al borrarla', async () => {
    const { call, pinOf, join, db } = setup();
    const pin = await pinOf();
    const guest = await join(pin, 'Ana');
    expect((await call('POST', `/api/sessions/${SESSION}/commands`, { as: PROF, body: { id: 'cmd-complete-0001', type: 'complete' } })).status).toBe(200);
    expect((await call('GET', `/api/join/${pin}`)).status).toBe(404);
    expect((await join(pin, 'Beto')).response.status).toBe(404);
    const after = await call('GET', `/api/sessions/${SESSION}/pin`, { as: PROF });
    expect(after.status).toBe(409);
    // Margen de lectura: el invitado aún ve su informe final, pero ya no puede decidir.
    expect((await call('GET', `/api/sessions/${SESSION}`, { cookie: guest.cookie })).status).toBe(200);
    expect((await call('POST', `/api/sessions/${SESSION}/commands`, { cookie: guest.cookie, body: { id: 'cmd-late-00001', type: 'decide', optionId: defaultScenario.phases[0].options[0].id } })).status).toBe(400);
    // Pasado el margen, el acceso termina.
    db.prepare('UPDATE sessions SET completed_at = ? WHERE id = ?').run('2020-01-01T00:00:00.000Z', SESSION);
    expect((await call('GET', '/api/me', { cookie: guest.cookie })).status).toBe(401);

    const other = await pinOf(OTHER_SESSION);
    const guest2 = await join(other, 'Carla');
    expect((await call('DELETE', `/api/sessions/${OTHER_SESSION}`, { as: PROF })).status).toBe(200);
    expect((await call('GET', `/api/join/${other}`)).status).toBe(404);
    expect((await call('GET', '/api/me', { cookie: guest2.cookie })).status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM guests WHERE session_id = ?').get(OTHER_SESSION)).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_pins WHERE session_id = ?').get(OTHER_SESSION)).toEqual({ n: 0 });
  });
});

describe('unión de invitados', () => {
  it('GET /api/join/:pin devuelve solo lo imprescindible; un PIN inválido es 404', async () => {
    const { call, pinOf } = setup();
    const pin = await pinOf();
    const info = await call('GET', `/api/join/${pin}`);
    expect(info.status).toBe(200);
    expect(await info.json()).toEqual({ scenarioTitle: defaultScenario.title, sessionName: 'Clase de IA', status: 'active' });
    for (const bad of ['000000', '12345', 'abcdef']) {
      const response = await call('GET', `/api/join/${bad === pin ? '999999' : bad}`);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: PIN_INVALID });
    }
  });

  it('POST /api/join crea el invitado, fija la cookie y lo une en directo a la sesión', async () => {
    const { call, pinOf, join, db, rooms } = setup();
    const pin = await pinOf();
    const { response, setCookie, cookie, body } = await join(pin, '  Ana   García ');
    expect(response.status).toBe(201);
    expect(body).toMatchObject({ sessionId: SESSION, alias: 'Ana García' });
    expect(body.participantId).toMatch(/^guest-[0-9a-f-]{36}$/);
    expect(setCookie).toMatch(/^axyro_session=[A-Za-z0-9_-]{43};/);
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/Secure/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Max-Age=43200/);
    // En D1 solo el hash del token.
    expect(JSON.stringify(db.prepare('SELECT * FROM guests').all())).not.toContain(cookie.split('=')[1]);

    // Unido en el motor y persistido como participante real (no simulado).
    const state = rooms.states.get(`ufv:${SESSION}`)!;
    expect(state.participants).toEqual([expect.objectContaining({ userId: body.participantId, name: 'Ana García' })]);
    expect(db.prepare("SELECT actor_id AS actorId, detail_json AS detail FROM simulation_events WHERE type = 'participant_joined'").all())
      .toEqual([{ actorId: body.participantId, detail: JSON.stringify({ participantId: body.participantId }) }]);
    const list = await (await call('GET', '/api/sessions', { as: PROF })).json() as { sessions: { id: string; participantCount: number; simulatedCount: number }[] };
    expect(list.sessions.find(item => item.id === SESSION)).toMatchObject({ participantCount: 1, simulatedCount: 0 });
    // Auditoría con IDs seudónimos, sin alias.
    const audit = db.prepare("SELECT actor_id AS actorId, session_id AS sessionId, detail_json AS detail FROM audit_log WHERE action = 'guest_joined'").all() as Row[];
    expect(audit).toEqual([{ actorId: body.participantId, sessionId: SESSION, detail: JSON.stringify({ participantId: body.participantId }) }]);
    expect(JSON.stringify(db.prepare('SELECT * FROM audit_log').all())).not.toContain('Ana');

    const me = await call('GET', '/api/me', { cookie });
    expect(me.status).toBe(200);
    const meBody = await me.json() as Record<string, unknown>;
    expect(meBody).toMatchObject({ id: body.participantId, name: 'Ana García', role: 'participant', guest: true, sessionId: SESSION });
    expect(meBody.flags).toBeTypeOf('object');
    expect(JSON.stringify(meBody)).not.toMatch(/email|tenantId/);

    // Puede leer su sesión y decidir.
    expect((await call('GET', `/api/sessions/${SESSION}`, { cookie })).status).toBe(200);
    const optionId = defaultScenario.phases[0].options[0].id;
    expect((await call('POST', `/api/sessions/${SESSION}/commands`, { cookie, body: { id: 'cmd-decide-0001', type: 'decide', optionId } })).status).toBe(200);
    expect((await call('POST', `/api/sessions/${SESSION}/commands`, { cookie, body: { id: 'cmd-join-00001', type: 'join' } })).status).toBe(200);

    // Cerrar sesión borra el invitado.
    expect((await call('POST', '/api/auth/logout', { cookie, body: {} })).status).toBe(200);
    expect((await call('GET', '/api/me', { cookie })).status).toBe(401);
    expect(db.prepare('SELECT COUNT(*) AS n FROM guests').get()).toEqual({ n: 0 });
  });

  it('volver a unirse a la misma sesión conserva el participante; a otra, sustituye la cookie', async () => {
    const { pinOf, join, call, db, rooms } = setup();
    const pin = await pinOf();
    const first = await join(pin, 'Ana');
    const again = await join(pin, 'Otro nombre', first.cookie);
    expect(again.response.status).toBe(201);
    expect(again.body).toEqual(first.body);
    expect(again.setCookie).toBe('');
    expect(rooms.states.get(`ufv:${SESSION}`)!.participants).toHaveLength(1);

    const other = await join(await pinOf(OTHER_SESSION), 'Ana', first.cookie);
    expect(other.response.status).toBe(201);
    expect(other.body.sessionId).toBe(OTHER_SESSION);
    expect((await call('GET', '/api/me', { cookie: first.cookie })).status).toBe(401);
    expect(db.prepare('SELECT session_id AS sessionId FROM guests').all()).toEqual([{ sessionId: OTHER_SESSION }]);
  });

  it('valida el alias y desambigua los repetidos dentro de la sesión', async () => {
    const { pinOf, join } = setup();
    const pin = await pinOf();
    for (const alias of ['A', 'x'.repeat(31), 'ana@ufv.es', 'https://evil.example', 'www.ejemplo', 'ejemplo.com', '<script>', '---', 42, null]) {
      const { response, body } = await join(pin, alias as string);
      expect(response.status, String(alias)).toBe(400);
      expect(body.error).toMatch(/alias/);
    }
    expect((await join(pin, 'Ana')).body.alias).toBe('Ana');
    expect((await join(pin, 'ana')).body.alias).toBe('ana 2');
    expect((await join(pin, 'Ana')).body.alias).toBe('Ana 3');
    expect((await join(pin, 'José-Mª_2.0')).body.alias).toBe('José-Mª_2.0');
  });

  it('un alias no válido no revela si el PIN existe, y el PIN se valida en formato', async () => {
    const { join } = setup();
    expect((await join('999999', 'A')).response.status).toBe(400);
    expect((await join('12ab56', 'Ana')).response.status).toBe(404);
  });

  it('limita la fuerza bruta del PIN por IP', async () => {
    const { call, pinOf, join } = setup();
    const pin = await pinOf();
    const wrong = pin === '000001' ? '000002' : '000001';
    for (let attempt = 0; attempt < JOIN_FAILURE_LIMIT; attempt++) expect((await call('GET', `/api/join/${wrong}`)).status).toBe(404);
    // Bloqueado incluso con el PIN correcto, por GET y por POST.
    expect((await call('GET', `/api/join/${pin}`)).status).toBe(429);
    expect((await join(pin, 'Ana')).response.status).toBe(429);
    // Otra IP no está afectada.
    expect((await call('GET', `/api/join/${pin}`, { headers: { 'cf-connecting-ip': '198.51.100.9' } })).status).toBe(200);
  });

  it('respeta el limitador de borde AUTH_IP_LIMITER y las reglas CSRF', async () => {
    const { call, env, pinOf } = setup();
    const pin = await pinOf();
    expect((await call('POST', '/api/join', { body: { pin, alias: 'Ana' }, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await call('POST', '/api/join', { body: { pin, alias: 'Ana' }, headers: { 'content-type': 'text/plain' } })).status).toBe(403);
    env.AUTH_IP_LIMITER = { limit: async () => ({ success: false }) };
    expect((await call('GET', `/api/join/${pin}`)).status).toBe(429);
    expect((await call('POST', '/api/join', { body: { pin, alias: 'Ana' } })).status).toBe(429);
  });
});

describe('ámbito del invitado', () => {
  it('solo puede usar su sesión: el resto de rutas es 403', async () => {
    const { call, pinOf, join, env } = setup();
    env.AI = { run: async () => ({}) };
    const { cookie } = await join(await pinOf(), 'Ana');
    const forbidden: [string, string, unknown?][] = [
      ['GET', '/api/sessions'],
      ['POST', '/api/sessions', {}],
      ['GET', `/api/sessions/${OTHER_SESSION}`],
      ['GET', `/api/sessions/${FOREIGN_SESSION}`],
      ['POST', `/api/sessions/${OTHER_SESSION}/commands`, { id: 'cmd-join-00002', type: 'join' }],
      ['GET', `/api/sessions/${OTHER_SESSION}/live`],
      ['PATCH', `/api/sessions/${SESSION}`, { name: 'x' }],
      ['DELETE', `/api/sessions/${SESSION}`],
      ['GET', `/api/sessions/${SESSION}/export`],
      ['GET', `/api/sessions/${SESSION}/events`],
      ['GET', `/api/sessions/${SESSION}/pin`],
      ['POST', `/api/sessions/${SESSION}/pin`, {}],
      ['POST', `/api/sessions/${SESSION}/duplicate`, {}],
      ['POST', `/api/sessions/${SESSION}/demo-class`, {}],
      ['DELETE', `/api/sessions/${SESSION}/demo-class`],
      ['GET', '/api/memberships'],
      ['POST', '/api/memberships', { email: 'x@ufv.es', name: 'X', role: 'participant' }],
      ['DELETE', '/api/memberships/u-alumna'],
      ['GET', '/api/analytics'],
      ['GET', '/api/access-codes'],
      ['POST', '/api/access-codes/u-alumna', {}],
      ['GET', '/api/scenarios'],
      ['GET', `/api/scenarios/${defaultScenario.id}`],
      ['POST', '/api/scenarios', {}]
    ];
    for (const [method, path, body] of forbidden) {
      const response = await call(method, path, { cookie, body, headers: path.endsWith('/live') ? { upgrade: 'websocket', origin: 'https://axyro.test' } : {} });
      expect(response.status, `${method} ${path}`).toBe(403);
      expect(await response.json()).toEqual({ error: GUEST_SCOPE_ERROR });
    }
    for (const type of ['advance', 'pause', 'resume', 'complete']) {
      const response = await call('POST', `/api/sessions/${SESSION}/commands`, { cookie, body: { id: `cmd-${type}-0001`, type } });
      expect(response.status, type).toBe(403);
    }
    const incident = await call('POST', `/api/sessions/${SESSION}/commands`, { cookie, body: { id: 'cmd-incid-0001', type: 'incident', note: 'x', riskDelta: 1 } });
    expect(incident.status).toBe(403);
    // Voz: solo para su sesión.
    expect((await call('GET', '/api/voice/config', { cookie })).status).toBe(200);
    expect((await call('POST', '/api/voice/interpret', { cookie, body: { sessionId: OTHER_SESSION, phrase: 'la primera' } })).status).toBe(403);
  });

  it('no ve a sus compañeros ni las valoraciones antes de decidir', async () => {
    const { call, pinOf, join } = setup();
    const pin = await pinOf();
    const ana = await join(pin, 'Ana');
    const beto = await join(pin, 'Beto');
    const phase = defaultScenario.phases[0];
    expect((await call('POST', `/api/sessions/${SESSION}/commands`, { cookie: beto.cookie, body: { id: 'cmd-beto-00001', type: 'decide', optionId: phase.options[0].id } })).status).toBe(200);
    const view = await (await call('GET', `/api/sessions/${SESSION}`, { cookie: ana.cookie })).json() as { state: SessionState; liveTally?: unknown; report: unknown };
    expect(view.liveTally).toBeUndefined();
    expect(view.state.participants.map(person => person.userId)).toEqual([ana.body.participantId]);
    expect(view.state.decisions).toEqual([]);
    expect(Object.keys(view.state.participantMeters)).toEqual([ana.body.participantId]);
    expect(JSON.stringify(view.state)).not.toContain('Beto');
    expect(JSON.stringify(view.state)).not.toContain(beto.body.participantId);
    for (const option of view.state.scenario.phases[0].options) {
      expect(option).not.toHaveProperty('quality');
      expect(option).not.toHaveProperty('rationale');
      expect(option).not.toHaveProperty('effects');
    }
    // La respuesta a su propio comando también va filtrada.
    const own = await (await call('POST', `/api/sessions/${SESSION}/commands`, { cookie: ana.cookie, body: { id: 'cmd-ana-000001', type: 'join' } })).json() as { state: SessionState };
    expect(own.state.participants).toHaveLength(1);
  });

  it('abre el WebSocket de su sesión con su identidad de participante', async () => {
    const { call, pinOf, join, rooms } = setup();
    const { cookie, body } = await join(await pinOf(), 'Ana');
    const response = await call('GET', `/api/sessions/${SESSION}/live`, { cookie, headers: { upgrade: 'websocket', origin: 'https://axyro.test' } });
    expect(response.status).toBe(200);
    expect(rooms.live).toHaveLength(1);
    expect(JSON.parse(rooms.live[0].headers.get('x-axyro-room-actor')!)).toEqual({ id: body.participantId, name: 'Ana', role: 'participant', tenantId: 'ufv' });
    expect((await call('GET', `/api/sessions/${SESSION}/live`, { cookie, headers: { upgrade: 'websocket', origin: 'https://evil.example' } })).status).toBe(403);
  });
});

describe('retención y rutas de la consola', () => {
  it('el cron borra invitados caducados y PIN revocados antiguos', async () => {
    const { pinOf, join, db, env } = setup();
    await join(await pinOf(), 'Ana');
    db.prepare("UPDATE guests SET expires_at = '2026-10-01T00:00:00.000Z'").run();
    db.prepare("INSERT INTO session_pins (pin,tenant_id,session_id,created_at,revoked_at) VALUES ('111111','ufv',?,?,?)").run(OTHER_SESSION, T0, '2026-10-01T00:00:00.000Z');
    await applyRetention(env as never, new Date('2026-10-07T12:00:00.000Z'));
    expect(db.prepare('SELECT COUNT(*) AS n FROM guests').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_pins WHERE revoked_at IS NOT NULL').get()).toEqual({ n: 0 });
    expect(db.prepare('SELECT COUNT(*) AS n FROM session_pins WHERE revoked_at IS NULL').get()).toEqual({ n: 1 });
  });

  it('/unirse, /unirse/:pin y /jugar/:id se sirven como la consola, sin redirigir al acceso', async () => {
    const { call, assets } = setup();
    for (const path of ['/unirse', '/unirse/123456', `/jugar/${SESSION}`]) {
      const response = await call('GET', path);
      expect(response.status, path).toBe(200);
      expect(response.headers.get('content-security-policy')).toContain("script-src 'self'");
      expect(response.headers.get('content-security-policy')).toContain('wss://axyro.test');
    }
    expect(assets).toEqual(['/unirse', '/unirse/123456', `/jugar/${SESSION}`]);
  });

  it('alias: utilidades', () => {
    expect(parseAlias('  Ana  ')).toBe('Ana');
    expect(parseAlias('Ana\tMaría')).toBe('Ana María');
    expect(dedupeAlias('Ana', ['ana', 'ANA 2'])).toBe('Ana 3');
    expect(dedupeAlias('x'.repeat(30), ['x'.repeat(30)])).toBe(`${'x'.repeat(28)} 2`);
  });
});
