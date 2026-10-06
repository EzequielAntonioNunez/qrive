import { applyRetention, createApp } from './app';
import type { Env, EventMessage } from './types';

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    await applyRetention(env);
  },
  async queue(batch: MessageBatch<EventMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const { tenantId, sessionId, event } = message.body;
      try {
        await env.DB.prepare('INSERT OR IGNORE INTO simulation_events (tenant_id,session_id,seq,type,at,actor_id,detail_json) VALUES (?,?,?,?,?,?,?)')
          .bind(tenantId, sessionId, event.seq, event.type, event.at, event.actorId, JSON.stringify(event.detail)).run();
        if (event.type === 'completed') {
          await env.DB.prepare('UPDATE sessions SET status = ?, completed_at = ? WHERE id = ? AND tenant_id = ?')
            .bind('complete', event.at, sessionId, tenantId).run();
        } else if (event.type === 'paused' || event.type === 'resumed') {
          await env.DB.prepare("UPDATE sessions SET status = ? WHERE id = ? AND tenant_id = ? AND status <> 'complete'")
            .bind(event.type === 'paused' ? 'paused' : 'active', sessionId, tenantId).run();
        }
        message.ack();
      } catch (error) {
        console.error(JSON.stringify({ code: 'EVENT_PERSIST_FAILED', sessionId, seq: event.seq, message: String(error) }));
        message.retry();
      }
    }
  }
};

export { SessionRoom } from './room';
