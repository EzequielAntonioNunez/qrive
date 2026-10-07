import type { Choice, Scenario } from '../shared/simulation';
import { ANALYTICS_MAX_SESSIONS, isSimulatedActor } from './analytics';
import type { Env } from './types';

/**
 * «Vuestra clase frente a la media» (GET /api/sessions/:id/benchmark). Solo D1, sin Durable Objects: dos consultas
 * (decisiones con su escenario y versiones de escenario) y la agregación en TypeScript.
 *
 * - Solo agregados de grupo: decisiones y tasa de opción óptima de la sesión y del resto de la organización.
 *   Nunca se devuelve un actor ni se ordena a personas; `quality` valora la opción elegida.
 * - `organization` agrega las OTRAS sesiones del tenant (excluida esta) de los últimos 365 días (plazo de retención),
 *   hasta ANALYTICS_MAX_SESSIONS. `sessions` cuenta solo las que tienen alguna decisión valorada.
 * - Participantes simulados (`sim-…`) excluidos salvo `includeSimulated`.
 * - Una tasa sin denominador es `null` (nunca 0 ni NaN). La consola muestra «aún no hay media».
 * - `session` sale de los eventos persistidos: las decisiones llegan por la cola y pueden ir unos segundos por detrás.
 *   El proyector calcula su propia cifra con el estado en vivo (el mismo que pinta) y usa de aquí solo `organization`.
 */

export interface BenchmarkResponse {
  session: { decisions: number; optimalRate: number | null };
  organization: { sessions: number; decisions: number; optimalRate: number | null };
  includeSimulated: boolean;
}

const RANGE_DAYS = 365;

interface DecisionRow { sessionId: string; actorId: string; detail: string; scenarioId: string; scenarioVersion: number }
interface ScenarioRow { id: string; version: number; definition: string }

const ratio = (numerator: number, denominator: number): number | null => denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null;

function parseJson<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** Interpreta `includeSimulated` (true/false/1/0). Devuelve null si el valor no es válido. */
export function parseIncludeSimulated(value: string | undefined): boolean | null {
  const flag = value?.trim().toLowerCase();
  if (flag === undefined || flag === '') return false;
  if (!['true', 'false', '1', '0'].includes(flag)) return null;
  return flag === 'true' || flag === '1';
}

export async function sessionBenchmark(env: Pick<Env, 'DB'>, tenantId: string, sessionId: string, includeSimulated: boolean, now = new Date()): Promise<BenchmarkResponse> {
  const since = new Date(now.getTime() - RANGE_DAYS * 86400000).toISOString();
  // Esta sesión siempre entra (aunque sea antigua); el resto, las más recientes del plazo de retención.
  const picked = `WITH picked AS (SELECT id, scenario_id, scenario_version FROM sessions WHERE tenant_id = ? AND id = ?
    UNION SELECT id, scenario_id, scenario_version FROM (SELECT id, scenario_id, scenario_version FROM sessions
      WHERE tenant_id = ? AND id <> ? AND created_at >= ? ORDER BY created_at DESC LIMIT ${ANALYTICS_MAX_SESSIONS}))`;
  const args = [tenantId, sessionId, tenantId, sessionId, since];
  const [decisions, scenarios] = await Promise.all([
    env.DB.prepare(`${picked} SELECT e.session_id AS sessionId, e.actor_id AS actorId, e.detail_json AS detail,
      p.scenario_id AS scenarioId, p.scenario_version AS scenarioVersion
      FROM simulation_events e JOIN picked p ON p.id = e.session_id
      WHERE e.tenant_id = ? AND e.type = 'decision' ORDER BY e.session_id, e.seq`).bind(...args, tenantId).all<DecisionRow>(),
    env.DB.prepare(`${picked} SELECT sc.id, sc.version, sc.definition_json AS definition FROM scenarios sc
      WHERE (sc.tenant_id IS NULL OR sc.tenant_id = ?)
      AND EXISTS (SELECT 1 FROM picked p WHERE p.scenario_id = sc.id AND p.scenario_version = sc.version)`).bind(...args, tenantId).all<ScenarioRow>()
  ]);

  const definitions = new Map<string, Scenario>();
  for (const row of scenarios.results) {
    const scenario = parseJson<Scenario>(row.definition);
    if (scenario?.phases) definitions.set(`${row.id}@${row.version}`, scenario);
  }

  const own = { best: 0, rated: 0, decisions: 0 };
  const org = { best: 0, rated: 0, decisions: 0, sessions: new Set<string>() };
  const seen = new Set<string>();
  for (const row of decisions.results) {
    if (!includeSimulated && isSimulatedActor(row.actorId)) continue;
    const detail = parseJson<Record<string, unknown>>(row.detail) ?? {};
    if (typeof detail.phaseId !== 'string' || typeof detail.optionId !== 'string') continue;
    // Una decisión por persona y fase: un duplicado en D1 no cuenta dos veces.
    const key = `${row.sessionId}|${row.actorId}|${detail.phaseId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const quality: Choice['quality'] | null = definitions.get(`${row.scenarioId}@${row.scenarioVersion}`)?.phases
      .find(phase => phase.id === detail.phaseId)?.options.find(option => option.id === detail.optionId)?.quality ?? null;
    const target = row.sessionId === sessionId ? own : org;
    target.decisions += 1;
    if (quality === null) continue;
    target.rated += 1;
    if (quality === 'best') target.best += 1;
    if (target === org) org.sessions.add(row.sessionId);
  }

  return {
    session: { decisions: own.decisions, optimalRate: ratio(own.best, own.rated) },
    organization: { sessions: org.sessions.size, decisions: org.decisions, optimalRate: ratio(org.best, org.rated) },
    includeSimulated
  };
}
