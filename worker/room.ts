import { DurableObject } from 'cloudflare:workers';
import { applyCommand, createSession, DomainError, expireTimer, type Actor, type Command, type Role } from '../shared/engine';
import { normalizeState, participantReport, participantView, performanceReport, type Scenario, type SessionState, type SimEvent } from '../shared/simulation';
import type { SimEventType } from '../shared/events';
import type { Env, EventMessage } from './types';
import { flags } from './flags';
import { addSimulated, botDecide, liveTally, nextAlarmAt, reconcileBots, removeSimulated, type BotTask, type Rng } from './demo-class';

export type ClientKind = 'unity';

/**
 * Campos de `detail` que pueden salir del Durable Object hacia la cola (y de ahí a D1), por tipo de evento.
 * Solo IDs seudónimos, IDs del escenario y números: nunca texto libre que pueda llevar datos personales.
 * Un campo que no esté aquí se queda en el estado del Durable Object (consola y simulador lo siguen viendo)
 * y en la cola aparece como `<campo>Redacted: true`. Un tipo nuevo obliga a decidir aquí qué campos salen.
 */
export const QUEUE_DETAIL_FIELDS: Record<SimEventType, readonly string[]> = {
  session_started: ['scenarioId', 'scenarioVersion'],
  participant_joined: ['participantId'],
  decision: ['phaseId', 'optionId', 'durationMs'],
  phase_advanced: ['phaseId'],
  paused: [],
  resumed: [],
  incident: ['riskDelta'],
  meter_changed: ['meter', 'value'],
  timer_expired: ['phaseId', 'riskDelta'],
  completed: ['score']
};

/** Copia del evento apta para la cola: `detail` filtrado por la lista blanca de su tipo. */
export function queueSafeEvent(event: SimEvent): SimEvent {
  const allowed = Object.hasOwn(QUEUE_DETAIL_FIELDS, event.type) ? QUEUE_DETAIL_FIELDS[event.type] : [];
  const detail: SimEvent['detail'] = {};
  for (const [key, value] of Object.entries(event.detail ?? {})) {
    if (allowed.includes(key)) detail[key] = value;
    else detail[`${key}Redacted`] = true;
  }
  return { seq: event.seq, type: event.type, at: event.at, actorId: event.actorId, detail };
}

/** Mensajes que se publican en la cola para unos eventos pendientes (ya redactados). */
export function queueMessages(state: Pick<SessionState, 'tenantId' | 'id'>, events: SimEvent[]): { body: EventMessage }[] {
  return events.map(event => ({ body: { tenantId: state.tenantId, sessionId: state.id, event: queueSafeEvent(event) } satisfies EventMessage }));
}

/**
 * Respuesta de las operaciones `state`/`command` (y cuerpo `data` de cada mensaje de tiempo real) según quién pregunta.
 * El instructor ve el estado completo, el informe de la clase y el recuento en vivo de la fase (`liveTally`);
 * cualquier otro actor (participante) solo su vista filtrada y su informe individual, nunca `liveTally`
 * (revelaría las decisiones de sus compañeros).
 */
export function roomPayload(state: SessionState, actor: Pick<Actor, 'id' | 'role'> | undefined, clients: Partial<Record<ClientKind, string>>) {
  if (actor?.role === 'instructor') return { state, report: performanceReport(state), clients, liveTally: liveTally(state) };
  // Por defecto, la vista restringida: un actor ausente o con un rol desconocido no ve el estado completo.
  const userId = actor?.id ?? '';
  return { state: participantView(state, userId), report: participantReport(state, userId), clients };
}

// ---------------------------------------------------------------------------------------------
// Tiempo real (WebSocket con la API de hibernación). El Worker autentica y comprueba la sesión; después reenvía
// la petición de upgrade al Durable Object con la identidad en ROOM_ACTOR_HEADER, una cabecera que construye él
// mismo (la petición interna es nueva: las cabeceras del cliente no llegan aquí).
// ---------------------------------------------------------------------------------------------
export const ROOM_ACTOR_HEADER = 'x-axyro-room-actor';

/** Identidad guardada en cada socket (serializeAttachment): basta para calcular su vista con roomPayload. */
export interface SocketAttachment { userId: string; role: Role }

export interface RoomActor { id: string; name: string; role: Role; tenantId: string }

export function parseRoomActor(value: string | null): RoomActor | null {
  if (!value) return null;
  try {
    const data = JSON.parse(value) as Record<string, unknown>;
    if (typeof data.id !== 'string' || !data.id || typeof data.tenantId !== 'string' || !data.tenantId) return null;
    if (data.role !== 'instructor' && data.role !== 'participant') return null;
    return { id: data.id, name: typeof data.name === 'string' ? data.name : '', role: data.role, tenantId: data.tenantId };
  } catch {
    return null;
  }
}

