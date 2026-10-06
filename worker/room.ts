import { DurableObject } from 'cloudflare:workers';
import { applyCommand, createSession, DomainError, expireTimer, type Actor, type Command } from '../shared/engine';
import { performanceReport, type Scenario, type SessionState, type SimEvent } from '../shared/simulation';
import type { Env, EventMessage } from './types';
import { flags } from './flags';

export type ClientKind = 'unity';

export class SessionRoom extends DurableObject<Env> {
  /** Presencia en memoria de los clientes de simulación. No se persiste: es solo indicativa. */
  private clientSeen: Partial<Record<ClientKind, string>> = {};

  private async flush(state: SessionState): Promise<void> {
    if (!state.pendingEvents.length) return;
    await this.env.EVENTS.sendBatch(state.pendingEvents.map(event => ({ body: { tenantId: state.tenantId, sessionId: state.id, event } satisfies EventMessage })));
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
      return Response.json({ state, report: performanceReport(state), clients: this.clientSeen });
    } catch (error) {
      if (error instanceof DomainError) return Response.json({ error: error.message }, { status: 400 });
      console.error(JSON.stringify({ code: 'ROOM_ERROR', message: String(error) }));
      return Response.json({ error: 'Error interno de la sesión.' }, { status: 500 });
    }
  }
}

export function pendingEventCount(state: SessionState): number { return state.pendingEvents.length; }
export type { SimEvent };
