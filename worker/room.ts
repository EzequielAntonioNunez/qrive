import { DurableObject } from 'cloudflare:workers';
import { applyCommand, createSession, DomainError, type Actor, type Command } from '../shared/engine';
import { performanceReport, type SessionState, type SimEvent } from '../shared/simulation';
import type { Env, EventMessage } from './types';

export class SessionRoom extends DurableObject<Env> {
  private async flush(state: SessionState): Promise<void> {
    if (!state.pendingEvents.length) return;
    await this.env.EVENTS.sendBatch(state.pendingEvents.map(event => ({ body: { tenantId: state.tenantId, sessionId: state.id, event } satisfies EventMessage })));
    state.pendingEvents = [];
    await this.ctx.storage.put('state', state);
  }

  async fetch(request: Request): Promise<Response> {
    try {
      const body = await request.json() as { op: 'create' | 'state' | 'command'; id?: string; tenantId: string; actor: Actor; command?: Command };
      let state = await this.ctx.storage.get<SessionState>('state');
      if (body.op === 'create') {
        if (state) return Response.json({ error: 'La sesión ya existe.' }, { status: 409 });
        state = createSession(body.id!, body.tenantId, body.actor, new Date().toISOString());
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
      try { await this.flush(state); } catch (error) { console.error(JSON.stringify({ code: 'QUEUE_FLUSH_FAILED', sessionId: state.id, message: String(error) })); }
      return Response.json({ state, report: performanceReport(state) });
    } catch (error) {
      if (error instanceof DomainError) return Response.json({ error: error.message }, { status: 400 });
      console.error(JSON.stringify({ code: 'ROOM_ERROR', message: String(error) }));
      return Response.json({ error: 'Error interno de la sesión.' }, { status: 500 });
    }
  }
}

export function pendingEventCount(state: SessionState): number { return state.pendingEvents.length; }
export type { SimEvent };
