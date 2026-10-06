import { applyChoice, defaultMeterLabels, type Choice, type MeterName, type Meters, type Scenario } from '../shared/simulation';
import type { Env } from './types';

/**
 * Analítica agregada de la organización (GET /api/analytics). Solo D1, sin Durable Objects: tres consultas
 * (sesiones, eventos y versiones de escenario) y la agregación en TypeScript.
 *
 * Reglas:
 * - Todo filtra por `tenant_id`; no hay caché entre peticiones ni entre organizaciones.
 * - Solo agregados: nunca se devuelve un actor ni se ordena o etiqueta a personas. `quality` valora la opción elegida.
 * - Una tasa sin denominador es `null` (la consola muestra «Sin datos aún»), nunca 0 ni NaN.
 * - Participantes simulados (`sim-…`): excluidos de decisiones, tasas e indicadores salvo `includeSimulated`.
 */

export const ANALYTICS_MAX_SESSIONS = 2000;
const TREND_WEEKS = 12;
const DEFAULT_RANGE_DAYS = 365;
const DAY_MS = 86400000;
const METERS: MeterName[] = ['relationship', 'margin', 'risk'];

export class AnalyticsQueryError extends Error {}

export interface AnalyticsQuery { from: string; to: string; scenarioId: string | null; includeSimulated: boolean }

export interface OptionShare { optionId: string; label: string; quality: Choice['quality'] | null; count: number; share: number }

export interface AnalyticsResponse {
  range: { from: string; to: string };
  totals: {
    sessions: number; sessionsCompleted: number; sessionsActive: number;
    participants: number; simulatedParticipants: number; decisions: number;
    completionRate: number | null; optimalRate: number | null; avgDecisionSeconds: number | null;
  };
  trend: { week: string; sessions: number; participants: number; decisions: number; optimalRate: number | null }[];
  scenarios: { scenarioId: string; title: string; sessions: number; participants: number; decisions: number; optimalRate: number | null; completionRate: number | null }[];
  phases: {
    scenarioId: string; scenarioTitle: string; phaseId: string; phaseTitle: string; decisions: number; optimalRate: number | null;
    distribution: OptionShare[]; mostChosenNonOptimal: { optionId: string; label: string; share: number } | null;
  }[];
  meters: { scenarioId: string; meter: MeterName; label: string; avgStart: number; avgEnd: number; delta: number }[];
  recentSessions: { id: string; name: string | null; scenarioTitle: string; status: string; createdAt: string; participants: number; optimalRate: number | null }[];
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | undefined, field: 'from' | 'to'): string | null {
  if (value === undefined || value === '') return null;
  const text = value.trim();
  const date = DATE_ONLY.test(text) ? new Date(`${text}T${field === 'from' ? '00:00:00.000' : '23:59:59.999'}Z`) : new Date(text);
  if (text.length > 40 || Number.isNaN(date.getTime())) throw new AnalyticsQueryError(`Fecha no válida en «${field}». Usa el formato ISO (AAAA-MM-DD).`);
  return date.toISOString();
}

/**
 * Filtros de la consulta. `from`/`to` son ISO; una fecha sin hora cubre el día completo (UTC) y el rango es inclusivo.
 * Sin `to`, ahora; sin `from`, 365 días antes de `to` (el plazo de retención de sesiones).
 */
export function parseAnalyticsQuery(params: Record<string, string | undefined>, now = new Date()): AnalyticsQuery {
  const to = parseDate(params.to, 'to') ?? now.toISOString();
  const from = parseDate(params.from, 'from') ?? new Date(Date.parse(to) - DEFAULT_RANGE_DAYS * DAY_MS).toISOString();
  if (Date.parse(from) > Date.parse(to)) throw new AnalyticsQueryError('«from» debe ser anterior a «to».');
  const scenarioId = params.scenarioId?.trim() || null;
  if (scenarioId !== null && (scenarioId.length > 100 || !/^[\w.-]+$/.test(scenarioId))) throw new AnalyticsQueryError('Escenario no válido.');
  const flag = params.includeSimulated?.trim().toLowerCase();
  if (flag !== undefined && flag !== '' && !['true', 'false', '1', '0'].includes(flag)) throw new AnalyticsQueryError('«includeSimulated» debe ser true o false.');
  return { from, to, scenarioId, includeSimulated: flag === 'true' || flag === '1' };
}

