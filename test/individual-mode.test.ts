import { describe, expect, it } from 'vitest';
import { applyCommand, createSession, expireTimer, type Actor, type Command } from '../shared/engine';
import {
  defaultScenario, negotiationScenario, normalizeState, participantReport, participantView, performanceReport,
  type Phase, type Scenario, type SessionState
} from '../shared/simulation';

/**
 * Modo individual: en una sesión con varios alumnos cada participante tiene sus propios indicadores y su propio
 * informe; el docente ve el resumen de la clase (media) y el detalle por alumno.
 */

const instructor: Actor = { id: 'instructor-1', name: 'Docente', role: 'instructor' };
const ana: Actor = { id: 'participant-a', name: 'Ana', role: 'participant' };
const beto: Actor = { id: 'participant-b', name: 'Beto', role: 'participant' };
const carla: Actor = { id: 'participant-c', name: 'Carla', role: 'participant' };
const t0 = Date.parse('2026-10-06T09:00:00.000Z');
const at = (ms: number) => new Date(t0 + ms).toISOString();

type CommandBody = Command extends infer C ? (C extends Command ? Omit<C, 'id'> : never) : never;
let seq = 0;
function apply(state: SessionState, body: CommandBody, actor: Actor, ms: number): SessionState {
  return applyCommand(state, { id: `ind-${String(++seq).padStart(6, '0')}`, ...body } as Command, actor, at(ms)).state;
}

const best = (phase: Phase) => phase.options.find(option => option.quality === 'best')!;
const poor = (phase: Phase) => phase.options.find(option => option.quality === 'poor')!;

/** Sesión con Ana y Beto unidos en la primera fase. */
function classOf(scenario: Scenario = negotiationScenario): SessionState {
  let state = createSession('s-ind', 'tenant-1', instructor, at(0), scenario);
  state = apply(state, { type: 'join' }, ana, 0);
  return apply(state, { type: 'join' }, beto, 0);
}

