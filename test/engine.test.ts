import { describe, expect, it } from 'vitest';
import { applyCommand, createSession, expireTimer, type Actor } from '../shared/engine';

const instructor: Actor = { id: 'teacher', name: 'Instructor', role: 'instructor' };
const participant: Actor = { id: 'learner', name: 'Participante', role: 'participant' };
const start = '2026-10-05T10:00:00.000Z';

describe('session authorization and command behavior', () => {
  it('rejects participant control and invalid phase progression', () => {
    const state = createSession('session', 'tenant', instructor, start);
    expect(() => applyCommand(state, { id: 'advance-1', type: 'advance' }, participant, start)).toThrow('reservada');
    expect(() => applyCommand(state, { id: 'advance-2', type: 'advance' }, instructor, start)).toThrow('al menos una decisión');
  });

  it('records one decision per participant and phase, and replays command IDs safely', () => {
    const state = createSession('session', 'tenant', instructor, start);
    const joined = applyCommand(state, { id: 'join-0001', type: 'join' }, participant, start).state;
    const decided = applyCommand(joined, { id: 'decide-0001', type: 'decide', optionId: 'ask-data' }, participant, '2026-10-05T10:00:05.000Z').state;
    expect(decided.decisions[0].durationMs).toBe(5000);
    expect(decided.meters).toEqual({ relationship: 55, margin: 58, risk: 40 });
    expect(applyCommand(decided, { id: 'decide-0001', type: 'decide', optionId: 'ask-data' }, participant, start).events).toEqual([]);
    expect(() => applyCommand(decided, { id: 'decide-0002', type: 'decide', optionId: 'accept-increase' }, participant, start)).toThrow('Ya has decidido');
  });

  it('records instructor meter adjustments as their own auditable event', () => {
    // Modo individual: el ajuste se aplica a los participantes y `meters` es su media; sin nadie unido no cambiaría nada.
    const state = applyCommand(createSession('session', 'tenant', instructor, start), { id: 'join-0001', type: 'join' }, participant, start).state;
    const result = applyCommand(state, { id: 'meter-0001', type: 'set-meter', meter: 'risk', value: 35 }, instructor, start);
    expect(result.state.meters.risk).toBe(35);
    expect(result.state.participantMeters[participant.id].risk).toBe(35);
    expect(result.events).toMatchObject([{ type: 'meter_changed', detail: { meter: 'risk', value: 35 } }]);
    expect(() => applyCommand(state, { id: 'meter-0002', type: 'set-meter', meter: 'risk', value: 101 }, instructor, start)).toThrow('Valor no válido');
    expect(() => applyCommand(state, { id: 'meter-0003', type: 'set-meter', meter: 'risk', value: 35 }, participant, start)).toThrow('reservada');
  });

  it('starts the phase timer with the first participant and freezes it while paused', () => {
    const state = createSession('session', 'tenant', instructor, start);
    expect(state.phaseDeadline).toBeNull();
    const joined = applyCommand(state, { id: 'join-0001', type: 'join' }, participant, '2026-10-05T10:01:00.000Z').state;
    expect(joined.phaseDeadline).toBe('2026-10-05T10:09:00.000Z');
    const paused = applyCommand(joined, { id: 'pause-0001', type: 'pause' }, instructor, '2026-10-05T10:03:00.000Z').state;
    expect(paused.phaseDeadline).toBeNull();
    expect(paused.phaseRemainingMs).toBe(360000);
    expect(expireTimer(paused, '2026-10-05T11:00:00.000Z').events).toEqual([]);
    const resumed = applyCommand(paused, { id: 'resume-0001', type: 'resume' }, instructor, '2026-10-05T10:10:00.000Z').state;
    expect(resumed.phaseDeadline).toBe('2026-10-05T10:16:00.000Z');
  });

  it('expires the timer once, as a system event with a risk consequence', () => {
    const joined = applyCommand(createSession('session', 'tenant', instructor, start), { id: 'join-0001', type: 'join' }, participant, start).state;
    expect(expireTimer(joined, '2026-10-05T10:07:59.000Z').events).toEqual([]);
    const expired = expireTimer(joined, '2026-10-05T10:08:00.000Z');
    expect(expired.events).toMatchObject([{ type: 'timer_expired', actorId: 'system', detail: { phaseId: 'prepare', riskDelta: 8 } }]);
    expect(expired.state.meters.risk).toBe(58);
    expect(expireTimer(expired.state, '2026-10-05T10:20:00.000Z').events).toEqual([]);
    const decided = applyCommand(expired.state, { id: 'decide-0001', type: 'decide', optionId: 'ask-data' }, participant, '2026-10-05T10:09:00.000Z').state;
    const advanced = applyCommand(decided, { id: 'advance-0001', type: 'advance' }, instructor, '2026-10-05T10:10:00.000Z').state;
    expect(advanced.phaseDeadline).toBe('2026-10-05T10:15:00.000Z');
  });
});
