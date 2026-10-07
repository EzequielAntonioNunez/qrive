import { normalizeState, participantReport, type Meters, type PerformanceReport, type SessionState } from './simulation';

/**
 * RGPD (acceso y portabilidad): datos de UNA persona dentro de una sesión, a partir del estado completo que ve el
 * instructor. Solo contiene lo de esa persona: ni nombres ni decisiones de compañeros. Lo usan el Worker
 * (GET /api/sessions/:id/participants/:participantId/export) y la demo en navegador.
 */
export interface ParticipantExport {
  exportedAt: string;
  session: { id: string; scenarioId: string; scenarioVersion: number; scenarioTitle: string; status: SessionState['status']; createdAt: string };
  participant: { id: string; name: string; kind: 'member' | 'guest' | 'simulated'; joinedAt: string };
  joins: { at: string }[];
  decisions: { phaseId: string; phaseTitle: string; optionId: string; optionLabel: string; at: string; durationMs: number }[];
  meters: Meters;
  report: PerformanceReport;
}

/** Datos exportables de un participante; null si no está en la sesión. */
export function participantExport(current: SessionState, participantId: string, exportedAt: string): ParticipantExport | null {
  const state = normalizeState(current);
  const person = state.participants.find(item => item.userId === participantId);
  if (!person) return null;
  const phaseOf = (id: string) => state.scenario.phases.find(phase => phase.id === id);
  const joins = state.events.filter(event => event.type === 'participant_joined' && event.actorId === participantId).map(event => ({ at: event.at }));
  return {
    exportedAt,
    session: { id: state.id, scenarioId: state.scenario.id, scenarioVersion: state.scenario.version, scenarioTitle: state.scenario.title, status: state.status, createdAt: state.createdAt },
    participant: {
      id: person.userId, name: person.name, joinedAt: person.joinedAt,
      kind: person.simulated ? 'simulated' : person.userId.startsWith('guest-') ? 'guest' : 'member'
    },
    joins: joins.length ? joins : [{ at: person.joinedAt }],
    decisions: state.decisions.filter(decision => decision.userId === participantId).map(decision => {
      const phase = phaseOf(decision.phaseId);
      return {
        phaseId: decision.phaseId, phaseTitle: phase?.title ?? decision.phaseId, optionId: decision.optionId,
        optionLabel: phase?.options.find(option => option.id === decision.optionId)?.label ?? decision.optionId,
        at: decision.at, durationMs: decision.durationMs
      };
    }),
    meters: { ...(state.participantMeters[participantId] ?? state.scenario.initialMeters) },
    report: participantReport(state, participantId)
  };
}
