import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
// Access simulado: el token «valid:<correo>» es un JWT válido para ese correo.
vi.mock('jose', () => ({
  createRemoteJWKSet: () => 'jwks',
  jwtVerify: async (token: string) => {
    if (!token.startsWith('valid:')) throw new Error('firma no válida');
    return { payload: { email: token.slice('valid:'.length) } };
  }
}));

const { createApp, cspFor } = await import('../worker/app');
const { chunkText, cleanMarkdown, search, loadIndex, KNOWLEDGE_LIMITS } = await import('../worker/knowledge');
const { quickIntent, interpretLiveClef, looksLikeQuestion } = await import('../worker/ai-live');
const { validateSituation, LIVE_MODEL } = await import('../worker/ai-live-prompts');
const { guestAllowed } = await import('../worker/guests');
const { CLEF_MODEL } = await import('../worker/voice-intent');

const logs: string[] = [];
beforeEach(() => {
  logs.length = 0;
  for (const method of ['log', 'warn', 'error'] as const) vi.spyOn(console, method).mockImplementation((...args: unknown[]) => { logs.push(args.map(String).join(' ')); });
});

// ---------------------------------------------------------------------------------------------
// D1 sobre SQLite en memoria con las migraciones reales, R2 en memoria y Workers AI determinista.
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
  const d1 = {
    prepare: (sql: string) => statement(sql),
    batch: async (items: ReturnType<typeof statement>[]) => {
      db.exec('BEGIN');
      try { const results = items.map(item => item.execute()); db.exec('COMMIT'); return results; } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
  };
  return { d1, db };
}

function fakeR2() {
  const store = new Map<string, Uint8Array>();
  const bucket = {
    put: async (key: string, value: ArrayBuffer | Uint8Array) => { store.set(key, value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value.slice(0))); return {}; },
    get: async (key: string) => {
      const value = store.get(key);
      return value ? { arrayBuffer: async () => value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) } : null;
    },
    delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key); },
    list: async ({ prefix }: { prefix: string }) => ({ objects: [...store.keys()].filter(key => key.startsWith(prefix)).map(key => ({ key })), truncated: false })
  };
  return { bucket, store };
}

const fold = (text: string) => text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
/** Embedding determinista: bolsa de palabras (≥ 4 letras) en 64 dimensiones. */
function fakeEmbedding(text: string): number[] {
  const vector = new Array(64).fill(0);
  for (const word of fold(text).match(/[a-zñ]{4,}/g) ?? []) {
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
    narration: `Imagina que preparas una actividad y debes decidir cómo usar la IA con los trabajos (${tag}). ¿Qué harías?`,
    options: [
      { label: `Anonimizo los datos antes de usar la herramienta (${tag})`, quality: 'best', consequence: 'Se protegen los datos.', rationale: 'La guía exige anonimizar.', reaction: 'Buena decisión: la guía pide anonimizar antes de usar la IA.', sources: ['F1'] },
      { label: `Uso la herramienta corporativa autorizada (${tag})`, quality: 'acceptable', consequence: 'Es seguro, pero mejorable.', rationale: 'Está autorizada.', reaction: 'Es una opción razonable, aunque anonimizar sería mejor.', sources: ['F1'] },
      { label: `Pego el texto con nombres en una IA externa (${tag})`, quality: 'poor', consequence: 'Se exponen datos personales.', rationale: 'Está prohibido.', reaction: 'Esa decisión tiene riesgos: no se deben introducir datos personales.', sources: ['F1'] },
      { label: `Dejo que la IA ponga la nota final (${tag})`, quality: 'poor', consequence: 'La nota no la revisa una persona.', rationale: 'La IA no puede calificar.', reaction: 'Esa decisión tiene riesgos: la calificación la decide una persona.', sources: ['F1'] }
    ]
  };
}

interface AiScript { llm: unknown[]; clef: unknown[]; markdown?: { format: string; data?: string } ; failWith?: string }

