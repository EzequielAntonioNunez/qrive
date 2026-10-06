/**
 * Modo demo en navegador: emula la API de AXYRO con el mismo motor (shared/engine) y guarda el estado
 * en el navegador. Solo se incluye al compilar con VITE_STANDALONE=1; el build normal no lo contiene.
 */
import { applyCommand, createSession, DomainError, expireTimer, type Actor, type Command } from '../shared/engine';
import { negotiationScenario, performanceReport, type SessionState } from '../shared/simulation';
import { ScenarioError, validateScenario } from '../shared/scenario';

type Member = { id: string; email: string; name: string; role: 'instructor' | 'participant' };
type Store = { sessions: SessionState[]; members: Member[] };

const KEY = 'axyro-standalone-v1';
const actors: Record<'instructor' | 'participant', Actor & { email: string; tenantId: string }> = {
  instructor: { id: 'demo-instructor', name: 'Instructor demo', role: 'instructor', email: 'instructor@demo.local', tenantId: 'demo' },
  participant: { id: 'demo-participant', name: 'Participante demo', role: 'participant', email: 'participante@demo.local', tenantId: 'demo' }
};

function seed(): Store {
  // Una sesión de ejemplo ya terminada, para que el debriefing tenga contenido desde el primer momento.
  const t = (minutesAgo: number) => new Date(Date.now() - minutesAgo * 60000).toISOString();
  let state = createSession(crypto.randomUUID(), 'demo', actors.instructor, t(30));
  const run = (command: Command, actor: Actor, at: string) => { state = applyCommand(state, command, actor, at).state; };
  run({ id: 'seed-join', type: 'join' }, actors.participant, t(29));
  run({ id: 'seed-d1', type: 'decide', optionId: 'ask-data' }, actors.participant, t(27));
  run({ id: 'seed-a1', type: 'advance' }, actors.instructor, t(25));
  run({ id: 'seed-d2', type: 'decide', optionId: 'accept-twelve' }, actors.participant, t(22));
  run({ id: 'seed-i1', type: 'incident', note: 'El proveedor alternativo retira su oferta', riskDelta: 5 }, actors.instructor, t(21));
  run({ id: 'seed-a2', type: 'advance' }, actors.instructor, t(20));
  run({ id: 'seed-d3', type: 'decide', optionId: 'milestones' }, actors.participant, t(18));
  run({ id: 'seed-end', type: 'complete' }, actors.instructor, t(17));
  return { sessions: [state], members: [actors.instructor, actors.participant].map(({ id, email, name, role }) => ({ id, email, name, role })) };
}

let memory: Store | null = null;
function load(): Store {
  if (memory) return memory;
  try { const raw = localStorage.getItem(KEY); if (raw) memory = JSON.parse(raw) as Store; } catch { /* almacenamiento no disponible */ }
  memory ??= seed();
  return memory;
}
function save(store: Store) { memory = store; try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* sin persistencia */ } }

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const payload = (state: SessionState) => ({ state, report: performanceReport(state), clients: {} });
const statusOf = (state: SessionState) => state.status;

async function handle(path: string, init: RequestInit | undefined, role: 'instructor' | 'participant'): Promise<Response> {
  const store = load();
  const actor = actors[role];
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const now = new Date().toISOString();
  // Los temporizadores vencen al consultar, igual que haría la alarma del Durable Object.
  store.sessions = store.sessions.map(state => expireTimer(state, now).state);
  if (path === '/me') return json({ identity: { id: actor.id, name: actor.name, role, tenantId: 'demo' }, demo: true, standalone: true, flags: { phase_timers: true } });
  if (path === '/scenarios') return json({ scenarios: [{ id: negotiationScenario.id, version: negotiationScenario.version, title: negotiationScenario.title, summary: negotiationScenario.summary, phases: negotiationScenario.phases.length, catalog: true }] });
  if (path.startsWith('/scenarios/')) return json({ scenario: validateScenario(negotiationScenario) });
  if (path === '/sessions' && method === 'GET') {
    save(store);
    return json({ sessions: [...store.sessions].reverse().map(state => ({ id: state.id, status: statusOf(state), createdAt: state.createdAt, scenarioId: state.scenario.id })) });
  }
  if (path === '/sessions' && method === 'POST') {
    if (role !== 'instructor') return json({ error: 'Acción reservada al instructor.' }, 403);
    const state = createSession(crypto.randomUUID(), 'demo', actor, now);
    store.sessions.push(state); save(store);
    return json(payload(state), 201);
  }
  if (path === '/memberships') {
    if (role !== 'instructor') return json({ error: 'Acción reservada al instructor.' }, 403);
    if (method === 'POST') {
      const member: Member = { id: crypto.randomUUID(), email: String(body.email ?? '').toLowerCase(), name: String(body.name ?? '').trim(), role: 'participant' };
      if (!member.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email)) return json({ error: 'Miembro no válido.' }, 400);
      store.members.push(member); save(store);
      return json({ member }, 201);
    }
    return json({ members: [...store.members].sort((a, b) => a.name.localeCompare(b.name)) });
  }
  const match = path.match(/^\/sessions\/([^/]+)(\/commands)?$/);
  const index = match ? store.sessions.findIndex(state => state.id === decodeURIComponent(match[1])) : -1;
  if (!match || index < 0) return json({ error: 'Sesión no encontrada.' }, 404);
  if (!match[2]) { save(store); return json(payload(store.sessions[index])); }
  const result = applyCommand(store.sessions[index], body as Command, actor, now);
  store.sessions[index] = result.state; save(store);
  return json(payload(result.state));
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