describe('modo individual: indicadores e informes por participante', () => {
  it('dos participantes con decisiones distintas tienen indicadores e informes distintos, y la clase ve la media', () => {
    let state = classOf();
    expect(state.participantMeters).toEqual({ [ana.id]: { relationship: 50, margin: 50, risk: 50 }, [beto.id]: { relationship: 50, margin: 50, risk: 50 } });
    state = apply(state, { type: 'decide', optionId: 'ask-data' }, ana, 2000);
    state = apply(state, { type: 'decide', optionId: 'threaten-switch' }, beto, 4000);
    expect(state.participantMeters[ana.id]).toEqual({ relationship: 55, margin: 58, risk: 40 });
    expect(state.participantMeters[beto.id]).toEqual({ relationship: 30, margin: 54, risk: 68 });
    // Media redondeada: (55+30)/2 = 42,5 → 43; (58+54)/2 = 56; (40+68)/2 = 54.
    expect(state.meters).toEqual({ relationship: 43, margin: 56, risk: 54 });

    const classReport = performanceReport(state);
    expect(classReport.meters).toEqual(state.meters);
    expect(classReport.score).toBe(Math.round((43 + 56 + 46) / 3));
    expect(classReport.participants).toBe(2);
    expect(classReport.decisions).toBe(2);
    expect(classReport.correctDecisionsPct).toBe(50);
    expect(classReport.criticalDecisions).toBe(1);
    expect(classReport.avgReactionMs).toBe(3000);
    expect(classReport.timeline.map(entry => entry.userId)).toEqual([ana.id, beto.id]);
    expect(classReport.participantReports.map(report => [report.userId, report.name])).toEqual([[ana.id, 'Ana'], [beto.id, 'Beto']]);

    const [anaInClass, betoInClass] = classReport.participantReports;
    expect(anaInClass).toMatchObject({ score: 58, objectivesMet: 3, correctDecisionsPct: 100, criticalDecisions: 0, decisions: 1, meters: { relationship: 55, margin: 58, risk: 40 } });
    expect(betoInClass).toMatchObject({ score: 39, objectivesMet: 0, correctDecisionsPct: 0, criticalDecisions: 1, decisions: 1, meters: { relationship: 30, margin: 54, risk: 68 } });
    expect(anaInClass.timeline.map(entry => entry.optionId)).toEqual(['ask-data']);
    expect(betoInClass.timeline.map(entry => entry.optionId)).toEqual(['threaten-switch']);

    // El informe individual coincide con el detalle de la clase y no incluye a los demás.
    const anaReport = performanceReport(state, ana.id);
    expect(anaReport).toMatchObject({ score: 58, participants: 1, decisions: 1, participantReports: [] });
    expect(anaReport.timeline.every(entry => entry.userId === ana.id)).toBe(true);
    expect(participantReport(state, beto.id)).toEqual(performanceReport(state, beto.id));
    expect(performanceReport(state, 'nadie')).toMatchObject({ participants: 0, decisions: 0, meters: negotiationScenario.initialMeters });

    // La puntuación del cierre es la de la clase.
    state = apply(state, { type: 'advance' }, instructor, 5000);
    state = apply(state, { type: 'decide', optionId: 'three-year-eight' }, ana, 6000);
    state = apply(state, { type: 'advance' }, instructor, 7000);
    state = apply(state, { type: 'decide', optionId: best(negotiationScenario.phases[2]).id }, ana, 8000);
    state = apply(state, { type: 'complete' }, instructor, 9000);
    expect(state.events.at(-1)).toMatchObject({ type: 'completed', detail: { score: performanceReport(state).score } });
  });

  it('sin participantes, los indicadores de la clase son los iniciales aunque haya incidentes o ajustes', () => {
    let state = createSession('s-empty', 'tenant-1', instructor, at(0), negotiationScenario);
    state = apply(state, { type: 'incident', note: 'Aviso previo', riskDelta: 10 }, instructor, 100);
    state = apply(state, { type: 'set-meter', meter: 'margin', value: 90 }, instructor, 200);
    expect(state.meters).toEqual(negotiationScenario.initialMeters);
    expect(performanceReport(state)).toMatchObject({ participants: 0, participantReports: [], meters: negotiationScenario.initialMeters });
  });

  it('quien llega tarde se une en la fase 2 con indicadores iniciales y sin decisiones previas', () => {
    let state = classOf();
    state = apply(state, { type: 'decide', optionId: 'ask-data' }, ana, 1000);
    state = apply(state, { type: 'advance' }, instructor, 2000);
    expect(state.phaseIndex).toBe(1);
    const deadline = state.phaseDeadline;
    state = apply(state, { type: 'join' }, carla, 10_000);
    expect(state.participants.map(person => person.userId)).toEqual([ana.id, beto.id, carla.id]);
    expect(state.participantMeters[carla.id]).toEqual(negotiationScenario.initialMeters);
    // Unirse no reinicia el reloj de la fase.
    expect(state.phaseDeadline).toBe(deadline);
    expect(() => apply(state, { type: 'decide', optionId: 'ask-data' }, carla, 11_000)).toThrow('Opción no válida');
    state = apply(state, { type: 'decide', optionId: 'three-year-eight' }, carla, 13_000);
    const report = performanceReport(state, carla.id);
    expect(report.decisions).toBe(1);
    expect(report.timeline.map(entry => entry.phaseId)).toEqual(['counteroffer']);
    // Su tiempo de reacción cuenta desde que entró, no desde que empezó la fase.
    expect(report.avgReactionMs).toBe(3000);
    expect(performanceReport(state).participants).toBe(3);
    // Un instructor sigue sin poder unirse y nadie puede unirse a una sesión completada.
    expect(() => apply(state, { type: 'join' }, instructor, 14_000)).toThrow('participante');
    state = apply(state, { type: 'advance' }, instructor, 15_000);
    state = apply(state, { type: 'decide', optionId: best(negotiationScenario.phases[2]).id }, carla, 16_000);
    state = apply(state, { type: 'complete' }, instructor, 17_000);
    expect(() => apply(state, { type: 'join' }, { ...carla, id: 'participant-d' }, 18_000)).toThrow('terminó');
  });

  it('el temporizador vencido penaliza solo a quien no ha decidido en la fase', () => {
    let state = classOf();
    state = apply(state, { type: 'decide', optionId: 'ask-data' }, ana, 1000);
    const deadline = Date.parse(state.phaseDeadline!) - t0;
    const result = expireTimer(state, at(deadline));
    expect(result.events).toMatchObject([{ type: 'timer_expired', detail: { phaseId: 'prepare', riskDelta: 8 } }]);
    expect(result.state.participantMeters[ana.id].risk).toBe(40);
    expect(result.state.participantMeters[beto.id].risk).toBe(58);
    expect(result.state.meters.risk).toBe(49);
    state = result.state;
    // Quien se une después del vencimiento no queda penalizado por él.
    state = apply(state, { type: 'join' }, carla, deadline + 1000);
    state = apply(state, { type: 'decide', optionId: 'ask-data' }, beto, deadline + 2000);
    expect(performanceReport(state, ana.id).timeouts).toBe(0);
    expect(performanceReport(state, beto.id).timeouts).toBe(1);
    expect(performanceReport(state, carla.id).timeouts).toBe(0);
    expect(performanceReport(state).timeouts).toBe(1);
    expect(performanceReport(state, beto.id).timeline[0].timedOut).toBe(true);
  });

  it('un incidente afecta a todos los participantes y el ajuste del docente fija el valor para todos', () => {
    let state = classOf();
    state = apply(state, { type: 'decide', optionId: 'ask-data' }, ana, 1000);
    state = apply(state, { type: 'decide', optionId: 'threaten-switch' }, beto, 1000);
    state = apply(state, { type: 'incident', note: 'El proveedor anuncia retrasos', riskDelta: 5 }, instructor, 2000);
    expect(state.participantMeters[ana.id].risk).toBe(45);
    expect(state.participantMeters[beto.id].risk).toBe(73);
    expect(state.meters.risk).toBe(59);
    state = apply(state, { type: 'set-meter', meter: 'margin', value: 70 }, instructor, 3000);
    expect(state.participantMeters[ana.id]).toEqual({ relationship: 55, margin: 70, risk: 45 });
    expect(state.participantMeters[beto.id]).toEqual({ relationship: 30, margin: 70, risk: 73 });
    expect(state.meters).toEqual({ relationship: 43, margin: 70, risk: 59 });
  });
});