function fakeAi(script: AiScript) {
  const calls: { model: string; input: any }[] = [];
  let situations = 0;
  const ai = {
    run: async (model: string, input: any) => {
      calls.push({ model, input });
      if (script.failWith) throw new Error(script.failWith);
      if (model === '@cf/baai/bge-m3') return { shape: [input.text.length, 64], data: input.text.map((text: string) => fakeEmbedding(text)) };
      if (model === CLEF_MODEL) return script.clef.shift() ?? { answers: { intencion: { choice: 'ninguna', probabilities: { ninguna: 0.9 }, confidence: 0.9 } } };
      const user = String(input.messages?.[1]?.content ?? '');
      const scripted = script.llm.shift();
      if (scripted !== undefined) return { choices: [{ message: { content: typeof scripted === 'string' ? scripted : JSON.stringify(scripted) } }] };
      if (user.includes('Crea la situación')) return { choices: [{ message: { content: JSON.stringify(situationJson(String(++situations))) } }] };
      if (user.includes('pregunta sobre el contenido')) return { response: { answerable: true, spoken: 'Hay que comunicarlo en 24 horas al Delegado de Protección de Datos.', sources: ['R1'] } };
      if (user.includes('La simulación ha terminado')) return { response: JSON.stringify({ spoken: 'Hemos terminado. Repasa las ideas clave.', takeaways: ['Anonimiza.', 'Una persona califica.', 'Comunica incidentes.'] }) };
      throw new Error('llamada inesperada');
    },
    toMarkdown: async (documents: { name: string }[]) => documents.map(doc => ({ name: doc.name, ...(script.markdown ?? { format: 'markdown', data: `# ${doc.name}\n## Metadata\n- Author=Persona Real\n\n## Contents\n### Page 1\nLa evaluación la decide siempre una persona y la IA no puede calificar trabajos.\n\n### Page 2\nLos incidentes de datos se comunican en 24 horas.` }) }))
  };
  return { ai, calls };
}

const NOW = '2026-01-01T00:00:00.000Z';
const PROF = 'prof@ufv.es';
const PROF2 = 'prof2@ufv.es';
const ALUMNA = 'alumna@ufv.es';
const OTRO = 'otro@other.org';

const GUIDE = `# Guía de IA en la docencia

## Datos personales
No se deben introducir datos personales de estudiantes (nombres, calificaciones, correos) en herramientas de IA externas. Antes de usar un texto con la IA, el profesorado debe anonimizarlo. Solo la herramienta corporativa autorizada puede tratar datos personales.

## Evaluación
La IA no puede calificar de forma automática trabajos de los estudiantes. La calificación final siempre la decide y revisa una persona. Si un estudiante reclama una nota, el docente debe poder explicar los criterios.

## Incidentes
Si se introducen datos personales en una herramienta no autorizada, se comunica en un plazo de 24 horas al Delegado de Protección de Datos por el canal interno de incidencias.`;

function setup(options: { flag?: boolean; script?: Partial<AiScript>; vars?: Record<string, string> } = {}) {
  const { d1, db } = createD1();
  db.exec(`INSERT INTO tenants (id,name,created_at) VALUES ('ufv','UFV','${NOW}'), ('other','Otra','${NOW}')`);
  for (const [id, email, tenant, role] of [['u-prof', PROF, 'ufv', 'instructor'], ['u-prof2', PROF2, 'ufv', 'instructor'], ['u-alumna', ALUMNA, 'ufv', 'participant'], ['u-otro', OTRO, 'other', 'instructor']]) {
    db.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').run(id, email, id, NOW);
    db.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').run(tenant, id, role);
  }
  const r2 = fakeR2();
  const script: AiScript = { llm: [], clef: [], ...options.script };
  const { ai, calls } = fakeAi(script);
  const env = {
    DB: d1, FILES: r2.bucket, AI: ai,
    ACCESS_TEAM_DOMAIN: 'equipo.cloudflareaccess.com', ACCESS_AUD: 'aud', LEGACY_ACCESS_AUTH: 'true',
    FEATURE_FLAGS: JSON.stringify({ ai_live_demo: options.flag ?? true }),
    ...options.vars
  };
  const pending: Promise<unknown>[] = [];
  const executionCtx = { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); }, passThroughOnException: () => {}, props: {} };
  const app = createApp(false);
  const call = async (method: string, path: string, init: { as?: string; body?: unknown; headers?: Record<string, string> } = {}) => {
    const headers: Record<string, string> = { 'sec-fetch-site': 'same-origin' };
    if (init.as) headers['cf-access-jwt-assertion'] = `valid:${init.as}`;
    if (init.body !== undefined) headers['content-type'] = 'application/json';
    Object.assign(headers, init.headers);
    const response = await app.request(`https://axyro.test${path}`, { method, headers, body: init.body !== undefined ? JSON.stringify(init.body) : undefined }, env as never, executionCtx as never);
    return response;
  };
  const flush = async () => { while (pending.length) await Promise.all(pending.splice(0)); };
  return { db, env, call, flush, calls, script, r2 };
}

