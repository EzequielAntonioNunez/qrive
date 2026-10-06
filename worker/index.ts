import { applyRetention, createApp } from './app';
import { queueSafeEvent } from './room';
import type { Env, EventMessage } from './types';

const app = createApp();

/** Eventos que cambian `sessions.status` en D1. Su orden se decide por `seq`, no por el orden de llegada. */
const STATUS_EVENTS = ['paused', 'resumed', 'completed'] as const;
const STATUS_EVENT_LIST = STATUS_EVENTS.map(type => `'${type}'`).join(',');

export type PersistOutcome = 'stored' | 'session-missing';

/**
 * Persiste un mensaje de la cola en D1. Idempotente y tolerante al desorden:
 * - El evento se inserta con INSERT OR IGNORE sobre la clave primaria (session_id, seq): un reintento no duplica.
 * - `paused`/`resumed` solo cambian el estado si no hay ya en D1 una transición de estado con `seq` mayor
 *   (ignora transiciones antiguas que llegan tarde). `completed` es terminal y siempre gana.
 * - Inserción y cambio de estado van en el mismo batch (una transacción de D1).
 * - Si la sesión ya no existe (borrada por RGPD o retención), devuelve 'session-missing' para hacer ack:
 *   reintentar solo chocaría con la clave foránea una y otra vez.
 * El `detail` se vuelve a filtrar por la lista blanca de la cola por si llegan mensajes de una versión anterior.
 */
export async function persistEvent(env: Pick<Env, 'DB'>, body: EventMessage): Promise<PersistOutcome> {
  const { tenantId, sessionId } = body;
  const event = queueSafeEvent(body.event);
  const session = await env.DB.prepare('SELECT status FROM sessions WHERE id = ? AND tenant_id = ?').bind(sessionId, tenantId).first<{ status: string }>();
  if (!session) return 'session-missing';
  const statements = [
    env.DB.prepare('INSERT OR IGNORE INTO simulation_events (tenant_id,session_id,seq,type,at,actor_id,detail_json) VALUES (?,?,?,?,?,?,?)')
      .bind(tenantId, sessionId, event.seq, event.type, event.at, event.actorId, JSON.stringify(event.detail))
  ];
  if (event.type === 'completed') {
    statements.push(env.DB.prepare("UPDATE sessions SET status = 'complete', completed_at = ? WHERE id = ? AND tenant_id = ?")
      .bind(event.at, sessionId, tenantId));
  } else if (event.type === 'paused' || event.type === 'resumed') {
    statements.push(env.DB.prepare(`UPDATE sessions SET status = ? WHERE id = ? AND tenant_id = ? AND status <> 'complete'
      AND NOT EXISTS (SELECT 1 FROM simulation_events WHERE tenant_id = ? AND session_id = ? AND type IN (${STATUS_EVENT_LIST}) AND seq > ?)`)
      .bind(event.type === 'paused' ? 'paused' : 'active', sessionId, tenantId, tenantId, sessionId, event.seq));
  }
  await env.DB.batch(statements);
  return 'stored';
}

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await applyRetention(env);
  },
  async queue(batch: MessageBatch<EventMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { sessionId, event } = message.body;
      try {
        const outcome = await persistEvent(env, message.body);
        if (outcome === 'session-missing') console.warn(JSON.stringify({ code: 'EVENT_SESSION_MISSING', sessionId, seq: event.seq }));
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ code: 'EVENT_PERSIST_FAILED', sessionId, seq: event.seq, message: String(error) }));
        message.retry();
      }
    }
  }
};

export { SessionRoom } from './room';
