import { applyCommand, DomainError, type Actor } from '../shared/engine';
import { classMeters, normalizeState, type Choice, type ChoiceQuality, type Phase, type SessionState, type SimEvent } from '../shared/simulation';

/**
 * Clase simulada para demostraciones: participantes ficticios que deciden solos en cada fase.
 * - No son usuarios ni membresías: solo existen en el estado del Durable Object, con IDs seudónimos
 *   `sim-<8 primeros caracteres de la sesión>-NN` y el nombre «Participante simulado NN».
 * - Se marcan con `simulated: true` en `participants` y en `participantReports` para etiquetarlos o excluirlos.
 * - Unión y decisiones pasan por `applyCommand`, igual que las de una persona: indicadores, informes y eventos
 *   (con IDs seudónimos) son coherentes.
 */
export const MAX_SIMULATED = 40;
export const DEFAULT_SIMULATED = 20;
/** Retardo de cada decisión simulada desde el inicio de la fase (o desde que se añade el participante). */
export const BOT_MIN_DELAY_MS = 2000;
export const BOT_MAX_DELAY_MS = 12000;
/** Reparto de las decisiones simuladas por valoración de la opción: mejor 45 %, aceptable 35 %, mala 20 %. */
export const QUALITY_WEIGHTS: Record<ChoiceQuality, number> = { best: 0.45, acceptable: 0.35, poor: 0.2 };

export interface BotTask { userId: string; phaseId: string; dueAt: number }
export type Rng = () => number;

/** Recuento en vivo de la fase activa (solo para el instructor: revela las decisiones de los compañeros). */
export interface LiveTally { phaseId: string; counts: number[]; decided: number; total: number }

export function simulatedPrefix(sessionId: string): string {
  return `sim-${sessionId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 8)}-`;
}

export function isSimulated(state: Pick<SessionState, 'participants'>, userId: string): boolean {
  return state.participants.some(person => person.userId === userId && person.simulated === true);
}

export function liveTally(state: SessionState): LiveTally {
  const phase = state.scenario.phases[state.phaseIndex];
  const counts = phase.options.map(() => 0);
  const joined = new Set(state.participants.map(person => person.userId));
  let decided = 0;
  for (const decision of state.decisions) {
    if (decision.phaseId !== phase.id || !joined.has(decision.userId)) continue;
    const index = phase.options.findIndex(option => option.id === decision.optionId);
    if (index >= 0) counts[index] += 1;
    decided += 1;
  }
  return { phaseId: phase.id, counts, decided, total: state.participants.length };
}

/**
 * Opción de un participante simulado: primero la valoración (mejor 45 %, aceptable 35 %, mala 20 %, repartiendo
 * el peso de las valoraciones que la fase no tenga) y después una opción al azar con esa valoración.
 * Si la fase no valora sus opciones, cualquiera con la misma probabilidad.
 */
export function pickOption(phase: Phase, rng: Rng = Math.random): Choice {
  const groups = (Object.keys(QUALITY_WEIGHTS) as ChoiceQuality[])
    .map(quality => ({ weight: QUALITY_WEIGHTS[quality], options: phase.options.filter(option => option.quality === quality) }))
    .filter(group => group.options.length > 0);
  const pick = <T>(items: T[]) => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
  if (!groups.length) return pick(phase.options);
  const total = groups.reduce((sum, group) => sum + group.weight, 0);
  let roll = rng() * total;
  for (const group of groups) {
    if (roll < group.weight) return pick(group.options);
    roll -= group.weight;
  }
  return pick(groups[groups.length - 1].options);
}

/**
 * Añade `count` participantes simulados por la misma vía que una unión real. La numeración continúa desde el mayor
 * número usado en la sesión (incluidos los ya retirados) para no reutilizar IDs con eventos anteriores.
 */