async function json<T = any>(response: Response): Promise<T> { return await response.json() as T; }

async function collectionWithGuide(context: ReturnType<typeof setup>) {
  const created = await json(await context.call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'Guía IA' } }));
  const id = created.collection.id as string;
  const upload = await context.call('POST', `/api/knowledge/collections/${id}/documents`, { as: PROF, body: { name: 'guia.md', text: GUIDE } });
  expect(upload.status).toBe(201);
  return id;
}

describe('modo IA en vivo: acceso', () => {
  it('con el flag desactivado las rutas no existen (404) y la consola no abre el micrófono', async () => {
    const { call } = setup({ flag: false });
    expect((await call('GET', '/api/knowledge/collections', { as: PROF })).status).toBe(404);
    expect((await call('POST', '/api/ai-runs', { as: PROF, body: { collectionId: 'abcdefgh-1' } })).status).toBe(404);
    expect((await call('POST', '/api/voice/tts-key', { as: PROF, body: {} })).status).toBe(404);
    expect(cspFor('console', 'https://axyro.test/')).not.toContain('soniox');
  });

  it('solo instructores: participante 403, invitado fuera por lista cerrada, sin identidad 401', async () => {
    const { call } = setup();
    expect((await call('GET', '/api/knowledge/collections', { as: ALUMNA })).status).toBe(403);
    expect((await call('POST', '/api/ai-runs', { as: ALUMNA, body: { collectionId: 'abcdefgh-1' } })).status).toBe(403);
    expect((await call('POST', '/api/voice/tts-key', { as: ALUMNA, body: {} })).status).toBe(403);
    expect((await call('GET', '/api/knowledge/collections')).status).toBe(401);
    for (const path of ['/api/knowledge/collections', '/api/ai-runs', '/api/ai-runs/x/answer', '/api/voice/tts-key'])
      expect(guestAllowed('POST', path, 'session-1')).toBe(false);
  });

  it('aplica CSRF: otro origen o cuerpo no JSON se rechazan', async () => {
    const { call } = setup();
    expect((await call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'X' }, headers: { 'sec-fetch-site': 'cross-site' } })).status).toBe(403);
    expect((await call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'X' }, headers: { 'content-type': 'text/plain' } })).status).toBe(403);
  });

  it('con el flag activado, la consola admite el micrófono y los WebSocket de Soniox', async () => {
    const { call } = setup({ vars: { } });
    const page = await call('GET', '/api/me', { as: PROF });
    expect((await json(page)).flags.ai_live_demo).toBe(true);
    const csp = cspFor('console', 'https://axyro.test/', true);
    expect(csp).toContain("connect-src 'self' wss://axyro.test wss://stt-rt.eu.soniox.com");
    expect(csp).toContain('wss://tts-rt.soniox.com;');
    expect(csp).toContain("media-src 'self' blob:");
  });
});

