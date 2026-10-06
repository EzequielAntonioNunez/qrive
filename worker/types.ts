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
  VOICE_LIMITER?: RateLimit;
  /** Workers AI: modelo de decisión Clef para interpretar la respuesta libre por voz. */
  AI?: { run(model: string, input: unknown): Promise<unknown> };
  AUTH_LIMITER?: RateLimit;
  AUTH_IP_LIMITER?: RateLimit;
  ACCESS_CODE_PEPPER?: string;
  /** Clave (secreto) del proyecto Soniox para la voz del simulador web. Nunca se envía al navegador. */
  SONIOX_API_KEY?: string;
  /** Región del proyecto Soniox de SONIOX_API_KEY: «eu» (por defecto) o «us» (transferencia internacional, avisada al participante). */
  SONIOX_REGION?: string;
  /** Solo en `wrangler dev` (createApp(true)): pruebas locales con proyecto Soniox global. */
  SONIOX_TEST_API_KEY?: string;
  /** Solo durante la transición: permite JWT de Access. En producción se omite. */
  LEGACY_ACCESS_AUTH?: string;
}

export interface EventMessage {
  tenantId: string;
  sessionId: string;
  event: SimEvent;
}
