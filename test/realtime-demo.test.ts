import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// DurableObject mínimo: guarda ctx y env como el de workerd.
vi.mock('cloudflare:workers', () => ({ DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));

const { SessionRoom, broadcastMessages, liveMessage, parseRoomActor, processAlarm, roomPayload, queueSafeEvent } = await import('../worker/room');
const { BOT_MAX_DELAY_MS, BOT_MIN_DELAY_MS, MAX_SIMULATED, addSimulated, liveTally, nextAlarmAt, pickOption, reconcileBots, removeSimulated, simulatedPrefix } = await import('../worker/demo-class');
const { applyCommand, createSession } = await import('../shared/engine');
const { defaultScenario, negotiationScenario, performanceReport } = await import('../shared/simulation');
type SessionState = import('../shared/simulation').SessionState;
type Actor = import('../shared/engine').Actor;

const instructor: Actor = { id: 'u-prof', name: 'Profesora', role: 'instructor' };
const alumna: Actor = { id: 'u-alumna', name: 'Alumna', role: 'participant' };
const T0 = Date.parse('2026-10-06T09:00:00.000Z');
const iso = (ms: number) => new Date(T0 + ms).toISOString();

/** Generador determinista para repartir valoraciones de forma reproducible. */
function sequence(values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

function baseState(): SessionState {
  let state = createSession('abcdef12-3456-7890-abcd-ef1234567890', 'ufv', instructor, iso(0), defaultScenario);
  state = applyCommand(state, { id: 'cmd-join-alumna', type: 'join' }, alumna, iso(0)).state;
  return state;
}

describe('recuento en vivo y vista del participante', () => {
  it('el instructor recibe liveTally de la fase activa; el participante nunca, ni datos de compañeros', () => {
    let state = baseState();
    state = addSimulated(state, 3, iso(1000)).state;
    const phase = state.scenario.phases[0];
    const [first, second] = phase.options;
    state = applyCommand(state, { id: 'cmd-decide-alumna', type: 'decide', optionId: first.id }, alumna, iso(2000)).state;
    const bot = state.participants.find(person => person.simulated)!;
    state = applyCommand(state, { id: 'cmd-decide-bot', type: 'decide', optionId: second.id }, { id: bot.userId, name: bot.name, role: 'participant' }, iso(3000)).state;

    const tally = liveTally(state);
    expect(tally).toEqual({ phaseId: phase.id, counts: phase.options.map((_, index) => (index < 2 ? 1 : 0)), decided: 2, total: 4 });
    expect(roomPayload(state, instructor, {})).toMatchObject({ liveTally: tally });

    const view = roomPayload(state, alumna, {});
    expect(view).not.toHaveProperty('liveTally');
    expect(view.state.participants.map(person => person.userId)).toEqual([alumna.id]);
    expect(view.state.decisions.every(decision => decision.userId === alumna.id)).toBe(true);
    expect(view.report.participantReports).toEqual([]);
    const text = JSON.stringify(view);
    expect(text).not.toContain(simulatedPrefix(state.id));
    expect(text).not.toContain('liveTally');
    // Un actor sin identidad ve la vista restringida, también sin recuento.
    expect(roomPayload(state, undefined, {})).not.toHaveProperty('liveTally');
  });

  it('el mensaje de cada socket es exactamente el cuerpo de GET para su identidad, sin mezclar identidades', () => {
    const state = addSimulated(baseState(), 2, iso(1000)).state;
    const sockets = [{ userId: instructor.id, role: 'instructor' as const }, { userId: alumna.id, role: 'participant' as const }, null, { userId: alumna.id, role: 'participant' as const }];
    const messages = broadcastMessages(state, sockets, { unity: iso(5) });
    expect(JSON.parse(messages[0]!)).toEqual({ type: 'session', data: JSON.parse(JSON.stringify(roomPayload(state, instructor, { unity: iso(5) }))) });
    expect(JSON.parse(messages[1]!)).toEqual({ type: 'session', data: JSON.parse(JSON.stringify(roomPayload(state, alumna, { unity: iso(5) }))) });
    expect(messages[2]).toBeNull();
    expect(messages[3]).toBe(messages[1]);
    expect(messages[1]).toBe(liveMessage(state, { userId: alumna.id, role: 'participant' }, { unity: iso(5) }));
    expect(JSON.parse(messages[1]!).data).not.toHaveProperty('liveTally');
  });

  it('solo acepta la identidad interna bien formada', () => {
    expect(parseRoomActor(null)).toBeNull();
    expect(parseRoomActor('no-json')).toBeNull();
    expect(parseRoomActor(JSON.stringify({ id: 'u', role: 'owner', tenantId: 't' }))).toBeNull();
    expect(parseRoomActor(JSON.stringify({ id: 'u', role: 'participant' }))).toBeNull();
    expect(parseRoomActor(JSON.stringify({ id: 'u', name: 'N', role: 'participant', tenantId: 't' }))).toEqual({ id: 'u', name: 'N', role: 'participant', tenantId: 't' });
  });
});

describe('clase simulada: motor puro', () => {
  it('añade participantes simulados seudónimos, marcados y por la vía normal de unión', () => {
    const { state, events, added } = addSimulated(baseState(), 3, iso(1000));
    const prefix = simulatedPrefix(state.id);
    expect(prefix).toBe('sim-abcdef12-');
    expect(added).toEqual([`${prefix}01`, `${prefix}02`, `${prefix}03`]);
    expect(state.participants.filter(person => person.simulated).map(person => person.name)).toEqual(['Participante simulado 01', 'Participante simulado 02', 'Participante simulado 03']);
    expect(state.participants.find(person => person.userId === alumna.id)).not.toHaveProperty('simulated');
    expect(events.map(event => event.type)).toEqual(['participant_joined', 'participant_joined', 'participant_joined']);
    // En la cola solo salen IDs seudónimos.
    expect(events.map(event => queueSafeEvent(event).detail)).toEqual(added.map(id => ({ participantId: id })));
    // La numeración continúa y nunca reutiliza IDs ya usados, aunque se retiren.
    const removed = removeSimulated(state).state;
    expect(addSimulated(removed, 1, iso(2000)).added).toEqual([`${prefix}04`]);
  });

  it('respeta los límites: 1-40, máximo 40 a la vez y nunca en una sesión terminada', () => {
    const state = baseState();
    expect(() => addSimulated(state, 0, iso(1))).toThrow(/entre 1 y 40/);
    expect(() => addSimulated(state, MAX_SIMULATED + 1, iso(1))).toThrow(/entre 1 y 40/);
    expect(() => addSimulated(state, 2.5, iso(1))).toThrow(/entre 1 y 40/);
    const full = addSimulated(state, MAX_SIMULATED, iso(1)).state;
    expect(() => addSimulated(full, 1, iso(2))).toThrow(/Como máximo 40/);
    expect(() => addSimulated({ ...state, status: 'complete' }, 1, iso(2))).toThrow(/terminó/);
    expect(() => removeSimulated({ ...state, status: 'complete' })).toThrow(/terminó/);
  });

  it('elige opciones con un reparto plausible: mejor 45 %, aceptable 35 %, mala 20 %', () => {
    const phase = defaultScenario.phases[1]; // verificación: 1 mejor, 1 aceptable, 2 malas
    const count = { best: 0, acceptable: 0, poor: 0 };
    const steps = 1000;
    for (let i = 0; i < steps; i++) {
      const roll = (i + 0.5) / steps;
      count[pickOption(phase, sequence([roll, 0.5]))!.quality!] += 1;
    }
    expect(count).toEqual({ best: 450, acceptable: 350, poor: 200 });
    // Sin opción aceptable, el peso se reparte entre las que hay: 45/65 mejor.
    const noAcceptable = negotiationScenario.phases[0];
    expect(pickOption(noAcceptable, sequence([0.68, 0])).quality).toBe('best');
    expect(pickOption(noAcceptable, sequence([0.7, 0])).quality).toBe('poor');
  });

  it('programa cada decisión a 2-12 s, multiplexa la alarma con el temporizador y vacía la agenda en pausa', () => {
    const state = addSimulated(baseState(), 4, iso(0)).state;
    const tasks = reconcileBots(state, [], T0, sequence([0, 1, 0.5, 0.25]));
    expect(tasks.map(task => task.dueAt - T0).sort((a, b) => a - b)).toEqual([BOT_MIN_DELAY_MS, 4500, 7000, BOT_MAX_DELAY_MS]);
    expect(new Set(tasks.map(task => task.phaseId))).toEqual(new Set([state.scenario.phases[0].id]));
    // Reconciliar otra vez conserva las tareas existentes.
    expect(reconcileBots(state, tasks, T0 + 1000, () => 0.99)).toEqual(tasks);
    const deadline = Date.parse(state.phaseDeadline!);
    expect(nextAlarmAt(state, tasks, true)).toBe(T0 + BOT_MIN_DELAY_MS);
    expect(nextAlarmAt(state, [], true)).toBe(deadline);
    expect(nextAlarmAt(state, [], false)).toBeNull();
    const paused = applyCommand(state, { id: 'cmd-pause-1', type: 'pause' }, instructor, iso(500)).state;
    expect(reconcileBots(paused, tasks, T0 + 500)).toEqual([]);
    expect(nextAlarmAt(paused, tasks, true)).toBeNull();
  });

  it('la alarma hace decidir a los simulados por el motor, actualiza el recuento y en la siguiente fase vuelve a programarlos', () => {
    let state = addSimulated(baseState(), 5, iso(0)).state;
    let tasks = reconcileBots(state, [], T0, () => 0.5);
    let result = processAlarm(state, tasks, T0 + 3000, true, () => 0.1);
    expect(result.events).toEqual([]);
    result = processAlarm(state, tasks, T0 + BOT_MAX_DELAY_MS, true, () => 0.1);
    state = result.state;
    expect(result.events.map(event => event.type)).toEqual(Array(5).fill('decision'));
    expect(result.events.every(event => event.actorId.startsWith('sim-'))).toBe(true);
    expect(result.events.map(event => Object.keys(queueSafeEvent(event).detail).sort())).toEqual(Array(5).fill(['durationMs', 'optionId', 'phaseId']));
    expect(result.tasks).toEqual([]);
    expect(liveTally(state)).toMatchObject({ decided: 5, total: 6 });
    // Con rng 0.1 todos eligen la mejor opción: los indicadores cambian como los de una persona.
    const best = state.scenario.phases[0].options.find(option => option.quality === 'best')!;
    expect(liveTally(state).counts[state.scenario.phases[0].options.indexOf(best)]).toBe(5);
    const report = performanceReport(state);
    expect(report.participantReports.filter(entry => entry.simulated === true)).toHaveLength(5);
    expect(report.participantReports.find(entry => entry.userId === alumna.id)).not.toHaveProperty('simulated');
    expect(report.decisions).toBe(5);

    state = applyCommand(state, { id: 'cmd-advance-1', type: 'advance' }, instructor, iso(20000)).state;
    tasks = reconcileBots(state, result.tasks, T0 + 20000, () => 0);
    expect(tasks).toHaveLength(5);
    expect(tasks.every(task => task.phaseId === state.scenario.phases[1].id && task.dueAt === T0 + 22000)).toBe(true);
  });

  it('decide antes del vencimiento si su hora es anterior al fin de la fase, y después si es posterior', () => {
    let state = addSimulated(baseState(), 2, iso(0)).state;
    const deadline = Date.parse(state.phaseDeadline!);
    const [early, late] = state.participants.filter(person => person.simulated);
    const phaseId = state.scenario.phases[0].id;
    const tasks = [{ userId: early.userId, phaseId, dueAt: deadline - 1 }, { userId: late.userId, phaseId, dueAt: deadline + 1 }];
    const result = processAlarm(state, tasks, deadline + 5, true, () => 0.1);
    expect(result.events.map(event => [event.type, event.actorId])).toEqual([['decision', early.userId], ['timer_expired', 'system'], ['decision', late.userId]]);
    state = result.state;
    const reports = performanceReport(state).participantReports;
    expect(reports.find(entry => entry.userId === early.userId)!.timeouts).toBe(0);
    expect(reports.find(entry => entry.userId === late.userId)!.timeouts).toBe(1);
  });

  it('retirar la clase simulada quita participantes, decisiones e indicadores y recalcula la media', () => {
    let state = baseState();
    const option = state.scenario.phases[0].options[0];
    state = applyCommand(state, { id: 'cmd-decide-a', type: 'decide', optionId: option.id }, alumna, iso(100)).state;
    const realOnly = performanceReport(state);
    state = addSimulated(state, 4, iso(200)).state;
    state = processAlarm(state, reconcileBots(state, [], T0, () => 0.5), T0 + 60_000, false, () => 0.9).state;
    expect(performanceReport(state).participants).toBe(5);
    const { state: cleaned, removed } = removeSimulated(state);
    expect(removed).toBe(4);
    expect(cleaned.participants.map(person => person.userId)).toEqual([alumna.id]);
    expect(Object.keys(cleaned.participantMeters)).toEqual([alumna.id]);
    expect(cleaned.meters).toEqual(state.participantMeters[alumna.id]);
    const report = performanceReport(cleaned);
    expect({ ...report, timeline: report.timeline.length }).toMatchObject({ ...realOnly, timeline: realOnly.timeline.length, participantReports: realOnly.participantReports });
    expect(removeSimulated(cleaned).removed).toBe(0);
  });
});

// ---------------------------------------------------------------------------------------------
// Durable Object con almacenamiento y sockets simulados: difusión por socket y alarma real.
// ---------------------------------------------------------------------------------------------
function fakeRoom() {
  const store = new Map<string, unknown>();
  let alarm: number | null = null;
  const sent: unknown[] = [];
  const sockets = [
    { attachment: { userId: instructor.id, role: 'instructor' }, messages: [] as string[] },
    { attachment: { userId: alumna.id, role: 'participant' }, messages: [] as string[] }
  ].map(item => ({ ...item, closed: [] as number[], deserializeAttachment: () => item.attachment, send: (message: string) => item.messages.push(message) }))
    .map(item => ({ ...item, close: (code: number) => { item.closed.push(code); } }));
  const ctx = {
    storage: {
      get: async (key: string) => structuredClone(store.get(key)),
      put: async (key: string, value: unknown) => { store.set(key, structuredClone(value)); },
      deleteAll: async () => store.clear(),
      setAlarm: async (at: number) => { alarm = at; },
      deleteAlarm: async () => { alarm = null; }
    },
    getWebSockets: () => sockets,
    setWebSocketAutoResponse: () => {}
  };
  const env = { EVENTS: { sendBatch: async (messages: unknown[]) => { sent.push(...messages); } }, FEATURE_FLAGS: '{"phase_timers":true}' };
  const room = new SessionRoom(ctx as never, env as never);
  const op = async (body: Record<string, unknown>) => {
    const response = await room.fetch(new Request('https://room.internal/', { method: 'POST', body: JSON.stringify({ tenantId: 'ufv', ...body }) }));
    return { status: response.status, body: await response.json() as Record<string, any> };
  };
  return { room, op, store, sockets, sent, alarm: () => alarm };
}

describe('SessionRoom: clase simulada y difusión en tiempo real', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); vi.spyOn(console, 'error').mockImplementation(() => {}); });
  afterEach(() => { vi.useRealTimers(); });

  it('difunde a cada socket su propia vista tras cada cambio y las decisiones simuladas llegan por la alarma', async () => {
    const { op, room, sockets, sent, alarm, store } = fakeRoom();
    const id = 'abcdef12-0000-0000-0000-000000000000';
    expect((await op({ op: 'create', id, actor: instructor, scenario: defaultScenario })).status).toBe(200);
    await op({ op: 'command', actor: alumna, command: { id: 'cmd-join-alumna', type: 'join' } });
    const [teacher, student] = sockets;
    expect(teacher.messages).toHaveLength(1);
    expect(student.messages).toHaveLength(1);

    expect((await op({ op: 'demo-add', actor: alumna, count: 3 })).status).toBe(403);
    expect((await op({ op: 'demo-add', actor: { ...instructor, id: 'otro-docente' }, count: 3 })).status).toBe(403);
    const added = await op({ op: 'demo-add', actor: instructor, count: 3 });
    expect(added.status).toBe(200);
    expect(added.body.demoClass).toEqual({ added: 3, total: 3 });
    expect(added.body.state.participants.filter((person: { simulated?: boolean }) => person.simulated)).toHaveLength(3);
    expect(added.body.liveTally).toMatchObject({ decided: 0, total: 4 });
    // Agenda guardada y alarma en la decisión simulada más próxima (antes que el fin de la fase).
    const tasks = store.get('bots') as { dueAt: number }[];
    expect(tasks).toHaveLength(3);
    expect(alarm()).toBe(Math.min(...tasks.map(task => task.dueAt)));
    expect(tasks.every(task => task.dueAt >= T0 + BOT_MIN_DELAY_MS && task.dueAt <= T0 + BOT_MAX_DELAY_MS)).toBe(true);

    vi.setSystemTime(T0 + BOT_MAX_DELAY_MS);
    const before = teacher.messages.length;
    await room.alarm();
    expect(teacher.messages.length).toBe(before + 1);
    const live = JSON.parse(teacher.messages.at(-1)!);
    expect(live.type).toBe('session');
    expect(live.data.liveTally).toMatchObject({ decided: 3, total: 4 });
    expect(live.data.report.participantReports.filter((entry: { simulated?: boolean }) => entry.simulated)).toHaveLength(3);
    const studentView = JSON.parse(student.messages.at(-1)!);
    expect(studentView.data).not.toHaveProperty('liveTally');
    expect(studentView.data.state.participants.map((person: { userId: string }) => person.userId)).toEqual([alumna.id]);
    expect(JSON.stringify(studentView)).not.toContain('sim-');
    // La cola recibe las decisiones con IDs seudónimos y los campos de la lista blanca.
    const decisions = (sent as { body: { event: { type: string; actorId: string; detail: object } } }[]).filter(message => message.body.event.type === 'decision');
    expect(decisions).toHaveLength(3);
    expect(decisions.every(message => message.body.event.actorId.startsWith('sim-abcdef12-'))).toBe(true);
    expect(store.get('bots')).toEqual([]);

    const removed = await op({ op: 'demo-remove', actor: instructor });
    expect(removed.body.demoClass).toEqual({ removed: 3, total: 0 });
    expect(removed.body.liveTally).toMatchObject({ decided: 0, total: 1 });
    expect(JSON.parse(teacher.messages.at(-1)!).data.state.participants).toHaveLength(1);
  });

  it('en pausa los simulados esperan; al reanudar se programan de nuevo', async () => {
    const { op, room, store, alarm } = fakeRoom();
    await op({ op: 'create', id: 'abcdef12-1111', actor: instructor, scenario: defaultScenario });
    await op({ op: 'demo-add', actor: instructor, count: 2 });
    await op({ op: 'command', actor: instructor, command: { id: 'cmd-pause-1', type: 'pause' } });
    expect(store.get('bots')).toEqual([]);
    expect(alarm()).toBeNull();
    vi.setSystemTime(T0 + 60_000);
    await room.alarm();
    expect((await op({ op: 'state', actor: instructor })).body.liveTally.decided).toBe(0);
    await op({ op: 'command', actor: instructor, command: { id: 'cmd-resume-1', type: 'resume' } });
    expect(store.get('bots')).toHaveLength(2);
    vi.setSystemTime(T0 + 60_000 + BOT_MAX_DELAY_MS);
    await room.alarm();
    expect((await op({ op: 'state', actor: instructor })).body.liveTally.decided).toBe(2);
  });

  it('purgar una sesión activa cierra los sockets con 4404 y borra estado y alarma', async () => {
    const { op, store, sockets, alarm } = fakeRoom();
    await op({ op: 'create', id: 'abcdef12-2222', actor: instructor, scenario: defaultScenario });
    await op({ op: 'demo-add', actor: instructor, count: 2 });
    expect(alarm()).not.toBeNull();
    expect((await op({ op: 'purge' })).body).toEqual({ purged: true });
    expect(sockets.map(socket => socket.closed)).toEqual([[4404], [4404]]);
    expect(store.size).toBe(0);
    expect(alarm()).toBeNull();
    expect((await op({ op: 'state', actor: instructor })).status).toBe(404);
  });

  it('responde al ping de la aplicación y no acepta órdenes por el socket', async () => {
    const { room } = fakeRoom();
    const replies: string[] = [];
    const ws = { send: (message: string) => replies.push(message) } as unknown as WebSocket;
    await room.webSocketMessage(ws, 'ping');
    await room.webSocketMessage(ws, '{"type":"ping"}');
    await room.webSocketMessage(ws, '{"type":"decide","optionId":"x"}');
    expect(replies).toEqual(['pong', '{"type":"pong"}']);
  });
});
