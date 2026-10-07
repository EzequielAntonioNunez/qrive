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
const { AI_EFFECTS, AI_METER_LABELS, aiScenarioProblem, draftFromSituations, isAiScenarioIdFor } = await import('../shared/ai-draft');
const { validateScenario, ScenarioError } = await import('../shared/scenario');
const { applyCommand, createSession } = await import('../shared/engine');
const { catalogScenarios, participantView, performanceReport } = await import('../shared/simulation');
type Scenario = import('../shared/simulation').Scenario;
type DraftSituation = import('../shared/ai-draft').DraftSituation;

beforeEach(() => {
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation(() => {});
});

// ---------------------------------------------------------------------------------------------
// Entorno: D1 sobre SQLite con las migraciones reales, R2 en memoria, Workers AI determinista y DO simulado.
// ---------------------------------------------------------------------------------------------
function createD1() {
  const db = new DatabaseSync(':memory:');
  const dir = new URL('../migrations/', import.meta.url);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql')).sort()) db.exec(readFileSync(new URL(file, dir), 'utf8'));
  const isQuery = (sql: string) => /^\s*SELECT/i.test(sql);
  const statement = (sql: string, args: unknown[] = []) => {
    const params = args as (string | number | null)[];
    const run = () => ({ success: true, results: [], meta: { changes: Number(db.prepare(sql).run(...params).changes) } });
    const all = () => ({ success: true, results: db.prepare(sql).all(...params).map(row => ({ ...row })), meta: { changes: 0 } });
    return {
      bind: (...next: unknown[]) => statement(sql, next),
      first: async () => { const row = db.prepare(sql).get(...params); return row ? { ...row } : null; },
      all: async () => all(),
      run: async () => run(),
      execute: () => (isQuery(sql) ? all() : run())
    };
  };
  return {
    db,
    d1: {
      prepare: (sql: string) => statement(sql),
      batch: async (items: ReturnType<typeof statement>[]) => {
        db.exec('BEGIN');
        try { const results = items.map(item => item.execute()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; }
      }
    }
  };
}

function fakeR2() {
  const store = new Map<string, Uint8Array>();
  return {
    put: async (key: string, value: ArrayBuffer | Uint8Array) => { store.set(key, value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value.slice(0))); return {}; },
    get: async (key: string) => { const value = store.get(key); return value ? { arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) } : null; },
    delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key); },
    list: async ({ prefix }: { prefix: string }) => ({ objects: [...store.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false })
  };
}