describe('colecciones y documentos', () => {
  it('CRUD con aislamiento entre organizaciones', async () => {
    const context = setup();
    const { call } = context;
    expect((await call('POST', '/api/knowledge/collections', { as: PROF, body: { name: '  ' } })).status).toBe(400);
    const created = await call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'Normativa' } });
    expect(created.status).toBe(201);
    const { collection } = await json(created);
    expect(collection).toMatchObject({ name: 'Normativa', documentCount: 0, chunkCount: 0 });
    expect((await json(await call('GET', '/api/knowledge/collections', { as: PROF2 }))).collections).toHaveLength(1);
    expect((await json(await call('GET', '/api/knowledge/collections', { as: OTRO }))).collections).toEqual([]);
    expect((await call('GET', `/api/knowledge/collections/${collection.id}/documents`, { as: OTRO })).status).toBe(404);
    expect((await call('POST', `/api/knowledge/collections/${collection.id}/documents`, { as: OTRO, body: { name: 'x.txt', text: GUIDE } })).status).toBe(404);
    expect((await call('DELETE', `/api/knowledge/collections/${collection.id}`, { as: OTRO })).status).toBe(404);
    const doc = await json(await call('POST', `/api/knowledge/collections/${collection.id}/documents`, { as: PROF, body: { name: 'guia.md', text: GUIDE } }));
    expect((await call('DELETE', `/api/knowledge/documents/${doc.document.id}`, { as: OTRO })).status).toBe(404);
    expect((await call('DELETE', `/api/knowledge/collections/${collection.id}`, { as: PROF })).status).toBe(200);
    expect(context.r2.store.size).toBe(0);
    expect(context.db.prepare('SELECT COUNT(*) AS n FROM knowledge_chunks').get()).toEqual({ n: 0 });
    expect(context.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE action LIKE 'knowledge_%'").get()).toEqual({ n: 3 });
  });

  it('sube texto pegado y base64: fragmenta, guarda vectores en R2 y fragmentos en D1', async () => {
    const context = setup();
    const id = (await json(await context.call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'Guía' } }))).collection.id;
    const pasted = await context.call('POST', `/api/knowledge/collections/${id}/documents`, { as: PROF, body: { name: 'Pegado', text: GUIDE } });
    expect(pasted.status).toBe(201);
    const { document } = await json(pasted);
    expect(document).toMatchObject({ name: 'Pegado', mime: 'text/plain', status: 'ready', error: null });
    expect(document.chars).toBeGreaterThan(500);
    const chunks = context.db.prepare('SELECT ord, hint, text FROM knowledge_chunks WHERE document_id = ? ORDER BY ord').all(document.id) as { ord: number; hint: string; text: string }[];
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].hint).toBeTruthy();
    const vectors = context.r2.store.get(`knowledge/ufv/${id}/${document.id}.vec`)!;
    expect(vectors.byteLength).toBe(chunks.length * 64 * 4);
    expect(context.r2.store.has(`knowledge/ufv/${id}/${document.id}`)).toBe(true);

    const md = await context.call('POST', `/api/knowledge/collections/${id}/documents`, { as: PROF, body: { name: 'notas.md', mime: 'text/markdown', dataBase64: Buffer.from('# Notas\n\nLa evaluación final la revisa una persona, nunca la IA de forma automática.').toString('base64') } });
    expect(md.status).toBe(201);
    const listed = await json(await context.call('GET', `/api/knowledge/collections/${id}/documents`, { as: PROF }));
    expect(listed.documents.map((item: { name: string }) => item.name)).toEqual(['Pegado', 'notas.md']);
    const collections = await json(await context.call('GET', '/api/knowledge/collections', { as: PROF }));
    expect(collections.collections[0]).toMatchObject({ documentCount: 2, chunkCount: chunks.length + 1 });
    // El texto de los documentos no aparece en los logs.
    expect(logs.join('\n')).not.toContain('anonimizarlo');
  });

  it('PDF y DOCX con toMarkdown; PDF escaneado, formato o tamaño no válidos con mensajes claros', async () => {
    const context = setup();
    const id = (await json(await context.call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'PDF' } }))).collection.id;
    const pdf = Buffer.from('%PDF-1.4 contenido').toString('base64');
    const ok = await context.call('POST', `/api/knowledge/collections/${id}/documents`, { as: PROF, body: { name: 'norma.pdf', mime: 'application/pdf', dataBase64: pdf } });
    expect(ok.status).toBe(201);
    const { document } = await json(ok);
    const chunk = context.db.prepare('SELECT hint, text FROM knowledge_chunks WHERE document_id = ? ORDER BY ord').get(document.id) as { hint: string; text: string };
    expect(chunk.hint).toBe('p. 1');
    expect(chunk.text).not.toMatch(/Metadata|Persona Real|norma\.pdf/);

    context.script.markdown = { format: 'markdown', data: '# escaneado.pdf\n## Metadata\n- PDFFormatVersion=1.4\n## Contents\n### Page 1\n\n### Page 2\n' };
    const scanned = await context.call('POST', `/api/knowledge/collections/${id}/documents`, { as: PROF, body: { name: 'escaneado.pdf', mime: 'application/pdf', dataBase64: pdf } });
    expect(scanned.status).toBe(422);
    const body = await json(scanned);
    expect(body).toMatchObject({ code: 'DOCUMENT_UNREADABLE', document: { status: 'error' } });
    expect(body.error).toContain('escaneado');
    expect(context.r2.store.has(`knowledge/ufv/${id}/${body.document.id}`)).toBe(false);

    expect((await context.call('POST', `/api/knowledge/collections/${id}/documents`, { as: PROF, body: { name: 'falso.pdf', mime: 'application/pdf', dataBase64: Buffer.from('hola').toString('base64') } })).status).toBe(400);
    expect((await context.call('POST', `/api/knowledge/collections/${id}/documents`, { as: PROF, body: { name: 'foto.png', mime: 'image/png', dataBase64: 'aGVsbG8=' } })).status).toBe(415);
    expect((await context.call('POST', `/api/knowledge/collections/${id}/documents`, { as: PROF, body: { name: 'enorme.txt', mime: 'text/plain', dataBase64: 'A'.repeat(Math.ceil(KNOWLEDGE_LIMITS.maxFileBytes / 0.75) + 8) } })).status).toBe(413);
  });

  it('recupera primero los fragmentos más parecidos a la consulta', async () => {
    const context = setup();
    const id = await collectionWithGuide(context);
    const env = context.env as never;
    const index = await loadIndex(env, 'ufv', id);
    expect(index.total).toBeGreaterThan(0);
    const results = await search(env, 'ufv', id, 'plazo de horas para comunicar incidentes al Delegado', 2);
    expect(results[0].text).toContain('24 horas');
    expect(results[0].score).toBeGreaterThanOrEqual(results[1]?.score ?? 0);
    // Otra organización no ve nada de esta colección.
    expect(await search(env, 'other', id, 'incidentes', 2)).toEqual([]);
  });
});

