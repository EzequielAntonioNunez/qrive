import { applyChoice, clampMeter, negotiationScenario, performanceReport, type MeterName, type SessionState, type SimEvent } from './simulation';

export type Role = 'instructor' | 'participant';
export interface Actor { id: string; name: string; role: Role }
export type Command =
  | { id: string; type: 'join' }
  | { id: string; type: 'decide'; optionId: string }
  | { id: string; type: 'advance' | 'pause' | 'resume' | 'complete' }
  | { id: string; type: 'incident'; note: string; riskDelta: number }
  | { id: string; type: 'set-meter'; meter: MeterName; value: number };

export class DomainError extends Error {}

export function createSession(id: string, tenantId: string, instructor: Actor, at: string): SessionState {
  if (instructor.role !== 'instructor') throw new DomainError('Solo un instructor puede crear sesiones.');
  return {
    id, tenantId, instructorId: instructor.id, scenario: negotiationScenario,
    status: 'active', phaseIndex: 0, phaseStartedAt: at,
    meters: { ...negotiationScenario.initialMeters }, participants: [], decisions: [],
    events: [{ seq: 1, type: 'session_started', at, actorId: instructor.id, detail: { scenarioVersion: negotiationScenario.version } }],
    processedCommands: [], pendingEvents: [], createdAt: at
  };
}

export function applyCommand(state: SessionState, command: Command, actor: Actor, at: string): { state: SessionState; events: SimEvent[] } {
  if (state.processedCommands.includes(command.id)) return { state, events: [] };
  if (state.status === 'complete') throw new DomainError('La sesión ya terminó.');
  const next: SessionState = structuredClone(state);
  const emitted: SimEvent[] = [];
  const emit = (type: SimEvent['type'], detail: SimEvent['detail']) => {
    const event = { seq: next.events.length + 1, type, at, actorId: actor.id, detail };
    next.events.push(event);
    emitted.push(event);
  };
  const instructor = actor.role === 'instructor' && actor.id === state.instructorId;
  if (command.type === 'join') {
    if (actor.role !== 'participant') throw new DomainError('Solo un participante puede unirse.');
    if (next.phaseIndex !== 0) throw new DomainError('La sesión ya está en marcha.');
    if (!next.participants.some(person => person.userId === actor.id)) {
      next.participants.push({ userId: actor.id, name: actor.name, joinedAt: at });
      emit('participant_joined', { participantId: actor.id });
    }
  } else if (command.type === 'decide') {
    if (actor.role !== 'participant' || !next.participants.some(person => person.userId === actor.id)) throw new DomainError('Debes unirte antes de decidir.');
    if (next.status !== 'active') throw new DomainError('La sesión está pausada.');
    const phase = next.scenario.phases[next.phaseIndex];
    if (next.decisions.some(decision => decision.userId === actor.id && decision.phaseId === phase.id)) throw new DomainError('Ya has decidido en esta fase.');
    const option = phase.options.find(item => item.id === command.optionId);
    if (!option) throw new DomainError('Opción no válida para esta fase.');
    const durationMs = Math.max(0, Date.parse(at) - Date.parse(next.phaseStartedAt));
    next.decisions.push({ userId: actor.id, phaseId: phase.id, optionId: option.id, at, durationMs });
    next.meters = applyChoice(next.meters, option);
    emit('decision', { phaseId: phase.id, optionId: option.id, durationMs });
  } else {
    if (!instructor) throw new DomainError('Acción reservada al instructor.');
    if (command.type === 'advance') {
      if (next.status !== 'active') throw new DomainError('Reanuda la sesión antes de avanzar.');
      const phase = next.scenario.phases[next.phaseIndex];
      if (!next.decisions.some(decision => decision.phaseId === phase.id)) throw new DomainError('Espera al menos una decisión.');
      if (next.phaseIndex >= next.scenario.phases.length - 1) throw new DomainError('Es la última fase; finaliza la sesión.');
      next.phaseIndex += 1;
      next.phaseStartedAt = at;
      emit('phase_advanced', { phaseId: next.scenario.phases[next.phaseIndex].id });
    } else if (command.type === 'pause') {
      if (next.status !== 'active') throw new DomainError('La sesión ya está pausada.');
      next.status = 'paused';
      emit('paused', {});
    } else if (command.type === 'resume') {
      if (next.status !== 'paused') throw new DomainError('La sesión no está pausada.');
      next.status = 'active';
      next.phaseStartedAt = at;
      emit('resumed', {});
    } else if (command.type === 'complete') {
      if (next.phaseIndex !== next.scenario.phases.length - 1 || !next.decisions.some(decision => decision.phaseId === next.scenario.phases[next.phaseIndex].id)) {
        throw new DomainError('Completa las fases antes de finalizar.');
      }
      next.status = 'complete';
      emit('completed', { score: performanceReport(next).score });
    } else if (command.type === 'incident') {
      if (!command.note.trim() || command.note.length > 200 || !Number.isFinite(command.riskDelta) || Math.abs(command.riskDelta) > 25) throw new DomainError('Incidente no válido.');
      next.meters.risk = clampMeter(next.meters.risk + command.riskDelta);
      emit('incident', { note: command.note.trim(), riskDelta: command.riskDelta });
    } else if (command.type === 'set-meter') {
      if (!['relationship', 'margin', 'risk'].includes(command.meter) || !Number.isInteger(command.value) || command.value < 0 || command.value > 100) throw new DomainError('Valor no válido.');
      next.meters[command.meter] = command.value;
      emit('meter_changed', { meter: command.meter, value: command.value });
    }
  }
  next.processedCommands.push(command.id);
  return { state: next, events: emitted };
}