function fakeEmbedding(text: string): number[] {
  const vector = new Array(64).fill(0);
  for (const word of text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').match(/[a-zñ]{4,}/g) ?? []) {
    let hash = 0;
    for (const char of word.slice(0, 6)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    vector[hash % 64] += 1;
  }
  vector[63] += 0.01;
  return vector;
}

function situationJson(tag: string) {
  return {
    title: `Situación ${tag}`,
    narration: `Preparas una actividad y debes decidir cómo usar la IA con los trabajos (${tag}). ¿Qué harías?`,
    options: [
      { label: `Anonimizo los datos antes de usar la herramienta (${tag})`, quality: 'best', consequence: 'Se protegen los datos.', rationale: 'La guía exige anonimizar antes de usar la IA.', reaction: 'Buena decisión.', sources: ['F1'] },
      { label: `Uso la herramienta corporativa autorizada (${tag})`, quality: 'acceptable', consequence: 'Es seguro, pero mejorable.', rationale: 'Está autorizada.', reaction: 'Razonable.', sources: ['F1'] },
      { label: `Pego el texto con nombres en una IA externa (${tag})`, quality: 'poor', consequence: 'Se exponen datos personales.', rationale: 'Está prohibido.', reaction: 'Cuidado.', sources: ['F1'] },
      { label: `Dejo que la IA ponga la nota final (${tag})`, quality: 'poor', consequence: 'Nadie revisa la nota.', rationale: 'La IA no puede calificar.', reaction: 'Cuidado.', sources: ['F1'] }
    ]
  };
}

function fakeAi() {
  let situations = 0;
  return {
    run: async (model: string, input: any) => {
      if (model === '@cf/baai/bge-m3') return { shape: [input.text.length, 64], data: input.text.map((text: string) => fakeEmbedding(text)) };
      const user = String(input.messages?.[1]?.content ?? '');
      if (user.includes('Crea la situación')) return { choices: [{ message: { content: JSON.stringify(situationJson(String(++situations))) } }] };
      if (user.includes('La simulación ha terminado')) return { response: JSON.stringify({ spoken: 'Hemos terminado.', takeaways: ['Anonimiza.', 'Una persona califica.', 'Comunica incidentes.'] }) };
      throw new Error('llamada inesperada');
    },
    toMarkdown: async () => []
  };
}

/** Durable Object de sesión simulado: guarda el escenario con el que se crea cada sesión. */
function fakeSessions() {
  const created: Scenario[] = [];
  const namespace = {
    idFromName: (name: string) => name,
    get: (name: string) => ({
      fetch: async (_url: string, init: RequestInit) => {
        const body = JSON.parse(String(init.body)) as { op: string; scenario?: Scenario };
        if (body.op === 'create' && body.scenario) created.push(body.scenario);
        return Response.json({ state: { id: name.split(':')[1], status: 'active', phaseIndex: 0, scenario: body.scenario, events: [] }, report: { score: 0 } });
      }
    }),
    jurisdiction: () => namespace
  };
  return { namespace, created };
}

const NOW = '2026-01-01T00:00:00.000Z';
const PROF = 'prof@ufv.es';
const PROF2 = 'prof2@ufv.es';
const ALUMNA = 'alumna@ufv.es';
const OTRO = 'otro@other.org';
const GUIDE = `# Guía de IA en la docencia

## Datos personales
No se deben introducir datos personales de estudiantes en herramientas de IA externas. Antes de usar un texto con la IA, el profesorado debe anonimizarlo.

## Evaluación
La IA no puede calificar de forma automática trabajos de los estudiantes. La calificación final siempre la decide una persona.`;

function setup(options: { flag?: boolean } = {}) {
  const { d1, db } = createD1();
  db.exec(`INSERT INTO tenants (id,name,created_at) VALUES ('ufv','UFV','${NOW}'), ('other','Otra','${NOW}')`);
  for (const [id, email, name, tenant, role] of [['u-prof', PROF, 'Profesora Uno', 'ufv', 'instructor'], ['u-prof2', PROF2, 'Profesor Dos', 'ufv', 'instructor'], ['u-alumna', ALUMNA, 'Alumna', 'ufv', 'participant'], ['u-otro', OTRO, 'Otro', 'other', 'instructor']]) {
    db.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').run(id, email, name, NOW);
    db.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').run(tenant, id, role);
  }
  const sessions = fakeSessions();
  const env = {
    DB: d1, FILES: fakeR2(), AI: fakeAi(), SESSIONS: sessions.namespace,
    ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com', ACCESS_AUD: 'aud', LEGACY_ACCESS_AUTH: 'true',
    FEATURE_FLAGS: JSON.stringify({ ai_live_demo: options.flag ?? true })
  };
  const pending: Promise<unknown>[] = [];
  const executionCtx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); }, passThroughOnException: () => {}, props: {} };
  const app = createApp(false);
  const call = async (method: string, path: string, init: { as?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' };
    if (init.as) headers['cf-access-jwt-assertion'] = `valid:${init.as}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    Object.assign(headers, init.headers);
    for (const [key, value] of Object.entries(headers)) if (value === '') delete headers[key];
    return app.request(`https://axyro.test${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }, env as never, executionCtx as never);
  };
  const flush = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  return { db, call, flush, sessions };
}

async function json<T = any>(response: Response): Promise<T> { return await response.json() as T; }

/** Colección con la guía y una partida con dos situaciones generadas (de cuatro previstas). */
async function runWithTwoSituations(context: ReturnType<typeof setup>, focus?: string) {
  const created = await json(await context.call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'Guía IA docencia' } }));
  const collectionId = created.collection.id as string;
  expect((await context.call('POST', `/api/knowledge/collections/${collectionId}/documents`, { as: PROF, body: { name: 'guia.md', text: GUIDE } })).status).toBe(201);
  const run = await json(await context.call('POST', '/api/ai-runs', { as: PROF, body: { collectionId, situations: 4, ...(focus ? { focus } : {}) } }));
  await context.flush();
  expect((await context.call('POST', `/api/ai-runs/${run.run.id}/next`, { as: PROF, body: {} })).status).toBe(200);
  await context.flush();
  return { collectionId, runId: run.run.id as string };
}

