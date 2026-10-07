import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
vi.mock('jose', () => ({
  createRemoteJWKSet: () => 'jwks',
  jwtVerify: async (token: string) => {
    if (!token.startsWith('valid:')) throw new Error('firma no válida');
    return { payload: { email: token.slice('valid:'.length) } };
  }
}));

const { createApp } = await import('../worker/app');
const { guestAllowed } = await import('../worker/guests');
const { parseIncludeSimulated } = await import('../worker/benchmark');
const { defaultScenario } = await import('../shared/simulation');
type Response = import('../worker/benchmark').BenchmarkResponse;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// D1 sobre SQLite en memoria con las migraciones reales (igual que test/analytics.test.ts).
function createD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  const statement = (sql: string, args: unknown[] = []) => {
    const params = args as (string | number | null)[];
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      first: async () => { const row = db.prepare(sql).get(...params); return row ? { ...row } : null; },
      all: async () => ({ success: true, results: db.prepare(sql).all(...params).map(row => ({ ...row })), meta: { changes: 0 } }),
      run: async () => ({ success: true, results: [], meta: { changes: Number(db.prepare(sql).run(...params).changes) } })
    };
  };
  return { d1: { prepare: (sql: string) => statement(sql), batch: async () => [] }, db };
}

const PROF = 'prof@ufv.es';
const PROF2 = 'prof2@ufv.es';
const ALUMNA = 'alumna@ufv.es';
const OTRO = 'otro@other.org';
const recent = new Date(Date.now() - 2 * 86400000).toISOString();
const phases = defaultScenario.phases;
const best = (index: number) => phases[index].options.find(option => option.quality === 'best')!;
const poor = (index: number) => phases[index].options.find(option => option.quality === 'poor')!;

