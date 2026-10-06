/**
 * Modo demo en navegador: emula la API del simulador con el mismo motor (shared/engine) y guarda el estado
 * en el navegador. Solo se incluye al compilar con VITE_STANDALONE=1; el build normal no lo contiene.
 * Emula también «Simular clase» (participantes simulados que deciden solos) y `liveTally` del docente.
 */
import { applyCommand, createSession, DomainError, expireTimer, type Actor, type Command } from '../shared/engine';
import { catalogScenarios, classMeters, defaultScenario, participantReport, participantView, performanceReport, type SessionState } from '../shared/simulation';
import { ScenarioError, validateScenario } from '../shared/scenario';

type Member = { id: string; email: string; name: string; role: 'instructor' | 'participant' };
type Code = { id: string; userId: string; code: string; createdAt: string; uses: number; lastUsedAt: string | null };
type Store = { sessions: SessionState[]; members: Member[]; simulated: Record<string, string[]>; names: Record<string, string>; codes: Code[] };

const KEY = 'ufv-simulador-v4';
const actors: Record<'instructor' | 'participant', Actor & { email: string; tenantId: string }> = {
  instructor: { id: 'demo-instructor', name: 'Docente demo', role: 'instructor', email: 'instructor@demo.local', tenantId: 'demo' },
  participant: { id: 'demo-participant', name: 'Participante demo', role: 'participant', email: 'participante@demo.local', tenantId: 'demo' }
};

/** Hash estable (FNV-1a) para que cada participante simulado decida siempre igual en la misma fase. */
function hash(text: string): number {
  let value = 2166136261;
  for (let i = 0; i < text.length; i++) { value ^= text.charCodeAt(i); value = Math.imul(value, 16777619); }
  return (value >>> 0) / 4294967296;
}

const simActor = (sessionId: string, n: number): Actor => ({ id: `sim-${sessionId.slice(0, 8)}-${String(n).padStart(2, '0')}`, name: `Participante simulado ${String(n).padStart(2, '0')}`, role: 'participant' });

/** Opción que elige un simulado: mayoría hacia la mejor, algunos aceptables y pocos críticos. */
function simulatedChoice(state: SessionState, userId: string): string {
  const phase = state.scenario.phases[state.phaseIndex];
  const roll = hash(`${userId}:${phase.id}:opcion`);
  const pick = (quality: string) => phase.options.filter(option => option.quality === quality);
  const pool = roll < 0.55 ? pick('best') : roll < 0.85 ? pick('acceptable') : pick('poor');
  const list = pool.length ? pool : phase.options;
  return list[Math.floor(hash(`${userId}:${phase.id}:indice`) * list.length)].id;
}

/** Los simulados que aún no han decidido lo hacen tras un retraso propio (4–30 s desde que pudieron decidir). */
function stepSimulated(state: SessionState, ids: string[], now: number): SessionState {
  if (!ids.length || state.status !== 'active') return state;
  const phase = state.scenario.phases[state.phaseIndex];
  const pending = ids
    .map(userId => {
      const person = state.participants.find(item => item.userId === userId);
      if (!person || state.decisions.some(decision => decision.userId === userId && decision.phaseId === phase.id)) return null;
      const from = Math.max(Date.parse(state.phaseStartedAt), Date.parse(person.joinedAt));
      return { userId, name: person.name, at: from + 4000 + hash(`${userId}:${phase.id}:espera`) * 26000 };
    })
    .filter((item): item is { userId: string; name: string; at: number } => !!item && item.at <= now)
    .sort((a, b) => a.at - b.at);
  let next = state;
  for (const item of pending) {
    if (next.phaseDeadline && item.at > Date.parse(next.phaseDeadline)) continue;
    try { next = applyCommand(next, { id: `sim-${item.userId}-${phase.id}`, type: 'decide', optionId: simulatedChoice(next, item.userId) }, { id: item.userId, name: item.name, role: 'participant' }, new Date(item.at).toISOString()).state; }
    catch { /* fase cerrada o en pausa: se ignora */ }
  }
  return next;
}

function addSimulated(state: SessionState, count: number, at: string, existing: string[]): { state: SessionState; ids: string[] } {
  let next = state;
  const ids = [...existing];
  for (let n = existing.length + 1; ids.length < existing.length + count; n++) {
    const actor = simActor(state.id, n);
    next = applyCommand(next, { id: `sim-join-${actor.id}`, type: 'join' }, actor, at).state;
    ids.push(actor.id);
  }
  return { state: next, ids };
}