/** Mensaje `session` para un socket: exactamente el cuerpo de GET /api/sessions/:id para su identidad. */
export function liveMessage(state: SessionState, socket: SocketAttachment, clients: Partial<Record<ClientKind, string>>): string {
  return JSON.stringify({ type: 'session', data: roomPayload(state, { id: socket.userId, role: socket.role }, clients) });
}

/**
 * Mensajes de difusión para un conjunto de sockets, calculados por socket con roomPayload. Se reutiliza el mensaje
 * entre sockets con la misma identidad (p. ej. varias pestañas), nunca entre identidades distintas.
 */
export function broadcastMessages(state: SessionState, sockets: (SocketAttachment | null)[], clients: Partial<Record<ClientKind, string>>): (string | null)[] {
  const cache = new Map<string, string>();
  return sockets.map(socket => {
    if (!socket) return null;
    const key = `${socket.role}:${socket.userId}`;
    let message = cache.get(key);
    if (message === undefined) {
      message = liveMessage(state, socket, clients);
      cache.set(key, message);
    }
    return message;
  });
}

/**
 * Trabajo de la alarma (pura, para poder probarla): decisiones simuladas vencidas (las anteriores al fin de la fase
 * van antes que el vencimiento del temporizador), vencimiento del temporizador si está activo y nueva agenda.
 */