describe('partida de IA en vivo', () => {
  it('ciclo completo: situación, decisión, pregunta, confirmación, repetir, no entendido y resumen', async () => {
    const context = setup();
    const { call, flush } = context;
    const collectionId = await collectionWithGuide(context);
    expect((await call('POST', '/api/ai-runs', { as: PROF, body: { collectionId, situations: 9 } })).status).toBe(400);
    const created = await call('POST', '/api/ai-runs', { as: PROF, body: { collectionId, situations: 3, focus: 'evaluación' } });
    expect(created.status).toBe(201);
    const { run } = await json(created);
    expect(run).toMatchObject({ collectionId, situationsTotal: 3, index: 0, status: 'active' });
    await flush();
    // La primera situación ya está generada en segundo plano: /next no vuelve a llamar al modelo.
    const llmCalls = () => context.calls.filter(item => item.model === LIVE_MODEL).length;
    expect(llmCalls()).toBe(1);
    // Otra persona (aun de la misma organización) no ve la partida.
    expect((await call('GET', `/api/ai-runs/${run.id}`, { as: PROF2 })).status).toBe(404);
    expect((await call('GET', `/api/ai-runs/${run.id}`, { as: OTRO })).status).toBe(404);

    const first = await json(await call('POST', `/api/ai-runs/${run.id}/next`, { as: PROF, body: {} }));
    expect(first.situation.options).toHaveLength(4);
    expect(first.situation.index).toBe(0);
    expect(first.situation.sources[0]).toMatchObject({ id: 'F1', document: 'guia.md' });
    expect(first.situation.sources[0].excerpt.length).toBeLessThanOrEqual(240);
    expect(first.situation.options[0]).not.toHaveProperty('reaction');
    // /next antes de responder devuelve la misma situación.
    expect((await json(await call('POST', `/api/ai-runs/${run.id}/next`, { as: PROF, body: {} }))).situation.id).toBe(first.situation.id);
    await flush();
    expect(llmCalls()).toBe(2);

    const state = await json(await call('GET', `/api/ai-runs/${run.id}`, { as: PROF }));
    expect(state.current.id).toBe(first.situation.id);
    expect(state.history).toEqual([]);

    // Repetir y no entendido (sin IA para «repite»; Clef para el resto).
    expect(await json(await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { phrase: '¡Repite, por favor!' } }))).toEqual({ kind: 'repeat' });
    const unclear = await json(await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { phrase: 'Hmm, bueno, a ver' } }));
    expect(unclear.kind).toBe('unclear');

    // Pregunta sobre el contenido: Clef «pregunta» → respuesta con los documentos.
    context.script.clef.push({ answers: { intencion: { choice: 'pregunta', probabilities: { pregunta: 0.93 }, confidence: 0.9 } } });
    const secretPhrase = 'Y si meto datos sin querer cuánto tiempo tengo para avisar';
    const asked = await json(await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { phrase: secretPhrase } }));
    expect(asked.kind).toBe('answer');
    expect(asked.spoken).toContain('24 horas');
    expect(asked.sources[0]).toMatchObject({ id: 'R1', document: 'guia.md' });
    const clefInput = context.calls.filter(item => item.model === CLEF_MODEL).at(-1)!.input;
    expect(Object.keys(clefInput.questions.intencion.criteria)).toEqual(['opcion_1', 'opcion_2', 'opcion_3', 'opcion_4', 'pregunta', 'repetir', 'siguiente', 'ninguna']);
    expect(JSON.stringify(clefInput)).not.toMatch(/quality|rationale|prof@/);

    // Confirmación: Clef duda → «¿Te refieres a…?»; «sí» decide sin volver a llamar a Clef.
    context.script.clef.push({ answers: { intencion: { choice: 'opcion_3', probabilities: { opcion_3: 0.6 }, confidence: 0.7 } } });
    const confirm = await json(await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { phrase: 'Creo que pegaría el texto tal cual' } }));
    expect(confirm).toMatchObject({ kind: 'confirm', optionIndex: 2 });
    expect(confirm.prompt).toBe(`¿Te refieres a «${first.situation.options[2].label}»?`);
    const decided = await json(await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { phrase: 'Sí' } }));
    expect(decided).toMatchObject({ kind: 'decision', optionIndex: 2, reaction: { quality: first.situation.options[2].quality } });
    expect(decided.reaction.spoken.length).toBeGreaterThan(10);
    const again = await json(await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { optionIndex: 1 } }));
    expect(again.kind).toBe('unclear');

    // Segunda situación (ya generada por adelantado): decide con atajo «la dos».
    const second = await json(await call('POST', `/api/ai-runs/${run.id}/next`, { as: PROF, body: {} }));
    expect(second.situation.index).toBe(1);
    expect(second.situation.title).not.toBe(first.situation.title);
    const byNumber = await json(await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { phrase: 'Me quedo con la dos' } }));
    expect(byNumber).toMatchObject({ kind: 'decision', optionIndex: 1 });
    await flush();

    // Tercera: elige la mejor por índice; tras la última, /next devuelve el resumen.
    const third = await json(await call('POST', `/api/ai-runs/${run.id}/next`, { as: PROF, body: {} }));
    const best = third.situation.options.findIndex((option: { quality: string }) => option.quality === 'best');
    expect((await json(await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { optionIndex: best } }))).reaction.quality).toBe('best');
    await flush();
    const done = await json(await call('POST', `/api/ai-runs/${run.id}/next`, { as: PROF, body: {} }));
    expect(done.done).toBe(true);
    expect(done.summary.takeaways).toHaveLength(3);
    expect(done.summary.total).toBe(3);
    const expectedOptimal = [first.situation.options[2], second.situation.options[1], third.situation.options[best]].filter(option => option.quality === 'best').length;
    expect(done.summary.optimalCount).toBe(expectedOptimal);
    const final = await json(await call('GET', `/api/ai-runs/${run.id}`, { as: PROF }));
    expect(final.run.status).toBe('complete');
    expect(final.current).toBeNull();
    expect(final.history.map((item: { chosen: number }) => item.chosen)).toEqual([2, 1, best]);
    expect((await call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { optionIndex: 0 } })).status).toBe(409);
    // Ni la frase ni el texto de los documentos llegan a los logs.
    expect(logs.join('\n')).not.toContain(secretPhrase);
    expect(logs.join('\n')).not.toContain('anonimizarlo');
  });

  it('«siguiente» sin responder salta la situación (sin elección)', async () => {
    const context = setup();
    const collectionId = await collectionWithGuide(context);
    const { run } = await json(await context.call('POST', '/api/ai-runs', { as: PROF, body: { collectionId, situations: 3 } }));
    await context.flush();
    await context.call('POST', `/api/ai-runs/${run.id}/next`, { as: PROF, body: {} });
    expect(await json(await context.call('POST', `/api/ai-runs/${run.id}/answer`, { as: PROF, body: { phrase: 'Siguiente' } }))).toEqual({ kind: 'next' });
    const next = await json(await context.call('POST', `/api/ai-runs/${run.id}/next`, { as: PROF, body: {} }));
    expect(next.situation.index).toBe(1);
    const state = await json(await context.call('GET', `/api/ai-runs/${run.id}`, { as: PROF }));
    expect(state.history[0]).toMatchObject({ chosen: null, reaction: null });
  });

  it('una salida no válida se reintenta una vez; dos seguidas dan 502 AI_INVALID y la situación se puede volver a pedir', async () => {
    const context = setup({ script: { llm: ['esto no es JSON', { title: 'x' }] } });
    const collectionId = await collectionWithGuide(context);
    const { run } = await json(await context.call('POST', '/api/ai-runs', { as: PROF, body: { collectionId } }));
    await context.flush();
    const failed = await context.call('POST', `/api/ai-runs/${run.id}/next`, { as: PROF, body: {} });
    // La generación en segundo plano agotó los dos intentos; /next reclama la situación y la genera de nuevo.
    expect(failed.status).toBe(200);
    const invalidCalls = context.calls.filter(item => item.model === LIVE_MODEL).length;
    expect(invalidCalls).toBeGreaterThanOrEqual(3);
    expect(logs.join('\n')).toContain('AI_OUTPUT_INVALID');

    const strict = setup({ script: { llm: ['{}', '{}', '{}', '{}'] } });
    const strictCollection = await collectionWithGuide(strict);
    const created = await json(await strict.call('POST', '/api/ai-runs', { as: PROF, body: { collectionId: strictCollection } }));
    await strict.flush();
    const response = await strict.call('POST', `/api/ai-runs/${created.run.id}/next`, { as: PROF, body: {} });
    expect(response.status).toBe(502);
    expect(await json(response)).toMatchObject({ code: 'AI_INVALID' });
  });

  it('cuota de Workers AI agotada: 429 con código AI_QUOTA', async () => {
    const context = setup();
    const collectionId = await collectionWithGuide(context);
    context.script.failWith = 'AiError: 4006: you have used up your daily free allocation of 10,000 neurons';
    const response = await context.call('POST', '/api/ai-runs', { as: PROF, body: { collectionId, focus: 'notas' } });
    expect(response.status).toBe(429);
    expect(await json(response)).toEqual({ error: 'Se ha alcanzado el límite diario de IA. Inténtalo más tarde.', code: 'AI_QUOTA' });
    const upload = await context.call('POST', `/api/knowledge/collections/${collectionId}/documents`, { as: PROF, body: { name: 'otro.txt', text: GUIDE } });
    expect(upload.status).toBe(429);
  });

  it('colección vacía o de otra organización', async () => {
    const context = setup();
    const empty = (await json(await context.call('POST', '/api/knowledge/collections', { as: PROF, body: { name: 'Vacía' } }))).collection.id;
    expect((await context.call('POST', '/api/ai-runs', { as: PROF, body: { collectionId: empty } })).status).toBe(409);
    expect((await context.call('POST', '/api/ai-runs', { as: OTRO, body: { collectionId: empty } })).status).toBe(404);
  });
});