export function addSimulated(current: SessionState, count: number, at: string): { state: SessionState; events: SimEvent[]; added: string[] } {
  let state = normalizeState(current);
  if (state.status === 'complete') throw new DomainError('La sesión ya terminó.');
  const active = state.participants.filter(person => person.simulated).length;
  if (!Number.isInteger(count) || count < 1 || count > MAX_SIMULATED) throw new DomainError(`Indica entre 1 y ${MAX_SIMULATED} participantes simulados.`);
  if (active + count > MAX_SIMULATED) throw new DomainError(`Como máximo ${MAX_SIMULATED} participantes simulados por sesión (ya hay ${active}).`);
  const prefix = simulatedPrefix(state.id);
  const used = [...state.events.map(event => event.actorId), ...state.participants.map(person => person.userId)]
    .filter(id => id.startsWith(prefix))
    .map(id => Number.parseInt(id.slice(prefix.length), 10))
    .filter(Number.isFinite);
  let next = used.length ? Math.max(...used) : 0;
  const events: SimEvent[] = [];
  const added: string[] = [];
  for (let i = 0; i < count; i++) {
    next += 1;
    const number = String(next).padStart(2, '0');
    const actor: Actor = { id: `${prefix}${number}`, name: `Participante simulado ${number}`, role: 'participant' };
    const result = applyCommand(state, { id: `${actor.id}-join`, type: 'join' }, actor, at);
    state = result.state;
    const person = state.participants.find(item => item.userId === actor.id);
    if (person) person.simulated = true;
    events.push(...result.events);
    added.push(actor.id);
  }
  return { state, events, added };
}

/**
 * Retira los participantes simulados con sus decisiones e indicadores y recalcula la media de la clase.
 * Los eventos ya emitidos (unión y decisiones con IDs `sim-…`) se conservan: el registro es de solo añadir y la cola
 * ya los ha persistido. Los informes se calculan sobre `participants` y `decisions`, así que dejan de contarlos.
 */
export function removeSimulated(current: SessionState): { state: SessionState; removed: number } {
  const state = structuredClone(normalizeState(current));
  if (state.status === 'complete') throw new DomainError('La sesión ya terminó.');
  const simulated = new Set(state.participants.filter(person => person.simulated).map(person => person.userId));
  if (!simulated.size) return { state, removed: 0 };
  state.participants = state.participants.filter(person => !simulated.has(person.userId));
  state.decisions = state.decisions.filter(decision => !simulated.has(decision.userId));
  for (const userId of simulated) delete state.participantMeters[userId];
  state.meters = classMeters(state);
  return { state, removed: simulated.size };
}

/**
 * Agenda de decisiones simuladas para el estado actual: conserva las tareas válidas de la fase activa y programa,
 * a 2-12 s de `now`, la de cada participante simulado que aún no haya decidido en ella. Con la sesión pausada o
 * terminada la agenda queda vacía; al reanudar se vuelve a programar con retardos nuevos.
 */
export function reconcileBots(state: SessionState, tasks: BotTask[], now: number, rng: Rng = Math.random): BotTask[] {
  if (state.status !== 'active') return [];
  const phase = state.scenario.phases[state.phaseIndex];
  const decided = new Set(state.decisions.filter(decision => decision.phaseId === phase.id).map(decision => decision.userId));
  const pending = state.participants.filter(person => person.simulated && !decided.has(person.userId)).map(person => person.userId);
  const waiting = new Set(pending);
  const kept = tasks.filter(task => task.phaseId === phase.id && waiting.has(task.userId));
  const scheduled = new Set(kept.map(task => task.userId));
  for (const userId of pending) {
    if (scheduled.has(userId)) continue;
    kept.push({ userId, phaseId: phase.id, dueAt: now + BOT_MIN_DELAY_MS + Math.round(rng() * (BOT_MAX_DELAY_MS - BOT_MIN_DELAY_MS)) });
  }
  return kept.sort((a, b) => a.dueAt - b.dueAt);
}

/** Decisión de un participante simulado por la vía normal del motor. Si ya no procede (pausa, ya decidió...), no cambia nada. */
export function botDecide(state: SessionState, task: BotTask, at: string, rng: Rng = Math.random): { state: SessionState; events: SimEvent[] } {
  const person = state.participants.find(item => item.userId === task.userId && item.simulated);
  const phase = state.scenario.phases[state.phaseIndex];
  if (!person || phase.id !== task.phaseId || state.status !== 'active') return { state, events: [] };
  const actor: Actor = { id: person.userId, name: person.name, role: 'participant' };
  try {
    return applyCommand(state, { id: `${person.userId}-${phase.id}`, type: 'decide', optionId: pickOption(phase, rng).id }, actor, at);
  } catch (error) {
    if (error instanceof DomainError) return { state, events: [] };
    throw error;
  }
}

/** Próxima alarma del Durable Object: la más cercana entre el fin de la fase (si hay temporizadores) y la agenda simulada. */
export function nextAlarmAt(state: SessionState, tasks: BotTask[], timersOn: boolean): number | null {
  if (state.status !== 'active') return null;
  const candidates: number[] = [];
  if (timersOn && state.phaseDeadline) candidates.push(Date.parse(state.phaseDeadline));
  if (tasks.length) candidates.push(Math.min(...tasks.map(task => task.dueAt)));
  return candidates.length ? Math.min(...candidates) : null;
}
