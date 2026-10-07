import { queueSafeEvent } from './room';
import { completionStatements } from './guests';
import type { Env, EventMessage } from './types';

/** Eventos que cambian `sessions.status` en D1. Su orden se decide por `seq`, no por el orden de llegada. */
const STATUS_EVENTS = ['paused', 'resumed', 'completed'] as const;
const STATUS_EVENT_LIST = STATUS_EVENTS.map(type => `'${type}'`).join(',');

export type PersistOutcome = 'stored' | 'session-missing';

/**
 * Persiste un evento de sesión en D1 (consumidor de la cola y, para los comandos del instructor, la propia API,
 * para que el listado refleje el estado sin esperar a la cola). Idempotente y tolerante al desorden:
 * - El evento se inserta con INSERT OR IGNORE sobre la clave primaria (session_id, seq): un reintento no duplica.
 * - `paused`/`resumed` solo cambian el estado si no hay ya en D1 una transición de estado con `seq` mayor
 *   (ignora transiciones antiguas que llegan tarde). `completed` es terminal y siempre gana.
 * - Inserción y cambio de estado van en el mismo batch (una transacción de D1).
 * - Si la sesión ya no existe (borrada por RGPD o retención), devuelve 'session-missing' para hacer ack:
 *   reintentar solo chocaría con la clave foránea una y otra vez.
 * - `participant_removed` borra los eventos anteriores de esa persona en la sesión, y ningún evento suyo anterior
 *   a la retirada se vuelve a insertar aunque llegue después (supresión por persona).
 * El `detail` se vuelve a filtrar por la lista blanca de la cola por si llegan mensajes de una versión anterior.
 */
export async function persistEvent(env: Pick<Env, 'DB'>, body: EventMessage): Promise<PersistOutcome> {
  const { tenantId, sessionId } = body;
  const event = queueSafeEvent(body.event);
  const session = await env.DB.prepare('SELECT status FROM sessions WHERE id = ? AND tenant_id = ?').bind(sessionId, tenantId).first<{ status: string }>();
  if (!session) return 'session-missing';
  const statements = [
    // Supresión por persona: un evento de alguien ya retirado (con seq anterior a su retirada) que llega tarde por la
    // cola no vuelve a entrar en D1.
    env.DB.prepare(`INSERT OR IGNORE INTO simulation_events (tenant_id,session_id,seq,type,at,actor_id,detail_json) SELECT ?,?,?,?,?,?,?
      WHERE NOT EXISTS (SELECT 1 FROM simulation_events WHERE tenant_id = ? AND session_id = ? AND type = 'participant_removed'
        AND json_extract(detail_json, '$.participantId') = ? AND seq > ?)`)
      .bind(tenantId, sessionId, event.seq, event.type, event.at, event.actorId, JSON.stringify(event.detail), tenantId, sessionId, event.actorId, event.seq)
  ];
  if (event.type === 'participant_removed' && typeof event.detail.participantId === 'string') {
    // RGPD: se borran de D1 la unión y las decisiones de esa persona en la sesión (los eventos son suyos: actor_id).
    statements.push(env.DB.prepare('DELETE FROM simulation_events WHERE tenant_id = ? AND session_id = ? AND actor_id = ? AND seq < ?')
      .bind(tenantId, sessionId, event.detail.participantId, event.seq));
  }
  if (event.type === 'completed') {
    statements.push(env.DB.prepare("UPDATE sessions SET status = 'complete', completed_at = ? WHERE id = ? AND tenant_id = ?")
      .bind(event.at, sessionId, tenantId));
    // Acceso invitado: el PIN deja de valer y los invitados solo conservan un margen para leer su informe.
    statements.push(...completionStatements(env, tenantId, sessionId, event.at));
  } else if (event.type === 'paused' || event.type === 'resumed') {
    statements.push(env.DB.prepare(`UPDATE sessions SET status = ? WHERE id = ? AND tenant_id = ? AND status <> 'complete'
      AND NOT EXISTS (SELECT 1 FROM simulation_events WHERE tenant_id = ? AND session_id = ? AND type IN (${STATUS_EVENT_LIST}) AND seq > ?)`)
      .bind(event.type === 'paused' ? 'paused' : 'active', sessionId, tenantId, tenantId, sessionId, event.seq));
  }
  await env.DB.batch(statements);
  return 'stored';
}