interface SessionDbRow { id: string; name: string | null; scenarioId: string; scenarioVersion: number; status: string; createdAt: string }
interface EventDbRow { sessionId: string; seq: number; type: string; at: string; actorId: string; detail: string }
interface ScenarioDbRow { id: string; version: number; title: string; definition: string }

export const isSimulatedActor = (actorId: string) => actorId.startsWith('sim-');

const ratio = (numerator: number, denominator: number): number | null => denominator > 0 ? Math.round((numerator / denominator) * 1000) / 1000 : null;
const round1 = (value: number) => Math.round(value * 10) / 10;

function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** Lunes (UTC) de la semana ISO de una fecha, como AAAA-MM-DD. */
export function isoWeekStart(iso: string): string {
  const date = new Date(iso);
  const day = (date.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day)).toISOString().slice(0, 10);
}

function parseJson<T>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { return null; }
}

/** Una decisión reconstruida desde el evento `decision` (detail: phaseId, optionId, durationMs). */
interface DecisionFact { actorId: string; phaseId: string; optionId: string; durationMs: number | null; quality: Choice['quality'] | null }

interface SessionFacts {
  row: SessionDbRow;
  scenario: Scenario | null;
  week: string;
  /** Participantes incluidos (según includeSimulated), por orden de unión. */
  participants: Set<string>;
  simulated: Set<string>;
  decisions: DecisionFact[];
  /** Indicadores finales por participante incluido (reproducción de los eventos); solo con escenario conocido. */
  finalMeters: Map<string, Meters>;
}

/**
 * Reproduce los indicadores de cada participante con los eventos persistidos, igual que `applyCommand`:
 * unión con los iniciales, decisión con los efectos de la opción, incidente y vencimiento (riesgo) y ajuste manual.
 */
function replay(scenario: Scenario, events: EventDbRow[]): Map<string, Meters> {
  const meters = new Map<string, Meters>();
  const decided = new Set<string>();
  const clamp = (value: number) => Math.max(0, Math.min(100, value));
  for (const event of events) {
    const detail = parseJson<Record<string, unknown>>(event.detail) ?? {};
    if (event.type === 'participant_joined') {
      if (!meters.has(event.actorId)) meters.set(event.actorId, { ...scenario.initialMeters });
    } else if (event.type === 'decision') {
      const option = scenario.phases.find(phase => phase.id === detail.phaseId)?.options.find(item => item.id === detail.optionId);
      const current = meters.get(event.actorId);
      if (option && current) meters.set(event.actorId, applyChoice(current, option));
      decided.add(`${event.actorId}|${String(detail.phaseId)}`);
    } else if (event.type === 'incident' && typeof detail.riskDelta === 'number') {
      for (const [id, value] of meters) meters.set(id, { ...value, risk: clamp(value.risk + (detail.riskDelta as number)) });
    } else if (event.type === 'timer_expired' && typeof detail.riskDelta === 'number') {
      for (const [id, value] of meters) {
        if (!decided.has(`${id}|${String(detail.phaseId)}`)) meters.set(id, { ...value, risk: clamp(value.risk + (detail.riskDelta as number)) });
      }
    } else if (event.type === 'meter_changed' && METERS.includes(detail.meter as MeterName) && typeof detail.value === 'number') {
      for (const [id, value] of meters) meters.set(id, { ...value, [detail.meter as MeterName]: detail.value as number });
    }
  }
  return meters;
}

