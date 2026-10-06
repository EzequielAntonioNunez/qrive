import type { SimEvent } from '../shared/simulation';

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  /** Static assets: solo en el entorno cloud (en local la consola la sirve Vite). */
  ASSETS?: Fetcher;
  SESSIONS: DurableObjectNamespace;
  EVENTS: Queue<EventMessage>;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  /** Propietario inicial: su primer acceso crea la organización (o se une a DEFAULT_TENANT_ID). Debería ser un secreto. */
  BOOTSTRAP_OWNER_EMAIL?: string;
  /** Dominios con autoalta como participante, separados por comas (p. ej. "ufv.es"). Vacío: sin autoalta. */
  ALLOWED_EMAIL_DOMAINS?: string;
  /** Organización de la autoalta. Si falta, la del propietario inicial (ver `organizationTenant` en auth.ts). */
  DEFAULT_TENANT_ID?: string;
  /** "eu" fija los Durable Objects de sesión en la UE. Sin valor (entorno local) no se aplica jurisdicción. */
  SESSIONS_JURISDICTION?: string;
  FEATURE_FLAGS?: string;
  RETENTION_DAYS?: string;
  /** Días que se conserva el registro de auditoría (730 por defecto). */
  AUDIT_RETENTION_DAYS?: string;
  API_LIMITER?: RateLimit;
}

export interface EventMessage {
  tenantId: string;
  sessionId: string;
  event: SimEvent;
}
