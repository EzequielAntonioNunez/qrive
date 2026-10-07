import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
// Access simulado: «valid:<correo>» es un JWT válido para ese correo.
vi.mock('jose', () => ({
  createRemoteJWKSet: () => 'jwks',
  jwtVerify: async (token: string) => {
    if (!token.startsWith('valid:')) throw new Error('firma no válida');
    return { payload: { email: token.slice('valid:'.length) } };
  }
}));

const { createApp, auditDetail } = await import('../worker/app');
const { QUEUE_DETAIL_FIELDS, queueSafeEvent, roomPayload } = await import('../worker/room');
const { persistEvent } = await import('../worker/persist');
const { aiCallLog, aiUsage } = await import('../worker/ai-common');
const { CLEF_MODEL } = await import('../worker/voice-intent');
const { applyCommand, createSession, DomainError } = await import('../shared/engine');
const { defaultScenario, participantView, performanceReport } = await import('../shared/simulation');
const { participantExport } = await import('../shared/participant-export');
type SessionState = import('../shared/simulation').SessionState;
type Actor = import('../shared/engine').Actor;

const logs: string[] = [];
beforeEach(() => {
  logs.length = 0;
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
});

type Row = Record<string, unknown>;

/** D1 sobre SQLite en memoria con las migraciones reales (json_extract incluido). */
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

/**
 * Durable Objects simulados con el motor real y roomPayload. Cada evento emitido se persiste además como lo haría el
 * consumidor de la cola (persistEvent con el evento redactado), para probar la supresión en D1 de extremo a extremo.
 */
function fakeRooms(getEnv: () => Record<string, unknown>) {
  const states = new Map<string, SessionState>();
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (_url: string, init: RequestInit) => {
        if (init.body === undefined) return Response.json({ live: true });
        const body = JSON.parse(String(init.body));
        if (body.op === 'purge') { states.delete(name); return Response.json({ purged: true }); }
        let state = states.get(name);
        if (!state || state.tenantId !== body.tenantId) return Response.json({ error: 'Sesión no encontrada.' }, { status: 404 });
        if (body.op === 'command') {
          try {
            const result = applyCommand(state, body.command, body.actor, new Date().toISOString());
            state = result.state;
            for (const event of result.events) await persistEvent(getEnv() as never, { tenantId: state.tenantId, sessionId: state.id, event: queueSafeEvent(event) });
          } catch (error) {
            return Response.json({ error: (error as Error).message }, { status: 400 });
          }
          states.set(name, state);
        }
        return Response.json(roomPayload(state, body.actor, {}));
      }
    }),
    jurisdiction: () => namespace
  };
  return { namespace, states };
}

const T0 = '2026-10-07T08:00:00.000Z';
const SESSION = 'sesion-rgpd-0001';
const FOREIGN = 'sesion-otra-0001';
const PROF = 'prof@ufv.es';
const OWNER = 'owner@ufv.es';
const ALUMNA = 'alumna@ufv.es';
const ALUMNO = 'alumno@ufv.es';
const OTRO = 'otro@other.org';
const OPTION = (index: number) => defaultScenario.phases[0].options[index].id;