export async function organizationAnalytics(env: Pick<Env, 'DB'>, tenantId: string, query: AnalyticsQuery): Promise<AnalyticsResponse> {
  const filters = ['s.tenant_id = ?', 's.created_at >= ?', 's.created_at <= ?'];
  const args: unknown[] = [tenantId, query.from, query.to];
  if (query.scenarioId) { filters.push('s.scenario_id = ?'); args.push(query.scenarioId); }
  const picked = `WITH picked AS (SELECT s.id, s.scenario_id, s.scenario_version FROM sessions s WHERE ${filters.join(' AND ')}
    ORDER BY s.created_at DESC LIMIT ${ANALYTICS_MAX_SESSIONS})`;
  const [sessions, events, scenarios] = await Promise.all([
    env.DB.prepare(`SELECT s.id, s.name, s.scenario_id AS scenarioId, s.scenario_version AS scenarioVersion, s.status, s.created_at AS createdAt
      FROM sessions s WHERE ${filters.join(' AND ')} ORDER BY s.created_at DESC LIMIT ${ANALYTICS_MAX_SESSIONS}`).bind(...args).all<SessionDbRow>(),
    env.DB.prepare(`${picked} SELECT e.session_id AS sessionId, e.seq, e.type, e.at, e.actor_id AS actorId, e.detail_json AS detail
      FROM simulation_events e WHERE e.tenant_id = ? AND e.session_id IN (SELECT id FROM picked)
      AND e.type IN ('participant_joined','decision','incident','timer_expired','meter_changed')
      ORDER BY e.session_id, e.seq`).bind(...args, tenantId).all<EventDbRow>(),
    env.DB.prepare(`${picked} SELECT sc.id, sc.version, sc.title, sc.definition_json AS definition FROM scenarios sc
      WHERE (sc.tenant_id IS NULL OR sc.tenant_id = ?)
      AND EXISTS (SELECT 1 FROM picked p WHERE p.scenario_id = sc.id AND p.scenario_version = sc.version)`).bind(...args, tenantId).all<ScenarioDbRow>()
  ]);

  const definitions = new Map<string, Scenario>();
  for (const row of scenarios.results) {
    const scenario = parseJson<Scenario>(row.definition);
    if (scenario?.phases) definitions.set(`${row.id}@${row.version}`, scenario);
  }
  const eventsBySession = new Map<string, EventDbRow[]>();
  for (const event of events.results) {
    const list = eventsBySession.get(event.sessionId) ?? [];
    list.push(event);
    eventsBySession.set(event.sessionId, list);
  }

  const included = (actorId: string) => query.includeSimulated || !isSimulatedActor(actorId);
  const facts: SessionFacts[] = sessions.results.map(row => {
    const scenario = definitions.get(`${row.scenarioId}@${row.scenarioVersion}`) ?? null;
    const list = eventsBySession.get(row.id) ?? [];
    const participants = new Set<string>();
    const simulated = new Set<string>();
    const decisions: DecisionFact[] = [];
    const seen = new Set<string>();
    for (const event of list) {
      if (event.type === 'participant_joined') {
        if (isSimulatedActor(event.actorId)) simulated.add(event.actorId);
        if (included(event.actorId)) participants.add(event.actorId);
      } else if (event.type === 'decision' && included(event.actorId)) {
        const detail = parseJson<Record<string, unknown>>(event.detail) ?? {};
        if (typeof detail.phaseId !== 'string' || typeof detail.optionId !== 'string') continue;
        // El motor admite una decisión por persona y fase; un duplicado en D1 no cuenta dos veces.
        const key = `${event.actorId}|${detail.phaseId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const option = scenario?.phases.find(phase => phase.id === detail.phaseId)?.options.find(item => item.id === detail.optionId);
        decisions.push({
          actorId: event.actorId, phaseId: detail.phaseId, optionId: detail.optionId,
          durationMs: typeof detail.durationMs === 'number' && Number.isFinite(detail.durationMs) && detail.durationMs >= 0 ? detail.durationMs : null,
          quality: option?.quality ?? null
        });
      }
    }
    const finalMeters = new Map<string, Meters>();
    if (scenario && row.status === 'complete') {
      for (const [id, meters] of replay(scenario, list)) if (participants.has(id)) finalMeters.set(id, meters);
    }
    return { row, scenario, week: isoWeekStart(row.createdAt), participants, simulated, decisions, finalMeters };
  });

  const optimal = (list: DecisionFact[]) => ratio(list.filter(item => item.quality === 'best').length, list.filter(item => item.quality !== null).length);
  /** Participantes de sesiones finalizadas que decidieron en todas las fases / participantes de sesiones finalizadas. */
  const completion = (list: SessionFacts[]) => {
    let done = 0, total = 0;
    for (const fact of list) {
      if (fact.row.status !== 'complete' || !fact.scenario) continue;
      const phaseIds = fact.scenario.phases.map(phase => phase.id);
      for (const actor of fact.participants) {
        total += 1;
        const decided = new Set(fact.decisions.filter(item => item.actorId === actor).map(item => item.phaseId));
        if (phaseIds.every(id => decided.has(id))) done += 1;
      }
    }
    return ratio(done, total);
  };
  const distinct = (list: SessionFacts[], pick: (fact: SessionFacts) => Iterable<string>) => {
    const set = new Set<string>();
    for (const fact of list) for (const id of pick(fact)) set.add(id);
    return set.size;
  };
  const allDecisions = facts.flatMap(fact => fact.decisions);
  const durations = allDecisions.flatMap(item => item.durationMs === null ? [] : [item.durationMs]);
  const medianMs = median(durations);

  const totals: AnalyticsResponse['totals'] = {
    sessions: facts.length,
    sessionsCompleted: facts.filter(fact => fact.row.status === 'complete').length,
    sessionsActive: facts.filter(fact => fact.row.status !== 'complete').length,
    participants: distinct(facts, fact => [...fact.participants].filter(id => !isSimulatedActor(id))),
    simulatedParticipants: distinct(facts, fact => fact.simulated),
    decisions: allDecisions.length,
    completionRate: completion(facts),
    optimalRate: optimal(allDecisions),
    avgDecisionSeconds: medianMs === null ? null : round1(medianMs / 1000)
  };

  // Tendencia: hasta 12 semanas ISO (lunes UTC) que acaban en la semana de `to`, sin pasar de la de `from`; con ceros.
  const lastWeek = isoWeekStart(query.to);
  const firstWeek = isoWeekStart(query.from);
  const weeks: string[] = [];
  for (let index = TREND_WEEKS - 1; index >= 0; index--) {
    const week = new Date(Date.parse(`${lastWeek}T00:00:00.000Z`) - index * 7 * DAY_MS).toISOString().slice(0, 10);
    if (week >= firstWeek) weeks.push(week);
  }
  const trend = weeks.map(week => {
    const list = facts.filter(fact => fact.week === week);
    const decisions = list.flatMap(fact => fact.decisions);
    return { week, sessions: list.length, participants: distinct(list, fact => fact.participants), decisions: decisions.length, optimalRate: optimal(decisions) };
  });

  // Por escenario. El título y los textos de las fases salen de la versión más reciente usada en el rango.
  const byScenario = new Map<string, SessionFacts[]>();
  for (const fact of facts) byScenario.set(fact.row.scenarioId, [...(byScenario.get(fact.row.scenarioId) ?? []), fact]);
  const latestDefinition = (list: SessionFacts[]) => list.filter(fact => fact.scenario)
    .sort((a, b) => b.row.scenarioVersion - a.row.scenarioVersion)[0]?.scenario ?? null;
  const titleOf = (scenarioId: string, list: SessionFacts[]) => latestDefinition(list)?.title ?? scenarioId;

  const scenarioRows: AnalyticsResponse['scenarios'] = [...byScenario].map(([scenarioId, list]) => {
    const decisions = list.flatMap(fact => fact.decisions);
    return { scenarioId, title: titleOf(scenarioId, list), sessions: list.length, participants: distinct(list, fact => fact.participants),
      decisions: decisions.length, optimalRate: optimal(decisions), completionRate: completion(list) };
  }).sort((a, b) => b.sessions - a.sessions || a.title.localeCompare(b.title, 'es'));

  // Fases: reparto de opciones; primero las de menor tasa de opción óptima («dónde más se equivoca la clase»).
  const phases: AnalyticsResponse['phases'] = [];
  for (const [scenarioId, list] of byScenario) {
    const latest = latestDefinition(list);
    const scenarioTitle = titleOf(scenarioId, list);
    const phaseIds = new Set<string>([...(latest?.phases.map(phase => phase.id) ?? []), ...list.flatMap(fact => fact.decisions.map(item => item.phaseId))]);
    for (const phaseId of phaseIds) {
      const decisions = list.flatMap(fact => fact.decisions.filter(item => item.phaseId === phaseId).map(item => ({ item, scenario: fact.scenario })));
      if (!decisions.length) continue;
      const latestPhase = latest?.phases.find(phase => phase.id === phaseId);
      const options = new Map<string, { label: string; quality: Choice['quality'] | null; count: number }>();
      for (const option of latestPhase?.options ?? []) options.set(option.id, { label: option.label, quality: option.quality ?? null, count: 0 });
      for (const { item, scenario } of decisions) {
        if (!options.has(item.optionId)) {
          const option = scenario?.phases.find(phase => phase.id === phaseId)?.options.find(entry => entry.id === item.optionId);
          options.set(item.optionId, { label: option?.label ?? item.optionId, quality: option?.quality ?? null, count: 0 });
        }
        options.get(item.optionId)!.count += 1;
      }
      const total = decisions.length;
      const distribution: OptionShare[] = [...options].map(([optionId, option]) => ({
        optionId, label: option.label, quality: option.quality, count: option.count, share: ratio(option.count, total) ?? 0
      }));
      const rated = decisions.some(({ item }) => item.quality !== null);
      const wrong = distribution.filter(option => option.count > 0 && option.quality !== null && option.quality !== 'best')
        .sort((a, b) => b.count - a.count)[0];
      phases.push({
        scenarioId, scenarioTitle, phaseId, phaseTitle: latestPhase?.title ?? phaseId, decisions: total,
        optimalRate: optimal(decisions.map(({ item }) => item)), distribution,
        mostChosenNonOptimal: rated && wrong ? { optionId: wrong.optionId, label: wrong.label, share: wrong.share } : null
      });
    }
  }
  phases.sort((a, b) => (a.optimalRate ?? 2) - (b.optimalRate ?? 2) || b.decisions - a.decisions);

  // Indicadores: media de la clase al empezar (iniciales) y al terminar (sesiones finalizadas), por escenario.
  const meters: AnalyticsResponse['meters'] = [];
  for (const [scenarioId, list] of byScenario) {
    const labels = latestDefinition(list)?.meterLabels ?? defaultMeterLabels;
    const pairs = list.flatMap(fact => fact.scenario ? [...fact.finalMeters.values()].map(end => ({ start: fact.scenario!.initialMeters, end })) : []);
    if (!pairs.length) continue;
    for (const meter of METERS) {
      const avgStart = round1(pairs.reduce((sum, pair) => sum + pair.start[meter], 0) / pairs.length);
      const avgEnd = round1(pairs.reduce((sum, pair) => sum + pair.end[meter], 0) / pairs.length);
      meters.push({ scenarioId, meter, label: labels[meter], avgStart, avgEnd, delta: round1(avgEnd - avgStart) });
    }
  }

  const recentSessions = facts.slice(0, 8).map(fact => ({
    id: fact.row.id, name: fact.row.name ?? null, scenarioTitle: fact.scenario?.title ?? fact.row.scenarioId,
    status: fact.row.status, createdAt: fact.row.createdAt, participants: fact.participants.size, optimalRate: optimal(fact.decisions)
  }));

  return { range: { from: query.from, to: query.to }, totals, trend, scenarios: scenarioRows, phases, meters, recentSessions };
}
