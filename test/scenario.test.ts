import { describe, expect, it } from 'vitest';
import { validateScenario } from '../shared/scenario';
import { catalogScenarios, defaultScenario, meterLabels, negotiationScenario } from '../shared/simulation';
import { applyCommand, createSession, type Actor } from '../shared/engine';

const clone = () => structuredClone(negotiationScenario) as unknown as Record<string, any>;

describe('scenario definitions', () => {
  it('accepts the catalog scenario unchanged', () => {
    expect(validateScenario(negotiationScenario)).toEqual(negotiationScenario);
  });

  it('publishes every catalog scenario, with the AI practices one as default and unique phase ids', () => {
    for (const scenario of catalogScenarios) expect(validateScenario(scenario)).toEqual(scenario);
    expect(defaultScenario.id).toBe('ia-buenas-practicas');
    expect(meterLabels(defaultScenario)).toEqual({ relationship: 'Confianza', margin: 'Productividad', risk: 'Riesgo' });
    expect(meterLabels(negotiationScenario).relationship).toBe('Relación');
    // Unity busca la locución por id de fase, así que no pueden repetirse entre escenarios del catálogo.
    const phaseIds = catalogScenarios.flatMap(scenario => scenario.phases.map(phase => phase.id));
    expect(new Set(phaseIds).size).toBe(phaseIds.length);
    for (const phase of defaultScenario.phases) expect(phase.options.filter(option => option.quality === 'best')).toHaveLength(1);
  });

  it('rejects incomplete meter labels', () => {
    const labels = clone();
    labels.meterLabels = { relationship: 'Confianza', margin: 'Productividad' };
    expect(() => validateScenario(labels)).toThrow('meterLabels.risk');
  });

  it('rejects duplicated ids, out-of-range effects and missing character lines with a precise path', () => {
    const duplicated = clone();
    duplicated.phases[1].id = 'prepare';
    expect(() => validateScenario(duplicated)).toThrow('phases[1].id: repetido');
    const effects = clone();
    effects.phases[0].options[0].effects.risk = 80;
    expect(() => validateScenario(effects)).toThrow('phases[0].options[0].effects.risk');
    const line = clone();
    delete line.phases[2].characterLine;
    expect(() => validateScenario(line)).toThrow('phases[2].characterLine');
  });

  it('runs a session on any valid scenario, not only the built-in one', () => {
    const custom = clone();
    custom.id = 'crisis-demo';
    custom.initialMeters = { relationship: 70, margin: 40, risk: 30 };
    custom.phases = [custom.phases[0], custom.phases[2]];
    const scenario = validateScenario(custom);
    const instructor: Actor = { id: 'i', name: 'I', role: 'instructor' };
    const participant: Actor = { id: 'p', name: 'P', role: 'participant' };
    const at = '2026-10-06T10:00:00.000Z';
    let state = createSession('s', 't', instructor, at, scenario);
    expect(state.meters).toEqual({ relationship: 70, margin: 40, risk: 30 });
    state = applyCommand(state, { id: 'join-00001', type: 'join' }, participant, at).state;
    state = applyCommand(state, { id: 'dec-000001', type: 'decide', optionId: 'ask-data' }, participant, at).state;
    state = applyCommand(state, { id: 'adv-000001', type: 'advance' }, instructor, at).state;
    state = applyCommand(state, { id: 'dec-000002', type: 'decide', optionId: 'milestones' }, participant, at).state;
    expect(applyCommand(state, { id: 'end-000001', type: 'complete' }, instructor, at).state.status).toBe('complete');
  });
});
