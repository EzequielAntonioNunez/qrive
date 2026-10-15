import type { Env } from './types';

/**
 * Errores del modo IA en vivo con código HTTP y código estable para el cliente (`code`). Mensajes en español.
 * AI_QUOTA: Workers AI ha agotado la asignación (plan gratuito: 10 000 neuronas al día) o limita la cuenta.
 */
export class AiServiceError extends Error {
  constructor(readonly status: 400 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 502 | 503, readonly code: string, message: string) { super(message); }
}

export const AI_QUOTA_MESSAGE = 'Se ha alcanzado el límite diario de IA. Inténtalo más tarde.';
export const AI_UNAVAILABLE_MESSAGE = 'El servicio de IA no está disponible en este momento. Inténtalo de nuevo.';

/** Workers AI señala la cuota agotada con el código 4006 («daily free allocation») o con 429 / límites de capacidad. */
export function isQuotaError(error: unknown): boolean {
  const text = String((error as { message?: unknown })?.message ?? error);
  return /\b(4006|3036|3040)\b|neuron|daily free allocation|quota|rate.?limit|too many requests|\b429\b|capacity/i.test(text);
}

/** Proveedor de todas las llamadas de IA en ejecución (auditoría de IA, §25). */
export const AI_PROVIDER = 'cloudflare-workers-ai';

/** Tipo de llamada para la auditoría: generación de texto, embeddings, intención de voz (Clef)... */
export type AiCallKind = 'generation' | 'embedding' | 'voice-intent' | 'live-intent' | 'other';

/** Tokens de la respuesta de Workers AI si los informa (`usage` estilo OpenAI); solo números, nunca texto. */
export function aiUsage(result: unknown): { promptTokens?: number; completionTokens?: number; totalTokens?: number } {
  const usage = (result as { usage?: Record<string, unknown> } | null)?.usage;
  if (!usage || typeof usage !== 'object') return {};
  const number = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
  const out = { promptTokens: number(usage.prompt_tokens), completionTokens: number(usage.completion_tokens), totalTokens: number(usage.total_tokens) };
  return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
}

/**
 * Línea de log estructurada `AI_CALL` (auditoría de IA): proveedor, modelo, tipo, duración y tokens. `extra` solo
 * admite números, booleanos y cadenas cortas de control (p. ej. el resultado de Clef): nunca la entrada ni la salida.
 */
export function aiCallLog(input: { model: string; kind: AiCallKind; requestId?: string; durationMs: number; result?: unknown; extra?: Record<string, number | boolean | string> }) {
  const extra = Object.fromEntries(Object.entries(input.extra ?? {}).filter(([, value]) => typeof value !== 'string' || /^[\w-]{1,32}$/.test(value)));
  return { code: 'AI_CALL', provider: AI_PROVIDER, model: input.model, kind: input.kind, requestId: input.requestId, durationMs: input.durationMs, ...aiUsage(input.result), ...extra };
}

/** Llama a Workers AI y traduce los fallos a AiServiceError. Nunca registra la entrada (puede llevar texto de documentos). */
export async function runAi(env: Env, model: string, input: unknown, requestId?: string, kind: AiCallKind = 'other'): Promise<unknown> {
  if (!env.AI) throw new AiServiceError(503, 'AI_UNAVAILABLE', 'Workers AI no está configurado en este entorno.');
  const started = Date.now();
  try {
    const result = await env.AI.run(model, input);
    console.log(JSON.stringify(aiCallLog({ model, kind, requestId, durationMs: Date.now() - started, result })));
    return result;
  } catch (error) {
    const quota = isQuotaError(error);
    console.warn(JSON.stringify({ code: quota ? 'AI_QUOTA' : 'AI_CALL_FAILED', provider: AI_PROVIDER, model, kind, requestId, durationMs: Date.now() - started, message: String(error).slice(0, 200) }));
    if (quota) throw new AiServiceError(429, 'AI_QUOTA', AI_QUOTA_MESSAGE);
    throw new AiServiceError(502, 'AI_FAILED', AI_UNAVAILABLE_MESSAGE);
  }
}

/** Ejecuta una tarea en segundo plano tras la respuesta (waitUntil); sin contexto de ejecución (tests), la deja en curso. */
export function inBackground(waitUntil: ((promise: Promise<unknown>) => void) | null, task: () => Promise<unknown>): void {
  const promise = task().catch(error => {
    console.warn(JSON.stringify({ code: 'AI_BACKGROUND_FAILED', message: String((error as Error)?.message ?? error).slice(0, 200) }));
  });
  if (waitUntil) waitUntil(promise);
}