describe('vista filtrada del participante', () => {
  const scenario = defaultScenario;

  it('oculta quality, rationale y takeaway antes de decidir y los muestra después', () => {
    let state = classOf(scenario);
    let view = participantView(state, ana.id);
    for (const phase of view.scenario.phases) {
      expect(phase).not.toHaveProperty('takeaway');
      for (const option of phase.options) {
        expect(option).not.toHaveProperty('quality');
        expect(option).not.toHaveProperty('rationale');
        expect(option).not.toHaveProperty('effects');
        expect(option.label.length).toBeGreaterThan(0);
        expect(option.consequence.length).toBeGreaterThan(0);
      }
    }
    // El estado original no se modifica.
    expect(state.scenario.phases[0].options.every(option => option.quality)).toBe(true);

    state = apply(state, { type: 'decide', optionId: best(scenario.phases[0]).id }, ana, 1000);
    view = participantView(state, ana.id);
    const [current, next] = view.scenario.phases;
    expect(current.takeaway).toBe(scenario.phases[0].takeaway);
    expect(current.options.map(option => option.quality)).toEqual(scenario.phases[0].options.map(option => option.quality));
    expect(current.options.map(option => option.rationale)).toEqual(scenario.phases[0].options.map(option => option.rationale));
    // La fase siguiente sigue oculta, y Beto, que no ha decidido, no ve las valoraciones de la fase actual.
    expect(next).not.toHaveProperty('takeaway');
    expect(next.options.some(option => 'quality' in option || 'rationale' in option)).toBe(false);
    expect(participantView(state, beto.id).scenario.phases[0].options.some(option => 'quality' in option)).toBe(false);

    // Con la sesión completada se muestra todo para el debriefing.
    scenario.phases.forEach((phase, index) => {
      if (index > 0) state = apply(state, { type: 'decide', optionId: best(phase).id }, ana, 2000 + index * 1000);
      if (index < scenario.phases.length - 1) state = apply(state, { type: 'advance' }, instructor, 2500 + index * 1000);
    });
    state = apply(state, { type: 'complete' }, instructor, 9000);
    expect(participantView(state, beto.id).scenario.phases).toEqual(scenario.phases);
  });

  it('oculta a los compañeros: participantes, decisiones, indicadores y eventos ajenos', () => {
    let state = classOf(scenario);
    state = apply(state, { type: 'decide', optionId: best(scenario.phases[0]).id }, ana, 1000);
    state = apply(state, { type: 'decide', optionId: poor(scenario.phases[0]).id }, beto, 2000);
    state = apply(state, { type: 'incident', note: 'Llega una consulta urgente', riskDelta: 5 }, instructor, 3000);
    const view = participantView(state, beto.id);
    expect(view.participants.map(person => person.userId)).toEqual([beto.id]);
    expect(view.decisions.map(decision => decision.userId)).toEqual([beto.id]);
    expect(Object.keys(view.participantMeters)).toEqual([beto.id]);
    expect(view.meters).toEqual(state.participantMeters[beto.id]);
    expect(view.meters).not.toEqual(state.meters);
    expect(view.processedCommands).toEqual([]);
    expect(view.pendingEvents).toEqual([]);
    const types = view.events.map(event => event.type);
    expect(types).toEqual(['session_started', 'participant_joined', 'decision', 'incident']);
    expect(view.events.filter(event => event.type === 'participant_joined' || event.type === 'decision').every(event => event.actorId === beto.id)).toBe(true);
    expect(JSON.stringify(view)).not.toContain(ana.id);
    // La novedad del incidente sí le llega.
    expect(view.events.find(event => event.type === 'incident')?.detail.note).toBe('Llega una consulta urgente');
    // Su informe solo contiene lo suyo.
    expect(participantReport(state, beto.id).timeline.map(entry => entry.userId)).toEqual([beto.id]);
  });

  it('quien aún no se ha unido ve los indicadores iniciales y ningún participante', () => {
    const view = participantView(classOf(scenario), carla.id);
    expect(view.participants).toEqual([]);
    expect(view.decisions).toEqual([]);
    expect(view.participantMeters).toEqual({});
    expect(view.meters).toEqual(scenario.initialMeters);
  });
});

