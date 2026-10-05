import { describe, expect, it } from 'vitest';
import { applyCommand, createSession, type Actor } from '../shared/engine';

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
});
