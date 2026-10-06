import type { Phase } from '../shared/simulation';

/** Modelo de decisión de Workers AI: devuelve probabilidades sobre opciones cerradas, nunca texto libre. */
export const CLEF_MODEL = '@cf/cloudflare/clef-flash';
/**
 * Umbrales sobre la probabilidad de la opción y la `confidence` global de Clef (ambas deben superarlos).
 * Probado en producción: frases fuera de tema («¿Qué hora es?») salían con probabilidad 0,78 pero confidence 0,54;
 * respuestas claras dan ambas por encima de 0,9.
 */
export const DECIDE_THRESHOLD = 0.75;
export const CONFIRM_THRESHOLD = 0.45;
export const CONFIRM_CONFIDENCE = 0.6;
export const MAX_PHRASE_LENGTH = 300;
const NONE = 'ninguna';

export type VoiceIntent =
  | { kind: 'decide' | 'confirm'; option: number; confidence: number }
  | { kind: 'unclear'; confidence: number };

/** Petición a Clef: la situación y las opciones que ve el participante, más su frase. Sin identidad ni datos de compañeros. */
export function clefRequest(phase: Pick<Phase, 'title' | 'briefing' | 'options'>, phrase: string) {
  const criteria: Record<string, string> = {};
  phase.options.forEach((option, index) => { criteria[`opcion_${index + 1}`] = option.label; });
  criteria[NONE] = 'La frase no corresponde claramente a ninguna de las opciones: pregunta otra cosa, duda, mezcla varias opciones o no tiene relación.';
  return {
    model: 'clef-flash',
    state: JSON.stringify({ situacion: phase.title, contexto: phase.briefing, respuesta_del_participante: phrase }),
    questions: {
      opcion: {
        type: 'choice',
        instructions: 'Un participante de una formación responde en voz alta qué haría en esta situación. ¿Qué opción describe su respuesta? Elige «ninguna» si no está claro.',
        criteria
      }
    }
  };
}

/** Traduce la respuesta de Clef a una intención. Cualquier forma inesperada se trata como «no entendido». */
export function interpretClef(result: unknown, optionCount: number): VoiceIntent {
  const answer = (result as { answers?: { opcion?: { choice?: unknown; probabilities?: Record<string, unknown>; confidence?: unknown } } } | null)?.answers?.opcion;
  const choice = typeof answer?.choice === 'string' ? answer.choice : '';
  const clamp = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
  const probability = clamp(answer?.probabilities?.[choice]);
  // Sin `confidence` (versiones anteriores de la respuesta) se usa solo la probabilidad.
  const certainty = answer?.confidence === undefined ? probability : clamp(answer.confidence);
  const confidence = Math.min(probability, certainty);
  const match = /^opcion_(\d)$/.exec(choice);
  const option = match ? Number(match[1]) - 1 : -1;
  if (option < 0 || option >= optionCount || probability < CONFIRM_THRESHOLD || certainty < CONFIRM_CONFIDENCE) return { kind: 'unclear', confidence };
  return { kind: confidence >= DECIDE_THRESHOLD ? 'decide' : 'confirm', option, confidence };
}
