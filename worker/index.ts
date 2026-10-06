import { applyRetention, createApp } from './app';
import { persistEvent } from './persist';
import type { Env, EventMessage } from './types';

// La persistencia de eventos (y el estado de la sesión en D1) vive en persist.ts: la usan la cola y la API.
export { persistEvent, type PersistOutcome } from './persist';

const app = createApp();

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