export function processAlarm(stored: SessionState, tasks: BotTask[], now: number, timersOn: boolean, rng: Rng = Math.random): { state: SessionState; events: SimEvent[]; tasks: BotTask[] } {
  let state = normalizeState(stored);
  const events: SimEvent[] = [];
  const at = new Date(now).toISOString();
  const deadline = timersOn && state.phaseDeadline ? Date.parse(state.phaseDeadline) : Number.POSITIVE_INFINITY;
  const due = tasks.filter(task => task.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
  const runBots = (list: BotTask[]) => {
    for (const task of list) {
      const result = botDecide(state, task, at, rng);
      state = result.state;
      events.push(...result.events);
    }
  };
  runBots(due.filter(task => task.dueAt < deadline));
  if (timersOn) {
    const expired = expireTimer(state, at);
    state = expired.state;
    events.push(...expired.events);
  }
  runBots(due.filter(task => task.dueAt >= deadline));
  return { state, events, tasks: reconcileBots(state, tasks.filter(task => task.dueAt > now), now, rng) };
}

type RoomOp = 'create' | 'state' | 'command' | 'restore' | 'purge' | 'demo-add' | 'demo-remove';

export class SessionRoom extends DurableObject<Env> {
  /** Presencia en memoria de los clientes de simulación. No se persiste: es solo indicativa. */
  private clientSeen: Partial<Record<ClientKind, string>> = {};

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    // «ping» → «pong» sin despertar al Durable Object (mantiene viva la conexión a través de proxies).
    try { ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong')); } catch { /* fuera de workerd (tests) */ }
  }

  private async flush(state: SessionState): Promise<void> {
    if (!state.pendingEvents.length) return;
    await this.env.EVENTS.sendBatch(queueMessages(state, state.pendingEvents));
    state.pendingEvents = [];
    await this.ctx.storage.put('state', state);
  }

  private async safeFlush(state: SessionState): Promise<void> {
    try { await this.flush(state); } catch (error) { console.error(JSON.stringify({ code: 'QUEUE_FLUSH_FAILED', sessionId: state.id, message: String(error) })); }
  }

  private async botTasks(): Promise<BotTask[]> {
    return await this.ctx.storage.get<BotTask[]>('bots') ?? [];
  }

  /**
   * Una sola alarma multiplexada: la más cercana entre el fin del temporizador de la fase (para que venza aunque
   * nadie consulte la sesión) y la siguiente decisión simulada.
   */
  private async syncAlarm(state: SessionState, tasks: BotTask[]): Promise<void> {
    const next = nextAlarmAt(state, tasks, flags(this.env).phase_timers);
    if (next !== null) await this.ctx.storage.setAlarm(next);
    else await this.ctx.storage.deleteAlarm();
  }

  /** Recalcula la agenda simulada tras un cambio de estado, la guarda y reprograma la alarma. */
  private async schedule(state: SessionState): Promise<void> {
    const tasks = reconcileBots(state, await this.botTasks(), Date.now());
    await this.ctx.storage.put('bots', tasks);
    await this.syncAlarm(state, tasks);
  }

  /** Envía a cada socket abierto su propia vista (roomPayload según su identidad). */
  private broadcast(state: SessionState): void {
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;
    const messages = broadcastMessages(state, sockets.map(ws => ws.deserializeAttachment() as SocketAttachment | null), this.clientSeen);
    sockets.forEach((ws, index) => {
      const message = messages[index];
      if (!message) return;
      try { ws.send(message); } catch { /* socket cerrándose */ }
    });
  }

  async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get<SessionState>('state');
    if (!stored) return;
    const { state, events, tasks } = processAlarm(stored, await this.botTasks(), Date.now(), flags(this.env).phase_timers);
    if (events.length) {
      state.pendingEvents.push(...events);
      await this.ctx.storage.put('state', state);
    }
    await this.ctx.storage.put('bots', tasks);
    await this.syncAlarm(state, tasks);
    if (events.length) {
      await this.safeFlush(state);
      this.broadcast(state);
    }
  }

  /** Abre un WebSocket de tiempo real. Solo llega aquí desde el Worker, tras autenticar y comprobar la sesión. */
  private async openLive(request: Request): Promise<Response> {
    const actor = parseRoomActor(request.headers.get(ROOM_ACTOR_HEADER));
    if (!actor) return Response.json({ error: 'Identidad no válida.' }, { status: 400 });
    const state = await this.ctx.storage.get<SessionState>('state');
    if (!state || state.tenantId !== actor.tenantId) return Response.json({ error: 'Sesión no encontrada.' }, { status: 404 });
    const [client, server] = Object.values(new WebSocketPair());
    const attachment: SocketAttachment = { userId: actor.id, role: actor.role };
    this.ctx.acceptWebSocket(server, [actor.role]);
    server.serializeAttachment(attachment);
    server.send(liveMessage(normalizeState(state), attachment, this.clientSeen));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (message === 'ping') ws.send('pong');
    else if (typeof message === 'string' && message.length < 64 && message.replace(/\s/g, '') === '{"type":"ping"}') ws.send('{"type":"pong"}');
    // Cualquier otro mensaje se ignora: los cambios de estado van por la API HTTP (CSRF, auditoría y límites).
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    try { ws.close(code === 1005 || code === 1006 ? 1000 : code, reason); } catch { /* ya cerrado */ }
  }

  async webSocketError(): Promise<void> { /* el cliente vuelve a conectar o pasa a consultar periódicamente */ }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') return this.openLive(request);
    try {
      const body = await request.json() as { op: RoomOp; id?: string; tenantId: string; actor: Actor; command?: Command; client?: ClientKind; scenario?: Scenario; snapshot?: SessionState; count?: number };
      if (body.op === 'purge') {
        for (const ws of this.ctx.getWebSockets()) { try { ws.close(4404, 'Sesión borrada'); } catch { /* ya cerrado */ } }
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        return Response.json({ purged: true });
      }
      let state = await this.ctx.storage.get<SessionState>('state');
      if (body.op === 'restore') {
        if (!body.snapshot || body.snapshot.id !== body.id || body.snapshot.tenantId !== body.tenantId)
          return Response.json({ error: 'Estado de sesión inválido.' }, { status: 400 });
        if (!state) {
          state = body.snapshot;
          await this.ctx.storage.put('state', state);
          await this.schedule(state);
        }
        return Response.json({ restored: true });
      }
      let extra: Record<string, unknown> = {};
      if (body.op === 'create') {
        if (state) return Response.json({ error: 'La sesión ya existe.' }, { status: 409 });
        state = createSession(body.id!, body.tenantId, body.actor, new Date().toISOString(), body.scenario);
        state.pendingEvents.push(...state.events);
        await this.ctx.storage.put('state', state);
      } else {
        if (!state || state.tenantId !== body.tenantId) return Response.json({ error: 'Sesión no encontrada.' }, { status: 404 });
        if (body.op === 'command') {
          const result = applyCommand(state, body.command!, body.actor, new Date().toISOString());
          state = result.state;
          state.pendingEvents.push(...result.events);
          await this.ctx.storage.put('state', state);
        } else if (body.op === 'demo-add' || body.op === 'demo-remove') {
          // El Worker ya lo comprueba; se repite aquí porque solo el instructor de la sesión gestiona la clase simulada.
          if (body.actor?.role !== 'instructor' || body.actor.id !== state.instructorId)
            return Response.json({ error: 'Solo el instructor de la sesión puede gestionar la clase simulada.' }, { status: 403 });
          if (body.op === 'demo-add') {
            const result = addSimulated(state, body.count ?? 0, new Date().toISOString());
            state = result.state;
            state.pendingEvents.push(...result.events);
            extra = { demoClass: { added: result.added.length, total: state.participants.filter(person => person.simulated).length } };
          } else {
            const result = removeSimulated(state);
            state = result.state;
            extra = { demoClass: { removed: result.removed, total: 0 } };
          }
          await this.ctx.storage.put('state', state);
        }
      }
      if (body.client === 'unity') this.clientSeen.unity = new Date().toISOString();
      if (body.op !== 'state') await this.schedule(state);
      await this.safeFlush(state);
      if (body.op === 'command' || body.op === 'demo-add' || body.op === 'demo-remove') this.broadcast(state);
      return Response.json({ ...roomPayload(state, body.actor, this.clientSeen), ...extra });
    } catch (error) {
      if (error instanceof DomainError) return Response.json({ error: error.message }, { status: 400 });
      console.error(JSON.stringify({ code: 'ROOM_ERROR', message: String(error) }));
      return Response.json({ error: 'Error interno de la sesión.' }, { status: 500 });
    }
  }
}

export function pendingEventCount(state: SessionState): number { return state.pendingEvents.length; }
export type { SimEvent };
