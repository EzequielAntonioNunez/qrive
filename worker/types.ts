import type { SimEvent } from '../shared/simulation';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  SESSIONS: DurableObjectNamespace;
  EVENTS: Queue<EventMessage>;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  BOOTSTRAP_OWNER_EMAIL?: string;
  FEATURE_FLAGS?: string;
  RETENTION_DAYS?: string;
  API_LIMITER?: RateLimit;
}

export interface EventMessage {
  tenantId: string;
  sessionId: string;
  event: SimEvent;
}
