/** Cálculos de la consola a partir del estado que ya recibe el docente. Todo es aritmética sobre decisiones: no se valora a personas. */
import { classMeters, performanceReport, type Meters, type Phase, type SessionState } from '../shared/simulation';
import type { LiveTally, Person, Report } from './types';

export type Tally = { counts: number[]; decided: number; total: number };

/**
 * Recuento de una fase. Usa `liveTally` del servidor si corresponde a esa fase; si no, lo calcula con las decisiones
 * visibles (el docente recibe todas). Con `exclude`, descuenta a esos participantes (p. ej., los simulados).
 */
export function tallyFor(state: SessionState, phase: Phase | undefined, liveTally?: LiveTally, exclude?: Set<string>): Tally {
  if (!phase) return { counts: [], decided: 0, total: 0 };
  if (liveTally && liveTally.phaseId === phase.id && !exclude?.size && Array.isArray(liveTally.counts)) {
    const counts = phase.options.map((_, index) => Number(liveTally.counts[index]) || 0);
    return { counts, decided: liveTally.decided, total: liveTally.total };
  }
  const people = state.participants.filter(person => !exclude?.has(person.userId));
  const ids = new Set(people.map(person => person.userId));
  const decisions = state.decisions.filter(decision => decision.phaseId === phase.id && ids.has(decision.userId));
  const counts = phase.options.map(option => decisions.filter(decision => decision.optionId === option.id).length);
  return { counts, decided: new Set(decisions.map(decision => decision.userId)).size, total: people.length };
}

export function simulatedIds(state: SessionState): Set<string> {
  return new Set((state.participants as Person[]).filter(person => person.simulated).map(person => person.userId));
}

/** Estado sin los participantes indicados (para recalcular el informe sin simulados). */
export function withoutParticipants(state: SessionState, exclude: Set<string>): SessionState {
  if (!exclude.size) return state;
  const participants = state.participants.filter(person => !exclude.has(person.userId));
  const participantMeters = Object.fromEntries(Object.entries(state.participantMeters ?? {}).filter(([userId]) => !exclude.has(userId)));
  const next: SessionState = {
    ...state, participants, participantMeters,
    decisions: state.decisions.filter(decision => !exclude.has(decision.userId)),
    events: state.events.filter(event => !exclude.has(event.actorId))
  };
  return { ...next, meters: classMeters(next) };
}

/** Informe de la clase recalculado en el navegador con el mismo motor que el servidor. */
export function classReport(state: SessionState): Report {
  const report = performanceReport(state);
  const people = state.participants as Person[];
  return { ...report, participantReports: report.participantReports.map(row => ({ ...row, simulated: people.find(person => person.userId === row.userId)?.simulated === true })) };
}

export type PhaseSummary = { phase: Phase; index: number; tally: Tally; topIndex: number; bestIndexes: number[]; bestShare: number | null };

export function phaseSummaries(state: SessionState): PhaseSummary[] {
  return state.scenario.phases.map((phase, index) => {
    const tally = tallyFor(state, phase);
    const decided = tally.counts.reduce((sum, value) => sum + value, 0);
    const topIndex = decided ? tally.counts.indexOf(Math.max(...tally.counts)) : -1;
    const bestIndexes = phase.options.flatMap((option, i) => option.quality === 'best' ? [i] : []);
    const best = bestIndexes.reduce((sum, i) => sum + (tally.counts[i] ?? 0), 0);
    return { phase, index, tally, topIndex, bestIndexes, bestShare: decided && bestIndexes.length ? Math.round((100 * best) / decided) : null };
  });
}

export function meterDelta(initial: Meters, final: Meters, name: keyof Meters): number { return final[name] - initial[name]; }
export function share(count: number, total: number): number { return total > 0 ? Math.round((100 * count) / total) : 0; }