describe('voz del modo IA en vivo (Soniox)', () => {
  it('clave TTS para instructores y clave STT ligada a su propia partida', async () => {
    const context = setup({ vars: { SONIOX_API_KEY: 'server-only-key', SONIOX_REGION: 'us' } });
    const collectionId = await collectionWithGuide(context);
    const { run } = await json(await context.call('POST', '/api/ai-runs', { as: PROF, body: { collectionId } }));
    await context.flush();
    const originalFetch = globalThis.fetch;
    const bodies: any[] = [];
    globalThis.fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.soniox.com/v1/auth/temporary-api-key');
      bodies.push(JSON.parse(String(init?.body)));
      return Response.json({ api_key: 'snx_temp_k', expires_at: NOW }, { status: 201 });
    }) as typeof fetch;
    try {
      const tts = await context.call('POST', '/api/voice/tts-key', { as: PROF, body: {} });
      expect(tts.status).toBe(200);
      expect(await json(tts)).toEqual({ apiKey: 'snx_temp_k', websocketUrl: 'wss://tts-rt.soniox.com/tts-websocket', model: 'tts-rt-v2', voice: 'Carmen', language: 'es', expiresAt: NOW });
      expect(bodies[0]).toMatchObject({ usage_type: 'tts_rt', single_use: true });
      expect((await context.call('POST', '/api/voice/temporary-key', { as: PROF, body: {} })).status).toBe(403);
      expect((await context.call('POST', '/api/voice/temporary-key', { as: PROF2, body: { aiRunId: run.id } })).status).toBe(404);
      expect((await context.call('POST', '/api/voice/temporary-key', { as: OTRO, body: { aiRunId: run.id } })).status).toBe(404);
      const stt = await context.call('POST', '/api/voice/temporary-key', { as: PROF, body: { aiRunId: run.id } });
      expect(stt.status).toBe(200);
      expect(bodies.at(-1)).toMatchObject({ usage_type: 'transcribe_websocket' });
    } finally { globalThis.fetch = originalFetch; }
  });
});

