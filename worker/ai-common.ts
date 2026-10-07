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

/** Llama a Workers AI y traduce los fallos a AiServiceError. Nunca registra la entrada (puede llevar texto de documentos). */
export async function runAi(env: Env, model: string, input: unknown, requestId?: string): Promise<unknown> {
  if (!env.AI) throw new AiServiceError(503, 'AI_UNAVAILABLE', 'Workers AI no está configurado en este entorno.');
  const started = Date.now();
  try {
    const result = await env.AI.run(model, input);
    console.log(JSON.stringify({ code: 'AI_CALL', model, requestId, durationMs: Date.now() - started }));
    return result;
  } catch (error) {
    const quota = isQuotaError(error);
    console.warn(JSON.stringify({ code: quota ? 'AI_QUOTA' : 'AI_CALL_FAILED', model, requestId, durationMs: Date.now() - started, message: String(error).slice(0, 200) }));
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