describe('compatibilidad con estados guardados antes del modo individual', () => {
  /** Estado como los que ya hay en Durable Objects: sin participantMeters y con los indicadores globales. */
  function legacyState(): SessionState {
    let state = classOf();
    state = apply(state, { type: 'decide', optionId: 'ask-data' }, ana, 1000);
    const legacy = structuredClone(state) as Partial<SessionState>;
    delete legacy.participantMeters;
    legacy.meters = { relationship: 60, margin: 62, risk: 38 };
    return legacy as SessionState;
  }

  it('normaliza asignando a cada participante los indicadores globales antiguos', () => {
    const legacy = legacyState();
    const normalized = normalizeState(legacy);
    expect(normalized.participantMeters).toEqual({ [ana.id]: legacy.meters, [beto.id]: legacy.meters });
    expect(normalizeState(normalized)).toBe(normalized);
    expect(legacy).not.toHaveProperty('participantMeters');
  });

  it('applyCommand, expireTimer, los informes y la vista funcionan con un estado antiguo', () => {
    const legacy = legacyState();
    expect(performanceReport(legacy)).toMatchObject({ meters: { relationship: 60, margin: 62, risk: 38 }, participants: 2 });
    expect(performanceReport(legacy, beto.id).meters).toEqual({ relationship: 60, margin: 62, risk: 38 });
    expect(participantView(legacy, ana.id).meters).toEqual({ relationship: 60, margin: 62, risk: 38 });

    const decided = apply(legacy, { type: 'decide', optionId: 'threaten-switch' }, beto, 2000);
    expect(decided.participantMeters[beto.id]).toEqual({ relationship: 40, margin: 66, risk: 56 });
    expect(decided.participantMeters[ana.id]).toEqual({ relationship: 60, margin: 62, risk: 38 });
    expect(decided.meters).toEqual({ relationship: 50, margin: 64, risk: 47 });

    const deadline = Date.parse(legacy.phaseDeadline!);
    const expired = expireTimer(legacy, new Date(deadline).toISOString()).state;
    expect(expired.participantMeters[ana.id].risk).toBe(38);
    expect(expired.participantMeters[beto.id].risk).toBe(46);
    // Sin vencimiento pendiente, devuelve el estado ya normalizado.
    expect(expireTimer(legacy, at(1500)).state.participantMeters).toBeDefined();
  });
});