function removeSimulated(state: SessionState, ids: string[]): SessionState {
  const drop = new Set(ids);
  const next: SessionState = structuredClone(state);
  next.participants = next.participants.filter(person => !drop.has(person.userId));
  next.decisions = next.decisions.filter(decision => !drop.has(decision.userId));
  for (const id of ids) delete next.participantMeters[id];
  next.events = next.events.filter(event => !drop.has(event.actorId)).map((event, index) => ({ ...event, seq: index + 1 }));
  next.meters = classMeters(next);
  return next;
}

/** Organización vacía (como un despliegue nuevo). Con ?ejemplo=1 en la URL se carga una sesión de ejemplo terminada. */
function seed(): Store {
  const members = [actors.instructor, actors.participant].map(({ id, email, name, role }) => ({ id, email, name, role }));
  const wantsExample = (() => { try { return new URLSearchParams(window.location.search).get('ejemplo') === '1'; } catch { return false; } })();
  if (!wantsExample) return { sessions: [], members: [members[0]], simulated: {}, names: {}, codes: [] };
  // Una sesión de ejemplo ya terminada, con una clase simulada, para que el debate y el informe tengan contenido.
  const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  let state = createSession(crypto.randomUUID(), 'demo', actors.instructor, t(30), defaultScenario);
  const run = (command: Command, actor: Actor, at: string) => { state = applyCommand(state, command, actor, at).state; };
  run({ id: 'seed-join', type: 'join' }, actors.participant, t(29));
  const sim = addSimulated(state, 18, t(29), []);
  state = sim.state;
  const decideAll = (minutesAgo: number) => { state = stepSimulated(state, sim.ids, Date.parse(t(minutesAgo))); };
  run({ id: 'seed-d1', type: 'decide', optionId: 'anonimizar' }, actors.participant, t(27));
  decideAll(26);
  run({ id: 'seed-a1', type: 'advance' }, actors.instructor, t(25));
  run({ id: 'seed-d2', type: 'decide', optionId: 'borrador' }, actors.participant, t(22));
  decideAll(21.5);
  run({ id: 'seed-i1', type: 'incident', note: 'Un alumno pregunta si puede usar IA en el trabajo final', riskDelta: 5 }, actors.instructor, t(21));
  run({ id: 'seed-a2', type: 'advance' }, actors.instructor, t(20));
  run({ id: 'seed-d3', type: 'decide', optionId: 'dialogar' }, actors.participant, t(18));
  decideAll(17.5);
  run({ id: 'seed-end', type: 'complete' }, actors.instructor, t(17));
  return { sessions: [state], members, simulated: { [state.id]: sim.ids }, names: { [state.id]: 'Ejemplo · 1.º Derecho A' }, codes: [] };
}

/** Fila del listado con los mismos campos que GET /api/sessions del Worker. */
function row(store: Store, state: SessionState, role: 'instructor' | 'participant') {
  const completed = state.events.find(event => event.type === 'completed');
  const base = {
    id: state.id, name: store.names[state.id] ?? null, scenarioId: state.scenario.id, scenarioTitle: state.scenario.title, scenarioVersion: state.scenario.version,
    status: state.status, createdAt: state.createdAt, completedAt: completed?.at ?? null, instructorId: state.instructorId, instructorName: actors.instructor.name,
    mine: role === 'instructor' && state.instructorId === actors.instructor.id, phaseIndex: state.phaseIndex, phaseCount: state.scenario.phases.length
  };
  return role === 'instructor' ? { ...base, participantCount: state.participants.length, simulatedCount: (store.simulated[state.id] ?? []).length } : base;
}
const ORDER: Record<string, number> = { active: 0, paused: 0, complete: 1 };

