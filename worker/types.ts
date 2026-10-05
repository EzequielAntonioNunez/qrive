import type { SimEvent } from '../shared/simulation';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  SESSIONS: DurableObjectNamespace;
  EVENTS: Queue<EventMessage>;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  BOOTSTRAP_OWNER_EMAIL?: string;
}

export interface EventMessage {
  tenantId: string;
  sessionId: string;
  event: SimEvent;
}
