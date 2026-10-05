import { describe, expect, it } from 'vitest';
import { applyChoice, clampMeter, negotiationScenario, performanceReport, type SessionState } from '../shared/simulation';

describe('negotiation simulation', () => {
  it('keeps meter effects deterministic and bounded', () => {
    expect(clampMeter(-5)).toBe(0);
    expect(clampMeter(105)).toBe(100);
    const first = negotiationScenario.phases[0].options[0];
    expect(applyChoice(negotiationScenario.initialMeters, first)).toEqual({ relationship: 55, margin: 58, risk: 40 });
  });

  it('produces an explainable report from decisions, time and final meters', () => {
    const state: SessionState = {
      id: 's', tenantId: 't', instructorId: 'i', scenario: negotiationScenario,
      status: 'complete', phaseIndex: 2, phaseStartedAt: '2026-10-05T00:00:00Z',
      meters: { relationship: 65, margin: 60, risk: 35 },
      participants: [{ userId: 'p', name: 'Participant', joinedAt: '2026-10-05T00:00:00Z' }],
      decisions: [{ userId: 'p', phaseId: 'prepare', optionId: 'ask-data', at: '2026-10-05T00:00:03Z', durationMs: 3000 }],
      events: [{ seq: 1, type: 'completed', at: '2026-10-05T00:01:00Z', actorId: 'i', detail: {} }],
      processedCommands: [], pendingEvents: [], createdAt: '2026-10-05T00:00:00Z'
    };
    expect(performanceReport(state)).toMatchObject({ score: 63, decisions: 1, avgReactionMs: 3000, objectivesMet: 3, objectivesTotal: 3 });
  });
});