function setup(options: { ai?: unknown } = {}) {
  const { d1, db } = createD1();
  db.exec(`INSERT INTO tenants (id,name,created_at) VALUES ('ufv','UFV','${T0}'), ('other','Otra','${T0}')`);
  for (const [id, email, name, tenant, role] of [
    ['u-owner', OWNER, 'Propietaria', 'ufv', 'instructor'], ['u-prof', PROF, 'Profesora', 'ufv', 'instructor'],
    ['u-alumna', ALUMNA, 'Alumna', 'ufv', 'participant'], ['u-alumno', ALUMNO, 'Alumno', 'ufv', 'participant'], ['u-otro', OTRO, 'Otro', 'other', 'instructor']
  ]) {
    db.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').run(id, email, name, T0);
    db.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').run(tenant, id, role);
  }
  db.prepare('INSERT INTO scenarios (id,version,tenant_id,title,definition_json,created_by,created_at) VALUES (?,?,NULL,?,?,?,?)')
    .run(defaultScenario.id, defaultScenario.version, defaultScenario.title, JSON.stringify(defaultScenario), 'system', T0);
  const env: Record<string, unknown> = {
    DB: d1,
    ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com',
    ACCESS_AUD: 'aud-de-prueba',
    LEGACY_ACCESS_AUTH: 'true',
    ACCESS_CODE_PEPPER: 'test-only-pepper-with-at-least-32-characters',
    BOOTSTRAP_OWNER_EMAIL: OWNER,
    ...(options.ai ? { AI: options.ai } : {})
  };
  const rooms = fakeRooms(() => env);
  env.SESSIONS = rooms.namespace;
  const now = new Date().toISOString();
  const addSession = (id: string, tenant: string, instructor: string) => {
    db.prepare("INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES (?,?,?,?,?,'active',?)")
      .run(id, tenant, instructor, defaultScenario.id, defaultScenario.version, now);
    rooms.states.set(`${tenant}:${id}`, createSession(id, tenant, { id: instructor, name: 'Docente', role: 'instructor' }, now, defaultScenario));
  };
  addSession(SESSION, 'ufv', 'u-prof');
  addSession(FOREIGN, 'other', 'u-otro');
  const app = createApp(false);
  const call = (method: string, path: string, init: { as?: string; cookie?: string; body?: unknown } = {}) => {
    const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin', 'cf-connecting-ip': '203.0.113.9' };
    if (init.as) headers['cf-access-jwt-assertion'] = `valid:${init.as}`;
    if (init.cookie) headers.cookie = init.cookie;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    return app.request(`https://axyro.test${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }, env as never);
  };
  const command = (as: string | { cookie: string }, type: string, extra: Record<string, unknown> = {}) =>
    call('POST', `/api/sessions/${SESSION}/commands`, { ...(typeof as === 'string' ? { as } : as), body: { id: crypto.randomUUID(), type, ...extra } });
  const joinGuest = async (alias: string) => {
    const { pin } = await (await call('GET', `/api/sessions/${SESSION}/pin`, { as: PROF })).json() as { pin: string };
    const response = await call('POST', '/api/join', { body: { pin, alias } });
    const body = await response.json() as { participantId: string };
    return { id: body.participantId, cookie: (response.headers.get('set-cookie') ?? '').split(';')[0] };
  };
  const state = () => rooms.states.get(`ufv:${SESSION}`)!;
  const eventsOf = (actorId: string) => db.prepare('SELECT seq, type FROM simulation_events WHERE session_id = ? AND actor_id = ? ORDER BY seq').all(SESSION, actorId) as { seq: number; type: string }[];
  return { db, env, call, command, joinGuest, state, eventsOf, rooms };
}

async function json<T = any>(response: Response): Promise<T> { return await response.json() as T; }

// ---------------------------------------------------------------------------------------------
// Motor
// ---------------------------------------------------------------------------------------------
describe('motor: retirar a un participante', () => {
  const instructor: Actor = { id: 'inst', name: 'Docente', role: 'instructor' };
  const ana: Actor = { id: 'user-ana', name: 'Ana', role: 'participant' };
  const luis: Actor = { id: 'user-luis', name: 'Luis', role: 'participant' };
  const at = (second: number) => new Date(Date.UTC(2026, 9, 7, 9, 0, second)).toISOString();
  function twoPeople() {
    let state = createSession('s1', 't1', instructor, at(0), defaultScenario);
    state = applyCommand(state, { id: 'join-ana-1', type: 'join' }, ana, at(1)).state;
    state = applyCommand(state, { id: 'join-luis-1', type: 'join' }, luis, at(2)).state;
    state = applyCommand(state, { id: 'decide-ana-1', type: 'decide', optionId: OPTION(0) }, ana, at(3)).state;
    state = applyCommand(state, { id: 'decide-luis-1', type: 'decide', optionId: OPTION(2) }, luis, at(4)).state;
    return state;
  }

  it('borra su unión, sus decisiones, sus indicadores y sus eventos, y recalcula la media de la clase', () => {
    const before = twoPeople();
    const luisMeters = before.participantMeters[luis.id];
    const { state, events } = applyCommand(before, { id: 'remove-ana-1', type: 'remove-participant', participantId: ana.id }, instructor, at(5));
    expect(events).toEqual([{ seq: 6, type: 'participant_removed', at: at(5), actorId: instructor.id, detail: { participantId: ana.id } }]);
    expect(state.participants.map(person => person.userId)).toEqual([luis.id]);
    expect(state.decisions.every(decision => decision.userId === luis.id)).toBe(true);
    expect(state.participantMeters).toEqual({ [luis.id]: luisMeters });
    expect(state.meters).toEqual(luisMeters);
    expect(state.events.some(event => event.actorId === ana.id)).toBe(false);
    expect(performanceReport(state).participantReports.map(row => row.userId)).toEqual([luis.id]);
    expect(JSON.stringify(performanceReport(state))).not.toContain('Ana');
  });

  it('nunca reutiliza un seq aunque el último evento borrado fuera de esa persona', () => {
    const before = twoPeople();
    // El último evento (seq 5) es la decisión de Luis: se retira a Luis y la retirada toma el 6, el siguiente el 7.
    const removed = applyCommand(before, { id: 'remove-luis-1', type: 'remove-participant', participantId: luis.id }, instructor, at(5)).state;
    expect(removed.events.at(-1)).toMatchObject({ seq: 6, type: 'participant_removed' });
    const next = applyCommand(removed, { id: 'pause-0001', type: 'pause' }, instructor, at(6));
    expect(next.events[0].seq).toBe(7);
    const seqs = next.state.events.map(event => event.seq);
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it('también vale con la sesión finalizada; solo el instructor de la sesión; el participante debe existir', () => {
    const complete = applyCommand(twoPeople(), { id: 'complete-01', type: 'complete' }, instructor, at(5)).state;
    const removed = applyCommand(complete, { id: 'remove-ana-2', type: 'remove-participant', participantId: ana.id }, instructor, at(6)).state;
    expect(removed.status).toBe('complete');
    expect(removed.participants).toHaveLength(1);
    expect(() => applyCommand(complete, { id: 'pause-after', type: 'pause' }, instructor, at(6))).toThrow(DomainError);
    expect(() => applyCommand(twoPeople(), { id: 'remove-by-luis', type: 'remove-participant', participantId: ana.id }, luis, at(6))).toThrow('Acción reservada al instructor.');
    expect(() => applyCommand(twoPeople(), { id: 'remove-other-inst', type: 'remove-participant', participantId: ana.id }, { ...instructor, id: 'otro-inst' }, at(6))).toThrow(DomainError);
    expect(() => applyCommand(twoPeople(), { id: 'remove-nobody', type: 'remove-participant', participantId: 'user-nadie' }, instructor, at(6))).toThrow('Ese participante no está en la sesión.');
  });

  it('quita de la cola los eventos aún no enviados de esa persona y nadie ve la retirada de un compañero', () => {
    const before = twoPeople();
    before.pendingEvents = before.events.slice();
    const { state } = applyCommand(before, { id: 'remove-ana-3', type: 'remove-participant', participantId: ana.id }, instructor, at(5));
    expect(state.pendingEvents.some(event => event.actorId === ana.id)).toBe(false);
    const view = participantView(state, luis.id);
    expect(JSON.stringify(view)).not.toContain(ana.id);
    expect(view.events.some(event => event.type === 'participant_removed')).toBe(false);
    expect(JSON.stringify(roomPayload(state, luis, {}))).not.toContain(ana.id);
  });

  it('la cola solo deja salir participantId del evento de retirada', () => {
    expect(QUEUE_DETAIL_FIELDS.participant_removed).toEqual(['participantId']);
    expect(queueSafeEvent({ seq: 9, type: 'participant_removed', at: at(9), actorId: 'inst', detail: { participantId: 'user-ana', name: 'Ana' } }).detail)
      .toEqual({ participantId: 'user-ana', nameRedacted: true });
  });

  it('exporta solo los datos de esa persona', () => {
    const data = participantExport(twoPeople(), ana.id, at(9))!;
    expect(data.participant).toMatchObject({ id: ana.id, name: 'Ana', kind: 'member' });
    expect(data.decisions).toEqual([expect.objectContaining({ phaseId: defaultScenario.phases[0].id, optionId: OPTION(0), optionLabel: defaultScenario.phases[0].options[0].label, at: at(3) })]);
    expect(data.joins).toEqual([{ at: at(1) }]);
    expect(data.report.participants).toBe(1);
    expect(JSON.stringify(data)).not.toMatch(/Luis|user-luis/);
    expect(participantExport(twoPeople(), 'user-nadie', at(9))).toBeNull();
  });
});

// ---------------------------------------------------------------------------------------------
// D1: supresión en la persistencia
// ---------------------------------------------------------------------------------------------
describe('persistencia: supresión de una persona en D1', () => {
  const event = (seq: number, type: string, actorId: string, detail: Record<string, string | number | boolean> = {}) =>
    ({ tenantId: 'ufv', sessionId: SESSION, event: { seq, type, at: new Date(Date.UTC(2026, 9, 7, 9, 0, seq)).toISOString(), actorId, detail } }) as never;

  it('borra sus eventos anteriores, no deja entrar los que lleguen tarde y admite los posteriores a la retirada', async () => {
    const { env, eventsOf, db } = setup();
    await persistEvent(env as never, event(2, 'participant_joined', 'user-ana', { participantId: 'user-ana' }));
    await persistEvent(env as never, event(3, 'participant_joined', 'user-luis', { participantId: 'user-luis' }));
    await persistEvent(env as never, event(4, 'decision', 'user-luis', { phaseId: 'p1', optionId: 'o1', durationMs: 10 }));
    await persistEvent(env as never, event(6, 'participant_removed', 'u-prof', { participantId: 'user-ana' }));
    expect(eventsOf('user-ana')).toEqual([]);
    // La decisión de Ana (seq 5) llega por la cola después de la retirada: no entra.
    await persistEvent(env as never, event(5, 'decision', 'user-ana', { phaseId: 'p1', optionId: 'o2', durationMs: 20 }));
    expect(eventsOf('user-ana')).toEqual([]);
    // Si vuelve a unirse más tarde (seq mayor), sí se registra.
    await persistEvent(env as never, event(7, 'participant_joined', 'user-ana', { participantId: 'user-ana' }));
    expect(eventsOf('user-ana')).toEqual([{ seq: 7, type: 'participant_joined' }]);
    // Los demás no se tocan; la retirada queda con el ID seudónimo y nada más.
    expect(eventsOf('user-luis')).toHaveLength(2);
    expect(db.prepare("SELECT detail_json AS d FROM simulation_events WHERE type = 'participant_removed'").get()).toEqual({ d: '{"participantId":"user-ana"}' });
  });
});

// ---------------------------------------------------------------------------------------------
// API: retirar y exportar
// ---------------------------------------------------------------------------------------------
describe('API: retirar a un participante de la sesión', () => {
  it('el instructor retira a un invitado y a un miembro: estado, D1, invitado, auditoría, listado y analítica', async () => {
    const { call, command, joinGuest, state, eventsOf, db } = setup();
    expect((await command(ALUMNA, 'join')).status).toBe(200);
    expect((await command(ALUMNO, 'join')).status).toBe(200);
    const guest = await joinGuest('Invitada Rosa');
    expect((await command(ALUMNA, 'decide', { optionId: OPTION(0) })).status).toBe(200);
    expect((await command(ALUMNO, 'decide', { optionId: OPTION(2) })).status).toBe(200);
    expect((await command({ cookie: guest.cookie }, 'decide', { optionId: OPTION(1) })).status).toBe(200);
    expect(eventsOf(guest.id).map(row => row.type)).toEqual(['participant_joined', 'decision']);

    // Ni un participante ni un invitado ni otra organización pueden retirar a nadie.
    expect((await command(ALUMNO, 'remove-participant', { participantId: 'u-alumna' })).status).toBe(400);
    expect((await command({ cookie: guest.cookie }, 'remove-participant', { participantId: 'u-alumna' })).status).toBe(403);
    expect((await call('POST', `/api/sessions/${SESSION}/commands`, { as: OTRO, body: { id: crypto.randomUUID(), type: 'remove-participant', participantId: 'u-alumna' } })).status).toBe(404);
    expect((await command(PROF, 'remove-participant', { participantId: 'no válido!' })).status).toBe(400);

    const removedGuest = await command(PROF, 'remove-participant', { participantId: guest.id });
    expect(removedGuest.status).toBe(200);
    const body = await json(removedGuest);
    expect(body.state.participants.map((person: { userId: string }) => person.userId)).toEqual(['u-alumna', 'u-alumno']);
    expect(body.report.participantReports).toHaveLength(2);
    expect(eventsOf(guest.id)).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM guests WHERE id = ?').get(guest.id)).toEqual({ n: 0 });
    expect((await call('GET', `/api/sessions/${SESSION}`, { cookie: guest.cookie })).status).toBe(401);
    expect(state().events.some(event => event.actorId === guest.id)).toBe(false);

    expect((await command(PROF, 'remove-participant', { participantId: 'u-alumna' })).status).toBe(200);
    expect(eventsOf('u-alumna')).toEqual([]);
    const audit = db.prepare("SELECT actor_id AS actor, session_id AS session, detail_json AS detail FROM audit_log WHERE action = 'participant_removed' ORDER BY at").all() as Row[];
    expect(audit).toEqual([
      { actor: 'u-prof', session: SESSION, detail: JSON.stringify({ participantId: guest.id }) },
      { actor: 'u-prof', session: SESSION, detail: JSON.stringify({ participantId: 'u-alumna' }) }
    ]);
    // Nada de alias ni nombres en D1 fuera de usuarios: solo IDs seudónimos.
    const stored = JSON.stringify(db.prepare('SELECT * FROM simulation_events').all()) + JSON.stringify(db.prepare('SELECT * FROM audit_log').all());
    expect(stored).not.toMatch(/Rosa|Alumna|alumna@/);

    // La alumna retirada ya no ve la sesión en su listado; la analítica solo cuenta a quien queda.
    const listed = await json(await call('GET', '/api/sessions', { as: ALUMNA }));
    expect(listed.sessions.map((item: { id: string }) => item.id)).not.toContain(SESSION);
    const analytics = await json(await call('GET', '/api/analytics?from=2026-01-01&to=2027-12-31', { as: PROF }));
    expect(analytics.totals).toMatchObject({ participants: 1, decisions: 1 });

    // Con la sesión finalizada también se puede retirar.
    expect((await command(PROF, 'complete')).status).toBe(200);
    expect((await command(PROF, 'remove-participant', { participantId: 'u-alumno' })).status).toBe(200);
    expect(eventsOf('u-alumno')).toEqual([]);
    expect(state().participants).toEqual([]);
  });
});

describe('API: exportar los datos de una persona', () => {
  it('devuelve solo sus datos al instructor que puede gestionar la sesión y lo audita', async () => {
    const { call, command, db } = setup();
    await command(ALUMNA, 'join');
    await command(ALUMNO, 'join');
    await command(ALUMNA, 'decide', { optionId: OPTION(0) });
    await command(ALUMNO, 'decide', { optionId: OPTION(1) });
    const path = `/api/sessions/${SESSION}/participants/u-alumna/export`;
    const response = await call('GET', path, { as: PROF });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    const data = await json(response);
    expect(data.participant).toMatchObject({ id: 'u-alumna', name: 'Alumna', kind: 'member' });
    expect(data.decisions).toEqual([expect.objectContaining({ optionId: OPTION(0), optionLabel: defaultScenario.phases[0].options[0].label })]);
    expect(data.storedEvents.map((event: { type: string }) => event.type)).toEqual(['participant_joined', 'decision']);
    expect(data.report.decisions).toBe(1);
    expect(JSON.stringify(data)).not.toMatch(/Alumno|u-alumno/);
    expect(db.prepare("SELECT detail_json AS d FROM audit_log WHERE action = 'participant_exported'").get()).toEqual({ d: '{"participantId":"u-alumna"}' });

    expect((await call('GET', `/api/sessions/${SESSION}/participants/u-nadie/export`, { as: PROF })).status).toBe(404);
    expect((await call('GET', path, { as: ALUMNA })).status).toBe(403);
    expect((await call('GET', path, { as: OTRO })).status).toBe(404);
    // Otra docente de la organización no la gestiona mientras su creadora siga siendo miembro.
    expect((await call('GET', path, { as: OWNER })).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------------------------
// Visor de auditoría
// ---------------------------------------------------------------------------------------------
describe('API: registro de auditoría (solo propietario)', () => {
  it('pagina el registro de su organización, sin claves sensibles, y lo niega al resto', async () => {
    const { call, db, joinGuest } = setup();
    const guest = await joinGuest('Invitado Ruiz');
    const insert = db.prepare('INSERT INTO audit_log (id,tenant_id,actor_id,session_id,action,at,detail_json) VALUES (?,?,?,?,?,?,?)');
    insert.run('a-1', 'ufv', 'u-prof', SESSION, 'session_created', '2026-10-01T10:00:00.000Z', '{"scenarioId":"x","version":1}');
    insert.run('a-2', 'ufv', 'u-prof', null, 'access_code_issued', '2026-10-01T11:00:00.000Z', '{"userId":"u-alumna","codeId":"c1","code":"123456","token":"t"}');
    insert.run('a-3', 'ufv', 'system', SESSION, 'session_retention_deleted', '2026-10-01T12:00:00.000Z', '{"retentionDays":365}');
    insert.run('a-4', 'ufv', 'u-borrado', null, 'member_deleted', '2026-10-01T12:00:00.000Z', '{"userId":"u-x"}');
    insert.run('a-5', 'other', 'u-otro', FOREIGN, 'session_created', '2026-10-01T13:00:00.000Z', '{}');

    const me = async (as: string) => (await json(await call('GET', '/api/me', { as }))).permissions.viewAudit;
    expect(await me(OWNER)).toBe(true);
    expect(await me(PROF)).toBe(false);
    expect(await me(ALUMNA)).toBe(false);

    expect((await call('GET', '/api/audit', { as: PROF })).status).toBe(403);
    expect((await call('GET', '/api/audit', { as: ALUMNA })).status).toBe(403);
    expect((await call('GET', '/api/audit', { as: OTRO })).status).toBe(403);
    expect((await call('GET', '/api/audit', { cookie: guest.cookie })).status).toBe(403);
    expect((await call('GET', '/api/audit')).status).toBe(401);
    expect((await call('GET', '/api/audit?limit=0', { as: OWNER })).status).toBe(400);
    expect((await call('GET', '/api/audit?before=x', { as: OWNER })).status).toBe(400);

    const all = await json(await call('GET', '/api/audit?limit=200', { as: OWNER }));
    expect(all.nextBefore).toBeNull();
    expect(all.entries.map((entry: { id: string }) => entry.id)).not.toContain('a-5');
    const issued = all.entries.find((entry: { id: string }) => entry.id === 'a-2');
    expect(issued).toMatchObject({ action: 'access_code_issued', actorName: 'Profesora', actorKind: 'member', detail: { userId: 'u-alumna', codeId: 'c1' } });
    expect(issued.detail).not.toHaveProperty('code');
    expect(issued.detail).not.toHaveProperty('token');
    expect(all.entries.find((entry: { id: string }) => entry.id === 'a-3')).toMatchObject({ actorName: 'Sistema', actorKind: 'system', sessionId: SESSION });
    expect(all.entries.find((entry: { id: string }) => entry.id === 'a-4')).toMatchObject({ actorName: 'Persona dada de baja', actorKind: 'former' });
    const joined = all.entries.find((entry: { action: string }) => entry.action === 'guest_joined');
    expect(joined).toMatchObject({ actorName: 'Invitado', actorKind: 'guest' });
    expect(JSON.stringify(all)).not.toContain('Ruiz');

    // Paginación estable con cursor (también con dos entradas en el mismo instante).
    const seen: string[] = [];
    let before: string | null = null;
    do {
      const page: { entries: { id: string }[]; nextBefore: string | null } = await json(await call('GET', `/api/audit?limit=2${before ? `&before=${encodeURIComponent(before)}` : ''}`, { as: OWNER }));
      expect(page.entries.length).toBeLessThanOrEqual(2);
      seen.push(...page.entries.map(entry => entry.id));
      before = page.nextBefore;
    } while (before);
    expect(seen).toEqual(all.entries.map((entry: { id: string }) => entry.id));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('auditDetail descarta claves que podrían llevar secretos o texto libre', () => {
    expect(auditDetail('{"runId":"r","apiKey":"k","api_key":"k","pin":"123456","phrase":"hola","note":"n","count":2}')).toEqual({ runId: 'r', count: 2 });
    expect(auditDetail('no es json')).toEqual({});
    expect(auditDetail('[1,2]')).toEqual({});
  });
});

// ---------------------------------------------------------------------------------------------
// Auditoría de IA: Clef y la línea AI_CALL
// ---------------------------------------------------------------------------------------------
describe('auditoría de IA: Clef y AI_CALL', () => {
  it('registra modelo, tipo, resultado y confianza de Clef, nunca la frase', async () => {
    const ai = { run: async () => ({ answers: { opcion: { choice: 'opcion_2', probabilities: { opcion_2: 0.93 }, confidence: 0.91 } }, usage: { prompt_tokens: 120, completion_tokens: 3, total_tokens: 123 } }) };
    const { call, command } = setup({ ai });
    await command(ALUMNA, 'join');
    const phrase = 'Yo anonimizaría los datos de María López antes de nada';
    const response = await call('POST', '/api/voice/interpret', { as: ALUMNA, body: { sessionId: SESSION, phrase } });
    expect(response.status).toBe(200);
    expect(await json(response)).toMatchObject({ kind: 'decide', option: 1 });
    const entry = logs.filter(line => line.includes('"AI_CALL"')).map(line => JSON.parse(line)).at(-1);
    expect(entry).toMatchObject({ code: 'AI_CALL', provider: 'cloudflare-workers-ai', model: CLEF_MODEL, kind: 'voice-intent', outcome: 'decide', confidence: 0.91, promptTokens: 120, completionTokens: 3, totalTokens: 123 });
    expect(typeof entry.durationMs).toBe('number');
    const all = logs.join('\n');
    expect(all).not.toContain('María');
    expect(all).not.toContain('anonimizaría');
  });

  it('aiCallLog solo admite números, booleanos y códigos cortos; aiUsage ignora lo que no son números', () => {
    const line = aiCallLog({ model: 'm', kind: 'generation', durationMs: 5, result: { usage: { prompt_tokens: 'x', total_tokens: 9 }, response: 'texto generado' }, extra: { outcome: 'decide', text: 'una frase con espacios', ok: true } });
    expect(line).toEqual({ code: 'AI_CALL', provider: 'cloudflare-workers-ai', model: 'm', kind: 'generation', requestId: undefined, durationMs: 5, totalTokens: 9, outcome: 'decide', ok: true });
    expect(aiUsage(null)).toEqual({});
    expect(JSON.stringify(line)).not.toContain('texto generado');
  });
});