function setup() {
  const { d1, db } = createD1();
  db.exec(`INSERT INTO tenants (id,name,created_at) VALUES ('ufv','UFV','${recent}'), ('other','Otra','${recent}')`);
  for (const [id, email, tenant, role] of [['u-prof', PROF, 'ufv', 'instructor'], ['u-prof2', PROF2, 'ufv', 'instructor'], ['u-alumna', ALUMNA, 'ufv', 'participant'], ['u-otro', OTRO, 'other', 'instructor']]) {
    db.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').run(id, email, id, recent);
    db.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').run(tenant, id, role);
  }
  db.prepare("INSERT INTO scenarios (id,version,tenant_id,title,definition_json,created_by,created_at) VALUES (?,?,NULL,?,?,'system',?)")
    .run(defaultScenario.id, defaultScenario.version, defaultScenario.title, JSON.stringify(defaultScenario), recent);
  const env = { DB: d1, SESSIONS: {}, ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com', ACCESS_AUD: 'aud', LEGACY_ACCESS_AUTH: 'true',
    ACCESS_CODE_PEPPER: 'test-only-pepper-with-at-least-32-characters' };
  const app = createApp(false);
  const get = (sessionId: string, query = '', as = PROF) => app.request(`https://axyro.test/api/sessions/${sessionId}/benchmark${query ? `?${query}` : ''}`,
    { headers: { 'cf-access-jwt-assertion': `valid:${as}`, 'sec-fetch-site': 'same-origin' } }, env as never);
  const data = async (sessionId: string, query = '', as = PROF) => {
    const response = await get(sessionId, query, as);
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    return await response.json() as Response;
  };
  const session = (id: string, tenant: string, createdAt = recent) =>
    db.prepare('INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at,completed_at,name) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, tenant, tenant === 'ufv' ? 'u-prof' : 'u-otro', defaultScenario.id, defaultScenario.version, 'complete', createdAt, createdAt, null);
  const seqs = new Map<string, number>();
  const decide = (sessionId: string, tenant: string, actorId: string, phase: number, optionId: string) => {
    const seq = (seqs.get(sessionId) ?? 1) + 1;
    seqs.set(sessionId, seq);
    db.prepare('INSERT INTO simulation_events (tenant_id,session_id,seq,type,at,actor_id,detail_json) VALUES (?,?,?,?,?,?,?)')
      .run(tenant, sessionId, seq, 'decision', recent, actorId, JSON.stringify({ phaseId: phases[phase].id, optionId, durationMs: 1000 }));
  };
  return { get, data, session, decide };
}

describe('GET /api/sessions/:id/benchmark', () => {
  it('solo instructores de la organización; los invitados quedan fuera por la lista cerrada', async () => {
    const { get, session } = setup();
    session('s1', 'ufv');
    expect((await get('s1', '', ALUMNA)).status).toBe(403);
    expect((await get('s1', '', OTRO)).status).toBe(404);
    expect((await get('no-existe')).status).toBe(404);
    expect((await get('s1', 'includeSimulated=quizá')).status).toBe(400);
    // Cualquier instructor de la organización, no solo el creador.
    expect((await get('s1', '', PROF2)).status).toBe(200);
    expect(guestAllowed('GET', '/api/sessions/s1/benchmark', 's1')).toBe(false);
  });

  it('sin otras sesiones con datos: tasas null y ningún NaN', async () => {
    const { data, session } = setup();
    session('s1', 'ufv');
    const body = await data('s1');
    expect(body).toEqual({ session: { decisions: 0, optimalRate: null }, organization: { sessions: 0, decisions: 0, optimalRate: null }, includeSimulated: false });
    expect(JSON.stringify(body)).not.toContain('NaN');
  });

  it('separa esta sesión del resto, excluye simulados y nunca cuenta otra organización', async () => {
    const { data, session, decide } = setup();
    session('s1', 'ufv'); session('s2', 'ufv'); session('s3', 'ufv'); session('o1', 'other');
    // Esta sesión: 2 de 3 óptimas, más un simulado y un duplicado que no cuentan.
    decide('s1', 'ufv', 'u-a', 0, best(0).id);
    decide('s1', 'ufv', 'u-a', 0, poor(0).id);
    decide('s1', 'ufv', 'u-a', 1, best(1).id);
    decide('s1', 'ufv', 'u-b', 0, poor(0).id);
    decide('s1', 'ufv', 'sim-s1-01', 0, poor(0).id);
    // Otras sesiones de la UFV: 1 óptima de 4 (s2) y solo un simulado (s3).
    decide('s2', 'ufv', 'u-c', 0, best(0).id);
    for (const actor of ['u-d', 'u-e', 'u-f']) decide('s2', 'ufv', actor, 0, poor(0).id);
    decide('s3', 'ufv', 'sim-s3-01', 0, best(0).id);
    // Otra organización: nunca entra.
    for (const actor of ['u-x', 'u-y']) decide('o1', 'other', actor, 0, best(0).id);

    const body = await data('s1');
    expect(body).toEqual({ session: { decisions: 3, optimalRate: 0.667 }, organization: { sessions: 1, decisions: 4, optimalRate: 0.25 }, includeSimulated: false });
    expect(JSON.stringify(body)).not.toMatch(/u-[a-f]|sim-|u-x|u-y/);

    const withSim = await data('s1', 'includeSimulated=true');
    expect(withSim).toEqual({ session: { decisions: 4, optimalRate: 0.5 }, organization: { sessions: 2, decisions: 5, optimalRate: 0.4 }, includeSimulated: true });

    // Desde otra sesión, s1 pasa a ser parte de la media.
    expect((await data('s2')).organization).toEqual({ sessions: 1, decisions: 3, optimalRate: 0.667 });
    // La otra organización solo ve lo suyo (su propia sesión, sin media).
    expect(await data('o1', '', OTRO)).toEqual({ session: { decisions: 2, optimalRate: 1 }, organization: { sessions: 0, decisions: 0, optimalRate: null }, includeSimulated: false });
  });

  it('las sesiones fuera del plazo de retención no entran en la media', async () => {
    const { data, session, decide } = setup();
    session('s1', 'ufv');
    session('old', 'ufv', '2020-01-01T00:00:00.000Z');
    decide('old', 'ufv', 'u-z', 0, best(0).id);
    expect((await data('s1')).organization).toEqual({ sessions: 0, decisions: 0, optimalRate: null });
  });

  it('parseIncludeSimulated', () => {
    expect([undefined, '', 'false', '0', 'TRUE', '1', 'x'].map(value => parseIncludeSimulated(value))).toEqual([false, false, false, false, true, true, null]);
  });
});