let memory: Store | null = null;
function load(): Store {
  if (memory) return memory;
  try { const raw = localStorage.getItem(KEY); if (raw) memory = JSON.parse(raw) as Store; } catch { /* almacenamiento no disponible */ }
  memory ??= seed();
  memory.simulated ??= {};
  memory.names ??= {};
  memory.codes ??= [];
  return memory;
}
function save(store: Store) { memory = store; try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* sin persistencia */ } }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Respuesta de sesión según el rol, como `roomPayload` del Worker: el participante solo ve su vista filtrada. */
function payload(store: Store, state: SessionState, role: 'instructor' | 'participant') {
  if (role === 'participant') return { state: participantView(state, actors.participant.id), report: participantReport(state, actors.participant.id), clients: {} };
  const sim = new Set(store.simulated[state.id] ?? []);
  const report = performanceReport(state);
  const phase = state.scenario.phases[state.phaseIndex];
  const decisions = state.decisions.filter(decision => decision.phaseId === phase.id);
  return {
    state: { ...state, participants: state.participants.map(person => sim.has(person.userId) ? { ...person, simulated: true } : person) },
    report: { ...report, participantReports: report.participantReports.map(row => sim.has(row.userId) ? { ...row, simulated: true } : row) },
    clients: {},
    liveTally: { phaseId: phase.id, counts: phase.options.map(option => decisions.filter(decision => decision.optionId === option.id).length), decided: new Set(decisions.map(decision => decision.userId)).size, total: state.participants.length }
  };
}

