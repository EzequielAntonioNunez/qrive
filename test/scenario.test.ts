import { describe, expect, it } from 'vitest';
import { validateScenario } from '../shared/scenario';
import { applyChoice, catalogScenarios, defaultScenario, meterLabels, performanceReport } from '../shared/simulation';
import { negotiationScenario } from './fixtures/negotiation-scenario';
import { applyCommand, createSession, type Actor } from '../shared/engine';

const clone = () => structuredClone(negotiationScenario) as unknown as Record<string, any>;

describe('scenario definitions', () => {
  it('accepts the generic fixture scenario unchanged', () => {
    expect(validateScenario(negotiationScenario)).toEqual(negotiationScenario);
  });

  it('publishes every catalog scenario, with the law-firm AI one as default and unique phase ids', () => {
    for (const scenario of catalogScenarios) expect(validateScenario(scenario)).toEqual(scenario);
    expect(defaultScenario.id).toBe('ia-despacho');
    expect(meterLabels(defaultScenario)).toEqual({ relationship: 'Confianza del cliente', margin: 'Deontología', risk: 'Riesgo' });
    expect(meterLabels(negotiationScenario).relationship).toBe('Relación');
    // Unity busca la locución por id de fase, así que no pueden repetirse entre escenarios del catálogo.
    const phaseIds = catalogScenarios.flatMap(scenario => scenario.phases.map(phase => phase.id));
    expect(new Set(phaseIds).size).toBe(phaseIds.length);
    for (const phase of defaultScenario.phases) expect(phase.options.filter(option => option.quality === 'best')).toHaveLength(1);
  });

  it('keeps the catalog in order, with stable phase and option ids in the default scenario', () => {
    expect(catalogScenarios.map(scenario => scenario.id)).toEqual(['ia-despacho']);
    expect(defaultScenario.version).toBe(1);
    // Unity, la vista móvil y las locuciones buscan los audios por id de fase y de opción.
    expect(defaultScenario.phases.map(phase => phase.id)).toEqual(['secreto-profesional', 'jurisprudencia-inventada', 'proveedor-ia', 'transparencia-cliente']);
    // El smoke depende de estos ids de opción del escenario por defecto.
    expect(defaultScenario.phases.map(phase => phase.options[0].id)).toEqual(['anonimizar-herramienta', 'verificar-fuentes', 'contrato-garantias', 'explicar-minuta']);
  });

  it('gives every VictorIA scenario one best option per phase, a rationale per option and a takeaway per phase', () => {
    const victoria = catalogScenarios.filter(scenario => scenario.character.name === 'VictorIA');
    expect(victoria.map(scenario => scenario.id)).toEqual(['ia-despacho']);
    for (const scenario of victoria) {
      expect(scenario.phases).toHaveLength(4);
      expect(scenario.meterLabels).toBeDefined();
      for (const phase of scenario.phases) {
        expect(phase.options.filter(option => option.quality === 'best')).toHaveLength(1);
        expect(phase.options.some(option => option.quality === 'acceptable')).toBe(true);
        expect(phase.options.some(option => option.quality === 'poor')).toBe(true);
        expect(phase.options.length).toBeGreaterThanOrEqual(3);
        expect(phase.timeLimitSec).toBeGreaterThanOrEqual(180);
        expect(phase.timeLimitSec).toBeLessThanOrEqual(240);
        // Se locuta: frase breve, sin comillas simples (el guion de TTS la extrae del código).
        expect(phase.characterLine.split(/\s+/).length).toBeLessThanOrEqual(45);
        expect(phase.characterLine).not.toContain("'");
        expect(phase.takeaway?.length).toBeGreaterThan(0);
        for (const option of phase.options) expect(option.rationale?.length).toBeGreaterThan(0);
        // La frase se locuta: los números van escritos con letra.
        expect(phase.characterLine).not.toMatch(/\d/);
      }
    }
  });

  it('validates rationale and takeaway as optional texts with a precise path', () => {
    const without = clone();
    expect(validateScenario(without).phases[0]).not.toHaveProperty('takeaway');
    const rationale = clone();
    rationale.phases[0].options[1].rationale = 'x'.repeat(301);
    expect(() => validateScenario(rationale)).toThrow('phases[0].options[1].rationale');
    const blank = clone();
    blank.phases[1].options[0].rationale = '   ';
    expect(() => validateScenario(blank)).toThrow('phases[1].options[0].rationale');
    const takeaway = clone();
    takeaway.phases[2].takeaway = 'x'.repeat(241);
    expect(() => validateScenario(takeaway)).toThrow('phases[2].takeaway');
    const valid = clone();
    valid.phases[0].takeaway = '  Prepara con datos.  ';
    valid.phases[0].options[0].rationale = 'Negociar con datos reduce el riesgo.';
    const scenario = validateScenario(valid);
    expect(scenario.phases[0].takeaway).toBe('Prepara con datos.');
    expect(scenario.phases[0].options[0].rationale).toBe('Negociar con datos reduce el riesgo.');
  });

  it('includes the chosen option rationale and the phase takeaway in the debrief', () => {
    const instructor: Actor = { id: 'i', name: 'I', role: 'instructor' };
    const participant: Actor = { id: 'p', name: 'P', role: 'participant' };
    const at = '2026-10-06T10:00:00.000Z';
    for (const scenario of catalogScenarios.filter(item => item.character.name === 'VictorIA')) {
      let state = createSession('s', 't', instructor, at, scenario);
      state = applyCommand(state, { id: 'join-00001', type: 'join' }, participant, at).state;
      scenario.phases.forEach((phase, index) => {
        const option = phase.options[phase.options.length - 1];
        state = applyCommand(state, { id: `dec-${index}-0001`, type: 'decide', optionId: option.id }, participant, at).state;
        if (index < scenario.phases.length - 1) state = applyCommand(state, { id: `adv-${index}-0001`, type: 'advance' }, instructor, at).state;
      });
      const report = performanceReport(state);
      expect(report.timeline).toHaveLength(scenario.phases.length);
      report.timeline.forEach((entry, index) => {
        const phase = scenario.phases[index];
        expect(entry.takeaway).toBe(phase.takeaway);
        expect(entry.rationale).toBe(phase.options[phase.options.length - 1].rationale);
      });
    }
    // Sin contenido de aprendizaje, el debrief lo indica con null.
    let plain = createSession('s', 't', instructor, at, negotiationScenario);
    plain = applyCommand(plain, { id: 'join-00001', type: 'join' }, participant, at).state;
    plain = applyCommand(plain, { id: 'dec-000001', type: 'decide', optionId: 'ask-data' }, participant, at).state;
    expect(performanceReport(plain).timeline[0]).toMatchObject({ rationale: null, takeaway: null });
  });

  it('reaches every objective when choosing the best option in each VictorIA phase', () => {
    for (const scenario of catalogScenarios.filter(item => item.character.name === 'VictorIA')) {
      const meters = scenario.phases.reduce((current, phase) => applyChoice(current, phase.options.find(option => option.quality === 'best')!), scenario.initialMeters);
      expect(meters.relationship).toBeGreaterThanOrEqual(55);
      expect(meters.margin).toBeGreaterThanOrEqual(55);
      expect(meters.risk).toBeLessThanOrEqual(40);
    }
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