describe('piezas puras', () => {
  it('atajos de voz sin IA', () => {
    expect(quickIntent('La tres')).toEqual({ kind: 'option', option: 2 });
    expect(quickIntent('Opción número 4.')).toEqual({ kind: 'option', option: 3 });
    expect(quickIntent('elijo la primera')).toEqual({ kind: 'option', option: 0 });
    expect(quickIntent('¿Puedes repetirlo?')).toEqual({ kind: 'repeat' });
    expect(quickIntent('Siguiente, por favor')).toEqual({ kind: 'next' });
    expect(quickIntent('Sí, esa')).toEqual({ kind: 'yes' });
    expect(quickIntent('Anonimizaría los datos')).toBeNull();
    expect(looksLikeQuestion('Cuánto tiempo tengo')).toBe(true);
    expect(interpretLiveClef({ answers: { intencion: { choice: 'opcion_2', probabilities: { opcion_2: 0.95 }, confidence: 0.92 } } }, 4)).toEqual({ kind: 'option', option: 1, decide: true });
    expect(interpretLiveClef({ answers: { intencion: { choice: 'pregunta', probabilities: { pregunta: 0.8 }, confidence: 0.5 } } }, 4)).toEqual({ kind: 'unclear' });
  });

  it('fragmentación con solapamiento y pistas de cita; limpieza de toMarkdown', () => {
    const text = cleanMarkdown('# doc.pdf\n## Metadata\n- Title=x\n## Contents\n### Page 3\n' + 'Frase de prueba con contenido. '.repeat(80));
    const chunks = chunkText(text, 400, 80);
    expect(chunks.length).toBeGreaterThan(3);
    expect(chunks.every(chunk => chunk.text.length <= 400 + 80)).toBe(true);
    expect(chunks[0].hint).toBe('p. 3');
    // Solapamiento: el fragmento siguiente empieza con el final del anterior.
    const overlap = chunks[1].text.split('\n')[0];
    expect(overlap.length).toBeGreaterThan(20);
    expect(chunks[0].text.endsWith(overlap)).toBe(true);
    expect(text).not.toContain('Metadata');
  });

  it('valida situaciones: 4 opciones, una «best», fuentes existentes', () => {
    const good = situationJson('a');
    expect(typeof validateSituation(good, ['F1', 'F2'])).toBe('object');
    expect(validateSituation({ ...good, options: good.options.slice(0, 3) }, ['F1', 'F2'])).toContain('exactamente 4');
    expect(validateSituation({ ...good, options: good.options.map(option => ({ ...option, quality: 'best' })) }, ['F1', 'F2'])).toContain('best');
    expect(validateSituation(good, ['F9'])).toContain('fragmentos');
  });
});
