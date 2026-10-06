/** Tipos y utilidades de presentación de la consola. Sin dependencias de React. */
import type { Participant, PerformanceReport, MeterName, SessionState } from '../shared/simulation';

export type Role = 'instructor' | 'participant';
export type Identity = { id: string; name: string; email: string; role: Role; tenantId: string };
export type SessionSummary = { id: string; status: string; createdAt: string; scenarioId: string };
/** Entrada del debriefing. `rationale` y `takeaway` son opcionales: los informes antiguos no los traen. */
export type TimelineEntry = Omit<PerformanceReport['timeline'][number], 'rationale' | 'takeaway'> & { rationale?: string | null; takeaway?: string | null };
/** Resultado individual de un participante (modo individual). Todo opcional salvo el userId para no depender del motor. */
export type ParticipantResult = {
  userId: string; name?: string; score?: number; objectivesMet?: number; objectivesTotal?: number;
  correctDecisionsPct?: number | null; criticalDecisions?: number; decisions?: number; meters?: Partial<Record<MeterName, number>>;
  simulated?: boolean;
};
/**
 * Informe tal como lo recibe la consola. Se tipa aparte del motor para tolerar versiones distintas:
 * `participants` puede ser un número (informe de la clase) o la lista de resultados por participante.
 */
export type Report = Omit<PerformanceReport, 'timeline' | 'participants' | 'participantReports'> & {
  timeline: TimelineEntry[];
  participants?: number | ParticipantResult[];
  participantReports?: ParticipantResult[];
};
/** Recuento en vivo de la fase activa (solo docente). Puede faltar si el servidor aún no lo envía. */
export type LiveTally = { phaseId: string; counts: number[]; decided: number; total: number };
/** Participante tal como llega a la consola: los de «Simular clase» traen `simulated: true`. */
export type Person = Participant & { simulated?: boolean };
export type SessionPayload = { state: SessionState; report: Report; clients?: { unity?: string }; liveTally?: LiveTally };
export type ScenarioSummary = { id: string; version: number; title: string; summary: string; phases: number; catalog: boolean };
export type Member = { id: string; email: string; name: string; role: Role };
export type CodeSummary = { id: string; userId: string; createdAt: string; uses: number; lastUsedAt: string | null };
export type CodeUse = { codeId: string; userId: string; name: string | null; at: string; outcome: 'accepted' | 'revoked' };

export const METERS = ['relationship', 'margin', 'risk'] as const;

export function pct(value: number | null | undefined): string { return value == null ? '—' : `${value} %`; }
export function signed(value: number): string { return value > 0 ? `+${value}` : value < 0 ? `−${Math.abs(value)}` : '0'; }
export function roleLabel(role: string): string { return role === 'instructor' ? 'Docente' : 'Participante'; }
export function statusLabel(status: string): string { return status === 'complete' ? 'Finalizada' : status === 'paused' ? 'En pausa' : 'En curso'; }
export function qualityLabel(value: string | null | undefined): string { return value === 'best' ? 'Mejor opción' : value === 'acceptable' ? 'Aceptable' : value === 'poor' ? 'Crítica' : 'Sin valorar'; }
export function formatClock(ms: number): string { const total = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
export function optionLetter(index: number): string { return String.fromCharCode(65 + index); }
export function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
}
export function longDate(iso: string | Date): string {
  const date = typeof iso === 'string' ? new Date(iso) : iso;
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
}
export function plural(count: number, one: string, many: string): string { return `${count.toLocaleString('es-ES')} ${count === 1 ? one : many}`; }
export function errorText(cause: unknown): string { return String(cause).replace(/^Error: /, ''); }
export function isSimulated(state: SessionState, userId: string): boolean {
  return (state.participants as Person[]).some(person => person.userId === userId && person.simulated === true);
}
export function eventLabel(type: string): string {
  return ({ session_started: 'Sesión creada', participant_joined: 'Participante incorporado', decision: 'Decisión registrada', phase_advanced: 'Nueva situación', paused: 'Sesión en pausa', resumed: 'Sesión reanudada', incident: 'Incidente lanzado', meter_changed: 'Indicador ajustado', timer_expired: 'Tiempo agotado', completed: 'Sesión finalizada' } as Record<string, string>)[type] ?? 'Evento';
}
export function actorLabel(actorId: string, state: SessionState): string {
  if (actorId === 'system') return 'Sistema';
  if (actorId === state.instructorId) return 'Docente';
  return state.participants.find(person => person.userId === actorId)?.name ?? 'Participante';
}
