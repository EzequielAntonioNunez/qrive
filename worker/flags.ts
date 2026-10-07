import type { Env } from './types';

/**
 * Feature flags por entorno. Se configuran en la variable FEATURE_FLAGS como JSON,
 * p. ej. {"ai_characters": false}. Un flag desconocido o mal formado se considera desactivado.
 */
export type FeatureFlag = 'ai_characters' | 'realtime_websocket' | 'phase_timers' | 'ai_live_demo';

/** ai_live_demo: «Modo IA en vivo (demo)», solo instructores (worker/ai-routes.ts). Desactivado salvo que se active. */
const defaults: Record<FeatureFlag, boolean> = { ai_characters: false, realtime_websocket: true, phase_timers: true, ai_live_demo: false };

export function flags(env: Pick<Env, 'FEATURE_FLAGS'>): Record<FeatureFlag, boolean> {
  let overrides: Record<string, unknown> = {};
  try { overrides = env.FEATURE_FLAGS ? JSON.parse(env.FEATURE_FLAGS) : {}; } catch { console.warn(JSON.stringify({ code: 'FEATURE_FLAGS_INVALID' })); }
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as FeatureFlag[]) if (typeof overrides[key] === 'boolean') result[key] = overrides[key] as boolean;
  return result;
}
