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
      status: 'complete', phaseIndex: 2, phaseStartedAt: '2026-10-05T00:00:00Z', phaseDeadline: null, phaseRemainingMs: null,
      meters: { relationship: 65, margin: 60, risk: 35 },
      participantMeters: { p: { relationship: 65, margin: 60, risk: 35 } },
      participants: [{ userId: 'p', name: 'Participant', joinedAt: '2026-10-05T00:00:00Z' }],
      decisions: [{ userId: 'p', phaseId: 'prepare', optionId: 'ask-data', at: '2026-10-05T00:00:03Z', durationMs: 3000 }],
      events: [{ seq: 1, type: 'completed', at: '2026-10-05T00:01:00Z', actorId: 'i', detail: {} }],
      processedCommands: [], pendingEvents: [], createdAt: '2026-10-05T00:00:00Z'
    };
    expect(performanceReport(state)).toMatchObject({ score: 63, decisions: 1, avgReactionMs: 3000, objectivesMet: 3, objectivesTotal: 3 });
  });
});

describe('performance report for debriefing', () => {
  it('rates decisions by option quality and reaction against the phase time limit', async () => {
    const { applyCommand, createSession } = await import('../shared/engine');
    const instructor = { id: 'i', name: 'I', role: 'instructor' as const };
    const participant = { id: 'p', name: 'P', role: 'participant' as const };
    let state = createSession('s', 't', instructor, '2026-10-06T10:00:00.000Z');
    state = applyCommand(state, { id: 'join-00001', type: 'join' }, participant, '2026-10-06T10:00:00.000Z').state;
    // 120 s de 480 s disponibles: queda el 75 % del tiempo.
    state = applyCommand(state, { id: 'dec-000001', type: 'decide', optionId: 'ask-data' }, participant, '2026-10-06T10:02:00.000Z').state;
    state = applyCommand(state, { id: 'adv-000001', type: 'advance' }, instructor, '2026-10-06T10:03:00.000Z').state;
    // 150 s de 300 s: queda el 50 %.
    state = applyCommand(state, { id: 'dec-000002', type: 'decide', optionId: 'demand-zero' }, participant, '2026-10-06T10:05:30.000Z').state;
    const report = performanceReport(state);
    expect(report.correctDecisionsPct).toBe(50);
    expect(report.reactionPct).toBe(63);
    expect(report.criticalDecisions).toBe(1);
    expect(report.timeline.map(entry => [entry.phaseTitle, entry.quality])).toEqual([['Preparación', 'best'], ['Contraoferta', 'poor']]);
  });
});