function situation(n: number, extra: Partial<DraftSituation> = {}): DraftSituation {
  return {
    title: `Situación ${n}`,
    narration: `Narración de la situación ${n}. ¿Qué harías?`,
    sources: [{ document: 'guia.pdf', location: 'p. 3' }, { document: 'guia.pdf', location: 'p. 3' }, { document: 'normativa.docx' }],
    options: [
      { label: `Mejor ${n}`, quality: 'best', consequence: 'Bien.', rationale: 'Es lo que dice la guía. Además protege los datos.' },
      { label: `Aceptable ${n}`, quality: 'acceptable', consequence: 'Regular.', rationale: 'Mejorable.' },
      { label: `Mala ${n}`, quality: 'poor', consequence: 'Mal.', rationale: 'Prohibido.' },
      { label: `Otra mala ${n}`, quality: 'poor', consequence: 'Mal.', rationale: 'Arriesgado.' }
    ],
    ...extra
  };
}

describe('borrador de escenario a partir de una partida (conversión determinista)', () => {
  const runId = '3f2a9c1e-0000-4000-8000-000000000001';

  it('produce un escenario que valida con shared/scenario.ts, con ids únicos, VictorIA y efectos según la valoración', () => {
    const { draft, warnings } = draftFromSituations({ runId, collectionId: 'col-1', collectionName: 'Guía IA', focus: 'evaluación de trabajos', total: 3, situations: [situation(1), situation(2), situation(3)] });
    expect(validateScenario(draft)).toEqual(draft);
    expect(draft.id).toBe('ia-evaluacion-de-trabajos-3f2a9c');
    expect(isAiScenarioIdFor(draft.id, runId)).toBe(true);
    expect(isAiScenarioIdFor(draft.id, 'aaaaaaaa-0000')).toBe(false);
    expect(draft.version).toBe(1);
    expect(draft.title).toBe('Evaluación de trabajos');
    expect(draft.character.name).toBe('VictorIA');
    expect(draft.meterLabels).toEqual(AI_METER_LABELS);
    expect(draft.origin).toEqual({ kind: 'ai', runId, collectionId: 'col-1' });
    expect(draft.phases.map(phase => phase.id)).toEqual(['3f2a9c1e-s1', '3f2a9c1e-s2', '3f2a9c1e-s3']);
    // Ninguna fase coincide con fases del catálogo (las locuciones y reacciones pregrabadas se buscan por id de fase).
    const catalogPhases = new Set(catalogScenarios.flatMap(item => item.phases.map(phase => phase.id)));
    expect(draft.phases.some(phase => catalogPhases.has(phase.id))).toBe(false);
    const phase = draft.phases[0];
    expect(phase.characterLine).toBe('Narración de la situación 1. ¿Qué harías?');
    expect(phase.briefing).toBe('Situación basada en: guia.pdf (p. 3); normativa.docx.');
    expect(phase.takeaway).toBe('Es lo que dice la guía. Además protege los datos.');
    expect(phase.timeLimitSec).toBe(120);
    expect(phase.options.map(option => option.id)).toEqual(['opcion-a', 'opcion-b', 'opcion-c', 'opcion-d']);
    for (const option of phase.options) {
      expect(option.effects).toEqual(AI_EFFECTS[option.quality!]);
      expect(option.skill).toBe('risk');
    }
    expect(warnings).toHaveLength(1);
    expect(aiScenarioProblem(draft)).toBeNull();
  });

  it('avisa si la partida no está completa y recorta los textos a los límites de la validación', () => {
    const long = situation(1, { title: 'T'.repeat(95), narration: `${'palabra '.repeat(90)}final` });
    const { draft, warnings } = draftFromSituations({ runId, collectionId: 'col-1', collectionName: 'Guía', focus: null, total: 5, situations: [long, situation(2)] });
    expect(draft.title).toBe('Guía');
    expect(draft.phases[0].title.length).toBeLessThanOrEqual(80);
    expect(draft.phases[0].characterLine.length).toBeLessThanOrEqual(600);
    expect(warnings.some(item => item.includes('5 situaciones previstas') && item.includes('solo se han generado 2'))).toBe(true);
    expect(warnings.some(item => item.includes('recortado'))).toBe(true);
  });

  it('las reglas de publicación exigen dos situaciones y una mejor opción por situación', () => {
    const { draft } = draftFromSituations({ runId, collectionId: 'col-1', collectionName: 'Guía', focus: null, total: 2, situations: [situation(1), situation(2)] });
    expect(aiScenarioProblem({ ...draft, phases: draft.phases.slice(0, 1) })).toMatch(/al menos 2/);
    const noBest = structuredClone(draft);
    noBest.phases[1].options = noBest.phases[1].options.map(option => ({ ...option, quality: 'acceptable' as const }));
    expect(aiScenarioProblem(noBest)).toMatch(/Situación 2: marca al menos una opción como mejor/);
    expect(() => validateScenario({ ...draft, origin: { kind: 'otra' } })).toThrow(ScenarioError);
  });

  it('funciona en el motor de principio a fin: unión, decisiones, avance, informe y vista filtrada del participante', () => {
    const { draft } = draftFromSituations({ runId, collectionId: 'col-1', collectionName: 'Guía', focus: null, total: 3, situations: [situation(1), situation(2), situation(3)] });
    const instructor = { id: 'u-prof', name: 'Profesora', role: 'instructor' as const };
    const ana = { id: 'guest-ana', name: 'Ana', role: 'participant' as const };
    const luis = { id: 'guest-luis', name: 'Luis', role: 'participant' as const };
    let state = createSession('s-1', 'ufv', instructor, NOW, draft);
    let at = Date.parse(NOW);
    const run = (command: Parameters<typeof applyCommand>[1], actor: typeof instructor | typeof ana) => { at += 5000; state = applyCommand(state, command, actor, new Date(at).toISOString()).state; };
    run({ id: 'j1', type: 'join' }, ana);
    run({ id: 'j2', type: 'join' }, luis);
    // Antes de decidir, el participante no ve valoraciones, porqués, efectos ni idea clave.
    const hidden = participantView(state, ana.id).scenario.phases[0];
    expect(hidden.takeaway).toBeUndefined();
    expect(hidden.options.every(option => option.quality === undefined && option.rationale === undefined && (option as { effects?: unknown }).effects === undefined)).toBe(true);
    draft.phases.forEach((phase, index) => {
      run({ id: `a-${index}`, type: 'decide', optionId: 'opcion-a' }, ana);
      run({ id: `l-${index}`, type: 'decide', optionId: 'opcion-c' }, luis);
      if (index < draft.phases.length - 1) run({ id: `adv-${index}`, type: 'advance' }, instructor);
    });
    run({ id: 'end', type: 'complete' }, instructor);
    expect(state.status).toBe('complete');
    const report = performanceReport(state);
    expect(report.decisions).toBe(6);
    expect(report.correctDecisionsPct).toBe(50);
    expect(report.criticalDecisions).toBe(3);
    const anaReport = report.participantReports.find(item => item.userId === ana.id)!;
    expect(anaReport.meters).toEqual({ relationship: 74, margin: 74, risk: 14 });
    expect(anaReport.objectivesMet).toBe(3);
    expect(anaReport.timeline[0].takeaway).toBe(draft.phases[0].takeaway);
    expect(report.participantReports.find(item => item.userId === luis.id)!.objectivesMet).toBe(0);
  });
});

