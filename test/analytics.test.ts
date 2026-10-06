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
const { isoWeekStart, parseAnalyticsQuery } = await import('../worker/analytics');
const { applyChoice, defaultScenario } = await import('../shared/simulation');
type Response = import('../worker/analytics').AnalyticsResponse;

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

// D1 sobre SQLite en memoria con las migraciones reales (igual que test/api-security.test.ts).
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
const ALUMNA = 'alumna@ufv.es';
const OTRO = 'otro@other.org';
const AT = '2026-01-01T00:00:00.000Z';
const RANGE = 'from=2026-08-01&to=2026-10-31';

function setup() {
  const { d1, db } = createD1();
  db.exec(`INSERT INTO tenants (id,name,created_at) VALUES ('ufv','UFV','${AT}'), ('other','Otra','${AT}')`);
  for (const [id, email, tenant, role] of [['u-prof', PROF, 'ufv', 'instructor'], ['u-alumna', ALUMNA, 'ufv', 'participant'], ['u-otro', OTRO, 'other', 'instructor']]) {
    db.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').run(id, email, id, AT);
    db.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').run(tenant, id, role);
  }
  db.prepare("INSERT INTO scenarios (id,version,tenant_id,title,definition_json,created_by,created_at) VALUES (?,?,NULL,?,?,'system',?)")
    .run(defaultScenario.id, defaultScenario.version, defaultScenario.title, JSON.stringify(defaultScenario), AT);
  const env = { DB: d1, SESSIONS: {}, ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com', ACCESS_AUD: 'aud', LEGACY_ACCESS_AUTH: 'true',
    ACCESS_CODE_PEPPER: 'test-only-pepper-with-at-least-32-characters' };
  const app = createApp(false);
  const get = (query: string, as = PROF) => app.request(`https://axyro.test/api/analytics${query ? `?${query}` : ''}`,
    { headers: { 'cf-access-jwt-assertion': `valid:${as}`, 'sec-fetch-site': 'same-origin' } }, env as never);
  const data = async (query: string, as = PROF) => {
    const response = await get(query, as);
    expect(response.status).toBe(200);
    return await response.json() as Response;
  };
  const session = (id: string, tenant: string, status: string, createdAt: string, name: string | null = null) =>
    db.prepare('INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at,completed_at,name) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, tenant, tenant === 'ufv' ? 'u-prof' : 'u-otro', defaultScenario.id, defaultScenario.version, status, createdAt, status === 'complete' ? createdAt : null, name);
  const seqs = new Map<string, number>();
  const event = (sessionId: string, tenant: string, type: string, actorId: string, detail: Record<string, unknown> = {}) => {
    const seq = (seqs.get(sessionId) ?? 1) + 1;
    seqs.set(sessionId, seq);
    db.prepare('INSERT INTO simulation_events (tenant_id,session_id,seq,type,at,actor_id,detail_json) VALUES (?,?,?,?,?,?,?)')
      .run(tenant, sessionId, seq, type, AT, actorId, JSON.stringify(detail));
  };
  return { db, get, data, session, event };
}

const phases = defaultScenario.phases;
const best = (index: number) => phases[index].options.find(option => option.quality === 'best')!;
const poor = (index: number) => phases[index].options.find(option => option.quality === 'poor')!;

/**
 * Sesión finalizada «s1» (UFV, lunes 2026-10-05): u-a elige la mejor opción en todas las fases (10 s, 20 s, …);
 * u-b solo decide en la primera, con una opción «poor» (4 s); un simulado elige la mejor en todas (1 s);
 * un incidente de +5 de riesgo al final. Además, una sesión de otra organización que no debe contarse nunca.
 */
function fixture() {
  const ctx = setup();
  const { session, event } = ctx;
  session('s1', 'ufv', 'complete', '2026-10-05T09:00:00.000Z', 'Grupo A');
  for (const actor of ['u-a', 'u-b', 'sim-s1-01']) event('s1', 'ufv', 'participant_joined', actor, { participantId: actor });
  phases.forEach((phase, index) => {
    event('s1', 'ufv', 'decision', 'u-a', { phaseId: phase.id, optionId: best(index).id, durationMs: 10000 * (index + 1) });
    if (index === 0) event('s1', 'ufv', 'decision', 'u-b', { phaseId: phase.id, optionId: poor(0).id, durationMs: 4000 });
    event('s1', 'ufv', 'decision', 'sim-s1-01', { phaseId: phase.id, optionId: best(index).id, durationMs: 1000 });
    if (index < phases.length - 1) event('s1', 'ufv', 'phase_advanced', 'u-prof', { phaseId: phases[index + 1].id });
  });
  event('s1', 'ufv', 'incident', 'u-prof', { riskDelta: 5, noteRedacted: true });
  event('s1', 'ufv', 'completed', 'u-prof', { score: 70 });
  session('o1', 'other', 'complete', '2026-10-05T10:00:00.000Z');
  for (const actor of ['u-x', 'u-y']) {
    event('o1', 'other', 'participant_joined', actor, { participantId: actor });
    event('o1', 'other', 'decision', actor, { phaseId: phases[0].id, optionId: poor(0).id, durationMs: 99000 });
  }
  return ctx;
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const round3 = (value: number) => Math.round(value * 1000) / 1000;

describe('GET /api/analytics', () => {
  it('es solo para instructores y valida los filtros', async () => {
    const { get } = setup();
    expect((await get('', ALUMNA)).status).toBe(403);
    for (const query of ['from=ayer', 'from=2026-10-10&to=2026-10-01', 'includeSimulated=quizá', 'scenarioId=a%20b']) {
      const response = await get(query);
      expect(response.status, query).toBe(400);
      expect(await response.json()).toHaveProperty('error');
    }
    expect((await get(`${RANGE}&includeSimulated=false&scenarioId=${defaultScenario.id}`)).headers.get('cache-control')).toBe('private, no-store');
  });

  it('sin datos devuelve ceros, listas vacías, tasas null y la tendencia rellenada con ceros (sin NaN)', async () => {
    const { data } = setup();
    const body = await data(RANGE);
    expect(body.range).toEqual({ from: '2026-08-01T00:00:00.000Z', to: '2026-10-31T23:59:59.999Z' });
    expect(body.totals).toEqual({ sessions: 0, sessionsCompleted: 0, sessionsActive: 0, participants: 0, simulatedParticipants: 0, decisions: 0,
      completionRate: null, optimalRate: null, avgDecisionSeconds: null });
    expect(body.trend).toHaveLength(12);
    expect(body.trend[11].week).toBe('2026-10-26');
    expect(body.trend[0].week).toBe('2026-08-10');
    for (const week of body.trend) expect(week).toEqual({ week: week.week, sessions: 0, participants: 0, decisions: 0, optimalRate: null });
    expect([body.scenarios, body.phases, body.meters, body.recentSessions]).toEqual([[], [], [], []]);
    expect(JSON.stringify(body)).not.toContain('NaN');
  });

  it('calcula tasas, reparto por opción y mediana sin simulados; nunca cuenta otra organización', async () => {
    const { data } = fixture();
    const body = await data(RANGE);
    const P = phases.length;
    const durations = [...phases.map((_, index) => 10000 * (index + 1)), 4000];
    expect(body.totals).toEqual({ sessions: 1, sessionsCompleted: 1, sessionsActive: 0, participants: 2, simulatedParticipants: 1, decisions: P + 1,
      completionRate: 0.5, optimalRate: round3(P / (P + 1)), avgDecisionSeconds: Math.round(median(durations) / 100) / 10 });
    expect(body.scenarios).toEqual([{ scenarioId: defaultScenario.id, title: defaultScenario.title, sessions: 1, participants: 2, decisions: P + 1,
      optimalRate: round3(P / (P + 1)), completionRate: 0.5 }]);
    // La fase con más errores va primero.
    expect(body.phases).toHaveLength(P);
    const first = body.phases[0];
    expect(first).toMatchObject({ phaseId: phases[0].id, phaseTitle: phases[0].title, scenarioTitle: defaultScenario.title, decisions: 2, optimalRate: 0.5,
      mostChosenNonOptimal: { optionId: poor(0).id, label: poor(0).label, share: 0.5 } });
    expect(first.distribution).toEqual(phases[0].options.map(option => ({ optionId: option.id, label: option.label, quality: option.quality,
      count: option.id === best(0).id || option.id === poor(0).id ? 1 : 0, share: option.id === best(0).id || option.id === poor(0).id ? 0.5 : 0 })));
    for (const phase of body.phases.slice(1)) expect(phase).toMatchObject({ decisions: 1, optimalRate: 1, mostChosenNonOptimal: null });
    expect(body.recentSessions).toEqual([{ id: 's1', name: 'Grupo A', scenarioTitle: defaultScenario.title, status: 'complete',
      createdAt: '2026-10-05T09:00:00.000Z', participants: 2, optimalRate: round3(P / (P + 1)) }]);
    expect(body.trend.find(week => week.week === '2026-10-05')).toEqual({ week: '2026-10-05', sessions: 1, participants: 2, decisions: P + 1, optimalRate: round3(P / (P + 1)) });
    expect(body.trend.filter(week => week.sessions > 0)).toHaveLength(1);
    // Indicadores: reproducción de decisiones + incidente de clase (+5 de riesgo) para u-a y u-b.
    let a = { ...defaultScenario.initialMeters };
    phases.forEach((_, index) => { a = applyChoice(a, best(index)); });
    const b = applyChoice({ ...defaultScenario.initialMeters }, poor(0));
    a.risk = Math.min(100, a.risk + 5);
    b.risk = Math.min(100, b.risk + 5);
    const labels = defaultScenario.meterLabels!;
    expect(body.meters).toEqual((['relationship', 'margin', 'risk'] as const).map(meter => {
      const avgStart = defaultScenario.initialMeters[meter];
      const avgEnd = Math.round(((a[meter] + b[meter]) / 2) * 10) / 10;
      return { scenarioId: defaultScenario.id, meter, label: labels[meter], avgStart, avgEnd, delta: Math.round((avgEnd - avgStart) * 10) / 10 };
    }));
    // Solo agregados: ningún identificador de persona en la respuesta.
    expect(JSON.stringify(body)).not.toMatch(/u-a|u-b|sim-s1|u-x|u-y/);
    // La otra organización ve solo lo suyo.
    const other = await data(RANGE, OTRO);
    expect(other.totals).toMatchObject({ sessions: 1, participants: 2, decisions: 2, optimalRate: 0, completionRate: 0, avgDecisionSeconds: 99 });
    expect(other.recentSessions.map(row => row.id)).toEqual(['o1']);
  });

  it('includeSimulated suma los simulados a decisiones y tasas, pero totals.participants sigue contando solo personas', async () => {
    const { data } = fixture();
    const P = phases.length;
    const body = await data(`${RANGE}&includeSimulated=true`);
    expect(body.totals).toMatchObject({ participants: 2, simulatedParticipants: 1, decisions: 2 * P + 1,
      optimalRate: round3((2 * P) / (2 * P + 1)), completionRate: round3(2 / 3) });
    expect(body.scenarios[0]).toMatchObject({ participants: 3, decisions: 2 * P + 1 });
    expect(body.recentSessions[0].participants).toBe(3);
  });

  it('filtra por fecha de creación de la sesión y por escenario', async () => {
    const { data, session, event } = fixture();
    session('s-junio', 'ufv', 'active', '2026-06-01T08:00:00.000Z');
    event('s-junio', 'ufv', 'participant_joined', 'u-c', { participantId: 'u-c' });
    event('s-junio', 'ufv', 'decision', 'u-c', { phaseId: phases[0].id, optionId: best(0).id, durationMs: 5000 });
    expect((await data(RANGE)).totals).toMatchObject({ sessions: 1, participants: 2 });
    const wide = await data('from=2026-05-01&to=2026-10-31');
    expect(wide.totals).toMatchObject({ sessions: 2, sessionsActive: 1, sessionsCompleted: 1, participants: 3, decisions: phases.length + 2 });
    expect(wide.recentSessions.map(row => row.id)).toEqual(['s1', 's-junio']);
    // Rango corto: la tendencia empieza en la semana de `from`.
    const june = await data('from=2026-06-01&to=2026-06-07');
    expect(june.totals.sessions).toBe(1);
    expect(june.trend.map(week => week.week)).toEqual(['2026-06-01']);
    expect((await data('from=2026-05-01&to=2026-10-31&scenarioId=supplier-negotiation')).totals.sessions).toBe(0);
  });

  it('parseAnalyticsQuery y isoWeekStart', () => {
    const now = new Date('2026-10-06T12:00:00.000Z');
    expect(parseAnalyticsQuery({}, now)).toEqual({ from: '2025-10-06T12:00:00.000Z', to: '2026-10-06T12:00:00.000Z', scenarioId: null, includeSimulated: false });
    expect(parseAnalyticsQuery({ includeSimulated: '1' }, now).includeSimulated).toBe(true);
    expect(isoWeekStart('2026-10-11T23:00:00.000Z')).toBe('2026-10-05');
    expect(isoWeekStart('2026-10-05T00:00:00.000Z')).toBe('2026-10-05');
  });
});
