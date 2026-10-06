import { DurableObject } from 'cloudflare:workers';
import { applyCommand, createSession, DomainError, expireTimer, type Actor, type Command } from '../shared/engine';
import { participantReport, participantView, performanceReport, type Scenario, type SessionState, type SimEvent } from '../shared/simulation';
import type { SimEventType } from '../shared/events';
import type { Env, EventMessage } from './types';
import { flags } from './flags';

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
 * Respuesta de las operaciones `state`/`command` según quién pregunta. El instructor ve el estado completo y el
 * informe de la clase; cualquier otro actor (participante) solo su vista filtrada y su informe individual.
 */
export function roomPayload(state: SessionState, actor: Pick<Actor, 'id' | 'role'> | undefined, clients: Partial<Record<ClientKind, string>>) {
  if (actor?.role === 'instructor') return { state, report: performanceReport(state), clients };
  // Por defecto, la vista restringida: un actor ausente o con un rol desconocido no ve el estado completo.
  const userId = actor?.id ?? '';
  return { state: participantView(state, userId), report: participantReport(state, userId), clients };
}

export class SessionRoom extends DurableObject<Env> {
  /** Presencia en memoria de los clientes de simulación. No se persiste: es solo indicativa. */
  private clientSeen: Partial<Record<ClientKind, string>> = {};

  private async flush(state: SessionState): Promise<void> {
    if (!state.pendingEvents.length) return;
    await this.env.EVENTS.sendBatch(queueMessages(state, state.pendingEvents));
    state.pendingEvents = [];
    await this.ctx.storage.put('state', state);
  }

  /** Programa la alarma del Durable Object para que el temporizador venza aunque nadie consulte la sesión. */
  private async syncAlarm(state: SessionState): Promise<void> {
    if (flags(this.env).phase_timers && state.status === 'active' && state.phaseDeadline) await this.ctx.storage.setAlarm(Date.parse(state.phaseDeadline));
    else await this.ctx.storage.deleteAlarm();
  }

  async alarm(): Promise<void> {
    const stored = await this.ctx.storage.get<SessionState>('state');
    if (!stored) return;
    const { state, events } = expireTimer(stored, new Date().toISOString());
    if (events.length) {
      state.pendingEvents.push(...events);
      await this.ctx.storage.put('state', state);
      try { await this.flush(state); } catch (error) { console.error(JSON.stringify({ code: 'QUEUE_FLUSH_FAILED', sessionId: state.id, message: String(error) })); }
    }
    await this.syncAlarm(state);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { op: 'create' | 'state' | 'command' | 'purge'; id?: string; tenantId: string; actor: Actor; command?: Command; client?: ClientKind; scenario?: Scenario };
      if (body.op === 'purge') {
        await this.ctx.storage.deleteAlarm();
        await this.ctx.storage.deleteAll();
        return Response.json({ purged: true });
      }
      let state = await this.ctx.storage.get<SessionState>('state');
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
        }
      }
      if (body.client === 'unity') this.clientSeen.unity = new Date().toISOString();
      if (body.op !== 'state') await this.syncAlarm(state);
      try { await this.flush(state); } catch (error) { console.error(JSON.stringify({ code: 'QUEUE_FLUSH_FAILED', sessionId: state.id, message: String(error) })); }
      return Response.json(roomPayload(state, body.actor, this.clientSeen));
    } catch (error) {
      if (error instanceof DomainError) return Response.json({ error: error.message }, { status: 400 });
      console.error(JSON.stringify({ code: 'ROOM_ERROR', message: String(error) }));
      return Response.json({ error: 'Error interno de la sesión.' }, { status: 500 });
    }
  }
}

export function pendingEventCount(state: SessionState): number { return state.pendingEvents.length; }
export type { SimEvent };