describe('API: POST /api/ai-runs/:id/draft y /publish', () => {
  it('convierte solo las situaciones generadas, publica con procedencia y aparece solo en la propia organización', async () => {
    const context = setup();
    const { call, db, sessions } = context;
    const { collectionId, runId } = await runWithTwoSituations(context, 'protección de datos');

    const listed = await json(await call('GET', `/api/ai-runs?collectionId=${collectionId}`, { as: PROF }));
    expect(listed.runs).toHaveLength(1);
    expect(listed.runs[0]).toMatchObject({ id: runId, generated: 2, situationsTotal: 4, status: 'active' });
    expect((await json(await call('GET', '/api/ai-runs', { as: PROF2 }))).runs).toHaveLength(0);

    const response = await call('POST', `/api/ai-runs/${runId}/draft`, { as: PROF, body: {} });
    expect(response.status).toBe(200);
    const body = await json(response);
    expect(body.run).toMatchObject({ generated: 2, total: 4 });
    expect(body.latestVersion).toBeNull();
    expect(body.warnings.some((item: string) => item.includes('solo se han generado 2'))).toBe(true);
    const draft = body.draft as Scenario;
    expect(validateScenario(draft)).toEqual(draft);
    expect(draft.phases).toHaveLength(2);
    expect(draft.origin).toEqual({ kind: 'ai', runId, collectionId });
    // El borrador no se guarda: el catálogo de la organización no cambia.
    expect((await json(await call('GET', '/api/scenarios', { as: PROF }))).scenarios.some((item: { id: string }) => item.id === draft.id)).toBe(false);

    // El docente edita y publica. La procedencia la fija el servidor aunque el cliente envíe otra.
    const edited = { ...draft, title: 'Protección de datos con IA', phases: draft.phases.map((phase, i) => ({ ...phase, title: `Caso ${i + 1}` })), origin: { kind: 'ai', runId: 'falso-1', collectionId: 'falso-2' } };
    const published = await call('POST', `/api/ai-runs/${runId}/publish`, { as: PROF, body: { scenario: edited } });
    expect(published.status).toBe(201);
    const scenario = (await json(published)).scenario as Scenario;
    expect(scenario).toMatchObject({ id: draft.id, version: 1, title: 'Protección de datos con IA', origin: { kind: 'ai', runId, collectionId } });
    const audit = db.prepare("SELECT action, detail_json AS detail FROM audit_log WHERE action = 'scenario_published_from_ai'").all() as { detail: string }[];
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].detail)).toMatchObject({ scenarioId: draft.id, version: 1, runId, collectionId, phases: 2 });
    expect(audit[0].detail).not.toContain('Protección');

    // Visible para la organización (otro docente y participante), con distintivo; invisible para otra organización.
    const own = (await json(await call('GET', '/api/scenarios', { as: PROF2 }))).scenarios.find((item: { id: string }) => item.id === draft.id);
    expect(own).toMatchObject({ catalog: false, origin: 'ai', publishedBy: 'Profesora Uno', version: 1, phases: 2 });
    expect((await call('GET', `/api/scenarios/${draft.id}`, { as: ALUMNA })).status).toBe(200);
    expect((await json(await call('GET', '/api/scenarios', { as: OTRO }))).scenarios.some((item: { id: string }) => item.id === draft.id)).toBe(false);
    expect((await call('GET', `/api/scenarios/${draft.id}`, { as: OTRO })).status).toBe(404);
    const catalogItem = (await json(await call('GET', '/api/scenarios', { as: PROF }))).scenarios.find((item: { id: string }) => item.id === 'ia-buenas-practicas');
    expect(catalogItem).toMatchObject({ catalog: true, origin: null, publishedBy: null });

    // Se puede crear una sesión con él («Nueva sesión»): el Durable Object recibe el escenario publicado.
    const session = await call('POST', '/api/sessions', { as: PROF, body: { scenarioId: draft.id, name: 'Grupo A' } });
    expect(session.status).toBe(201);
    expect(sessions.created.at(-1)).toMatchObject({ id: draft.id, version: 1, title: 'Protección de datos con IA' });
    // Otra organización no puede crear sesiones con él.
    expect((await call('POST', '/api/sessions', { as: OTRO, body: { scenarioId: draft.id } })).status).toBe(404);

    // Inmutable: volver a publicar la misma versión es 409; el borrador siguiente propone la versión 2.
    const again = await call('POST', `/api/ai-runs/${runId}/publish`, { as: PROF, body: { scenario: edited } });
    expect(again.status).toBe(409);
    expect(await json(again)).toMatchObject({ code: 'VERSION_CONFLICT', latestVersion: 1 });
    const next = await json(await call('POST', `/api/ai-runs/${runId}/draft`, { as: PROF, body: {} }));
    expect(next).toMatchObject({ latestVersion: 1, draft: { version: 2 } });
    expect((await call('POST', `/api/ai-runs/${runId}/publish`, { as: PROF, body: { scenario: { ...edited, version: 2 } } })).status).toBe(201);
    const stored = db.prepare('SELECT version, definition_json AS json FROM scenarios WHERE id = ? ORDER BY version').all(draft.id) as { version: number; json: string }[];
    expect(stored.map(row => row.version)).toEqual([1, 2]);
    expect(JSON.parse(stored[0].json).title).toBe('Protección de datos con IA');
  });

  it('valida lo publicado: id del borrador, mínimo dos situaciones, una mejor opción y longitudes', async () => {
    const context = setup();
    const { call } = context;
    const { runId } = await runWithTwoSituations(context);
    const draft = (await json(await call('POST', `/api/ai-runs/${runId}/draft`, { as: PROF, body: {} }))).draft as Scenario;
    const publish = (scenario: unknown) => call('POST', `/api/ai-runs/${runId}/publish`, { as: PROF, body: { scenario } });
    expect((await publish({ ...draft, id: 'ia-buenas-practicas' })).status).toBe(400);
    expect((await publish({ ...draft, id: 'mi-escenario' })).status).toBe(400);
    expect((await publish({ ...draft, phases: draft.phases.slice(0, 1) })).status).toBe(400);
    const noBest = structuredClone(draft);
    noBest.phases[0].options = noBest.phases[0].options.map(option => ({ ...option, quality: 'poor' as const }));
    expect((await json(await publish(noBest))).error).toMatch(/mejor/);
    const tooLong = structuredClone(draft);
    tooLong.phases[0].title = 'x'.repeat(81);
    expect((await json(await publish(tooLong))).error).toMatch(/phases\[0\]\.title/);
    expect((await call('POST', `/api/ai-runs/${runId}/publish`, { as: PROF, body: {} })).status).toBe(400);
    // POST /api/scenarios (genérico) descarta cualquier procedencia enviada por el cliente.
    const generic = await call('POST', '/api/scenarios', { as: PROF, body: { ...draft, id: 'escenario-propio', origin: { kind: 'ai', runId, collectionId: 'x-1' } } });
    expect(generic.status).toBe(201);
    expect((await json(generic)).scenario.origin).toBeUndefined();
  });

  it('flag, rol, propiedad, organización, CSRF y mínimo de situaciones', async () => {
    const context = setup();
    const { call } = context;
    const { runId } = await runWithTwoSituations(context);
    const draftPath = `/api/ai-runs/${runId}/draft`;
    expect((await call('POST', draftPath, { as: ALUMNA, body: {} })).status).toBe(403);
    expect((await call('POST', `/api/ai-runs/${runId}/publish`, { as: ALUMNA, body: { scenario: {} } })).status).toBe(403);
    expect((await call('GET', '/api/ai-runs', { as: ALUMNA })).status).toBe(403);
    expect((await call('POST', draftPath, { as: PROF2, body: {} })).status).toBe(404);
    expect((await call('POST', draftPath, { as: OTRO, body: {} })).status).toBe(404);
    expect((await call('POST', draftPath, { body: {} })).status).toBe(401);
    expect((await call('POST', draftPath, { as: PROF, body: {}, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await call('POST', `/api/ai-runs/${runId}/publish`, { as: PROF, body: { scenario: {} }, headers: { 'content-type': 'text/plain' } })).status).toBe(403);
    expect((await setup({ flag: false }).call('POST', draftPath, { as: PROF, body: {} })).status).toBe(404);

    // Con una sola situación generada no hay borrador.
    const short = setup();
    const created = await json(await short.call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'Corta' } }));
    await short.call('POST', `/api/knowledge/collections/${created.collection.id}/documents`, { as: PROF, body: { name: 'guia.md', text: GUIDE } });
    const run = await json(await short.call('POST', '/api/ai-runs', { as: PROF, body: { collectionId: created.collection.id, situations: 3 } }));
    await short.flush();
    const tooShort = await short.call('POST', `/api/ai-runs/${run.run.id}/draft`, { as: PROF, body: {} });
    expect(tooShort.status).toBe(409);
    expect((await json(tooShort)).code).toBe('DRAFT_TOO_SHORT');
  });
});