async function handle(path: string, init: RequestInit | undefined, role: 'instructor' | 'participant'): Promise<Response> {
  const store = load();
  const actor = actors[role];
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const now = new Date().toISOString();
  // Los simulados deciden y los temporizadores vencen al consultar, igual que haría la alarma del Durable Object.
  store.sessions = store.sessions.map(state => expireTimer(stepSimulated(state, store.simulated[state.id] ?? [], Date.now()), now).state);
  const reserved = () => json({ error: 'Acción reservada al docente.' }, 403);
  if (path === '/me') return json({ identity: { id: actor.id, name: actor.name, email: actor.email, role, tenantId: 'demo' }, demo: true, standalone: true, flags: { phase_timers: true }, permissions: { assignInstructor: role === 'instructor' } });
  if (path === '/scenarios') return json({ scenarios: catalogScenarios.map(item => ({ id: item.id, version: item.version, title: item.title, summary: item.summary, phases: item.phases.length, catalog: true })) });
  if (path.startsWith('/scenarios/')) {
    const scenario = catalogScenarios.find(item => item.id === decodeURIComponent(path.slice('/scenarios/'.length)));
    return scenario ? json({ scenario: validateScenario(scenario) }) : json({ error: 'Escenario no encontrado.' }, 404);
  }
  if (path === '/sessions' && method === 'GET') {
    save(store);
    // Participante: solo las sesiones a las que se ha unido. Orden: abiertas primero y después por fecha.
    const visible = store.sessions.filter(state => role === 'instructor' || state.participants.some(person => person.userId === actor.id));
    const sorted = [...visible].sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || b.createdAt.localeCompare(a.createdAt));
    return json({ sessions: sorted.slice(0, 200).map(state => row(store, state, role)) });
  }
  if (path === '/sessions' && method === 'POST') {
    if (role !== 'instructor') return reserved();
    const name = body.name === undefined ? null : String(body.name).trim();
    if (name !== null && (name.length < 1 || name.length > 80)) return json({ error: 'El nombre de la sesión debe tener entre 1 y 80 caracteres.' }, 400);
    const scenario = catalogScenarios.find(item => item.id === body.scenarioId) ?? defaultScenario;
    const state = createSession(crypto.randomUUID(), 'demo', actor, now, scenario);
    store.sessions.push(state);
    if (name) store.names[state.id] = name;
    save(store);
    return json({ ...payload(store, state, role), session: row(store, state, role) }, 201);
  }
  if (path === '/memberships') {
    if (role !== 'instructor') return reserved();
    if (method === 'POST') {
      const email = String(body.email ?? '').trim().toLowerCase();
      const name = String(body.name ?? '').trim();
      if (!name || name.length > 100 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Revisa el nombre y el correo.' }, 400);
      const existing = store.members.find(item => item.email === email);
      const member: Member = { id: existing?.id ?? crypto.randomUUID(), email, name, role: body.role === 'instructor' ? 'instructor' : 'participant' };
      store.members = [...store.members.filter(item => item.email !== email), member];
      save(store);
      return json({ member }, 201);
    }
    return json({ members: [...store.members].sort((a, b) => a.name.localeCompare(b.name)) });
  }
  const memberMatch = path.match(/^\/memberships\/([^/]+)$/);
  if (memberMatch && method === 'DELETE') {
    if (role !== 'instructor') return reserved();
    const userId = decodeURIComponent(memberMatch[1]);
    if (userId === actor.id) return json({ error: 'No puedes darte de baja a ti mismo.' }, 400);
    if (!store.members.some(item => item.id === userId)) return json({ error: 'Miembro no encontrado.' }, 404);
    store.members = store.members.filter(item => item.id !== userId);
    store.codes = store.codes.filter(item => item.userId !== userId);
    save(store);
    return json({ deleted: true });
  }
  if (path === '/access-codes') {
    if (role !== 'instructor') return reserved();
    return json({ codes: store.codes.map(({ code: _code, ...rest }) => rest), uses: [] });
  }
  const codeMatch = path.match(/^\/access-codes\/([^/]+)$/);
  if (codeMatch) {
    if (role !== 'instructor') return reserved();
    const userId = decodeURIComponent(codeMatch[1]);
    if (!store.members.some(item => item.id === userId)) return json({ error: 'Miembro no encontrado.' }, 404);
    store.codes = store.codes.filter(item => item.userId !== userId);
    if (method === 'DELETE') { save(store); return json({ revoked: true }); }
    const code = String(Math.floor(100000 + Math.random() * 900000));
    store.codes.push({ id: crypto.randomUUID(), userId, code, createdAt: now, uses: 0, lastUsedAt: null });
    save(store);
    return json({ code }, 201);
  }
  const match = path.match(/^\/sessions\/([^/]+)(\/commands|\/demo-class|\/duplicate|\/export)?$/);
  const index = match ? store.sessions.findIndex(state => state.id === decodeURIComponent(match[1])) : -1;
  if (!match || index < 0) return json({ error: 'Sesión no encontrada.' }, 404);
  const current = store.sessions[index];
  if (!match[2]) {
    if (method === 'DELETE') {
      if (role !== 'instructor') return reserved();
      store.sessions.splice(index, 1);
      delete store.simulated[current.id]; delete store.names[current.id];
      save(store);
      return json({ deleted: true });
    }
    if (method === 'PATCH') {
      if (role !== 'instructor') return reserved();
      const name = String(body.name ?? '').trim();
      if (name.length < 1 || name.length > 80) return json({ error: 'El nombre de la sesión debe tener entre 1 y 80 caracteres.' }, 400);
      store.names[current.id] = name; save(store);
      return json({ session: row(store, current, role) });
    }
    save(store);
    return json(payload(store, current, role));
  }
  if (match[2] === '/duplicate') {
    if (role !== 'instructor') return reserved();
    const state = createSession(crypto.randomUUID(), 'demo', actor, now, current.scenario);
    store.sessions.push(state);
    const base = store.names[current.id];
    if (base) store.names[state.id] = `${base} (copia)`.slice(0, 80);
    save(store);
    return json({ ...payload(store, state, role), session: row(store, state, role) }, 201);
  }
  if (match[2] === '/export') {
    if (role !== 'instructor') return reserved();
    const data = payload(store, current, role);
    return json({ exportedAt: now, session: data.state, report: data.report });
  }
  if (match[2] === '/demo-class') {
    if (role !== 'instructor') return reserved();
    const existing = store.simulated[current.id] ?? [];
    if (method === 'DELETE') {
      store.sessions[index] = removeSimulated(current, existing);
      store.simulated[current.id] = [];
      save(store);
      return json({ ...payload(store, store.sessions[index], role), demoClass: { removed: existing.length, total: 0 } });
    }
    if (current.status === 'complete') return json({ error: 'La sesión ya terminó.' }, 400);
    const room = 40 - existing.length;
    if (room <= 0) return json({ error: 'Máximo 40 participantes simulados.' }, 400);
    const count = Math.min(room, Math.max(1, Math.floor(Number(body.count)) || 20));
    const added = addSimulated(current, count, now, existing);
    store.sessions[index] = added.state;
    store.simulated[current.id] = added.ids;
    save(store);
    return json({ ...payload(store, added.state, role), demoClass: { added: count, total: added.ids.length } }, 201);
  }
  const result = applyCommand(current, body as Command, actor, now);
  store.sessions[index] = result.state; save(store);
  return json(payload(store, result.state, role));
}

export function installStandaloneApi() {
  const original = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url;
    if (!url.startsWith('/api')) return original(input, init);
    const role = new Headers(init?.headers).get('x-demo-user') === 'participant' ? 'participant' : 'instructor';
    try { return await handle(url.slice(4), init, role); }
    catch (error) {
      if (error instanceof DomainError || error instanceof ScenarioError) return json({ error: error.message }, 400);
      return json({ error: 'Error interno de la demo.' }, 500);
    }
  };
}
