import { describe, expect, it } from 'vitest';
import { applyCommand, createSession, expireTimer, type Actor, type Command } from '../shared/engine';
import { catalogScenarios, clampMeter, performanceReport, type Choice, type Phase, type Scenario, type SessionState } from '../shared/simulation';

/**
 * Flujos completos del motor puro para todos los escenarios del catálogo.
 * Se recorre `catalogScenarios` en el momento de ejecutar, así que un escenario nuevo queda cubierto sin tocar este fichero.
 */

const instructor: Actor = { id: 'instructor-1', name: 'Instructor', role: 'instructor' };
const participant: Actor = { id: 'participant-1', name: 'Participante', role: 'participant' };
const other: Actor = { id: 'participant-2', name: 'Otro participante', role: 'participant' };
const colleague: Actor = { id: 'instructor-2', name: 'Otro instructor', role: 'instructor' };
const t0 = Date.parse('2026-10-06T09:00:00.000Z');
const at = (ms: number) => new Date(t0 + ms).toISOString();

/** Comando sin id; distribuye Omit sobre la unión para conservar los campos de cada tipo. */
type CommandBody = Command extends infer C ? (C extends Command ? Omit<C, 'id'> : never) : never;

let commandSeq = 0;
const cmd = (body: CommandBody): Command => ({ id: `cmd-${String(++commandSeq).padStart(6, '0')}`, ...body } as Command);

function bestOption(phase: Phase): Choice {
  return phase.options.find(option => option.quality === 'best') ?? phase.options[0];
}

/** Opción `poor` de mayor riesgo; si la fase no tiene ninguna `poor`, la de mayor riesgo. */
function worstOption(phase: Phase): Choice {
  const poor = phase.options.filter(option => option.quality === 'poor');
  const pool = poor.length ? poor : phase.options;
  return pool.reduce((worst, option) => (option.effects.risk > worst.effects.risk ? option : worst));
}

function apply(state: SessionState, body: CommandBody, actor: Actor, ms: number): SessionState {
  return applyCommand(state, cmd(body), actor, at(ms)).state;
}

/** Recorre la sesión entera con un participante y la opción que devuelva `pick`. */
function playThrough(scenario: Scenario, pick: (phase: Phase) => Choice): SessionState {
  let clock = 0;
  let state = createSession(`s-${scenario.id}`, 'tenant-1', instructor, at(clock), scenario);
  state = apply(state, { type: 'join' }, participant, (clock += 1000));
  scenario.phases.forEach((phase, index) => {
    expect(state.phaseIndex).toBe(index);
    state = apply(state, { type: 'decide', optionId: pick(phase).id }, participant, (clock += 5000));
    if (index < scenario.phases.length - 1) state = apply(state, { type: 'advance' }, instructor, (clock += 1000));
  });
  return apply(state, { type: 'complete' }, instructor, (clock += 1000));
}

describe.each(catalogScenarios.map(scenario => [scenario.id, scenario] as const))('flujo completo del escenario %s', (_id, scenario) => {
  const phases = scenario.phases.length;

  it('tiene en cada fase una opción best y al menos una poor', () => {
    for (const phase of scenario.phases) {
      expect(phase.options.filter(option => option.quality === 'best'), phase.id).toHaveLength(1);
      expect(phase.options.some(option => option.quality === 'poor'), phase.id).toBe(true);
    }
  });

  it('eligiendo siempre la mejor opción obtiene un informe completo y favorable', () => {
    const state = playThrough(scenario, bestOption);
    const report = performanceReport(state);
    expect(state.status).toBe('complete');
    expect(report.decisions).toBe(phases);
    expect(report.participants).toBe(1);
    expect(report.correctDecisionsPct).toBe(100);
    expect(report.criticalDecisions).toBe(0);
    expect(report.timeouts).toBe(0);
    expect(report.objectivesTotal).toBe(3);
    expect(report.objectivesMet).toBeGreaterThanOrEqual(2);
    expect(report.score).toBeGreaterThanOrEqual(60);
    expect(report.completedAt).toBe(state.events.at(-1)?.at);
    expect(report.timeline.map(entry => entry.phaseId)).toEqual(scenario.phases.map(phase => phase.id));
    expect(report.timeline.every(entry => entry.quality === 'best' && !entry.timedOut)).toBe(true);
    // Eventos: inicio, unión, una decisión por fase, avances entre fases y cierre.
    expect(state.events.map(event => event.type)).toEqual([
      'session_started', 'participant_joined',
      ...scenario.phases.flatMap((_, index) => (index < phases - 1 ? ['decision', 'phase_advanced'] : ['decision'])),
      'completed'
    ]);
    expect(state.events.map(event => event.seq)).toEqual(state.events.map((_, index) => index + 1));
  });

  it('eligiendo siempre la peor opción marca todas las decisiones como críticas', () => {
    const worst = performanceReport(playThrough(scenario, worstOption));
    const best = performanceReport(playThrough(scenario, bestOption));
    expect(worst.decisions).toBe(phases);
    expect(worst.criticalDecisions).toBe(phases);
    expect(worst.correctDecisionsPct).toBe(0);
    expect(worst.score).toBeLessThan(best.score);
    expect(worst.objectivesMet).toBeLessThan(best.objectivesMet);
    expect(worst.meters.risk).toBeGreaterThan(best.meters.risk);
  });

  it('la pausa congela el tiempo restante y la reanudación lo conserva, también tras avanzar de fase', () => {
    let state = createSession('s-pause', 'tenant-1', instructor, at(0), scenario);
    state = apply(state, { type: 'join' }, participant, 0);
    scenario.phases.forEach((phase, index) => {
      const phaseStart = Date.parse(state.phaseStartedAt) - t0;
      if (phase.timeLimitSec) {
        const limitMs = phase.timeLimitSec * 1000;
        expect(state.phaseDeadline).toBe(at(phaseStart + limitMs));
        const elapsed = Math.floor(limitMs / 3);
        state = apply(state, { type: 'pause' }, instructor, phaseStart + elapsed);
        expect(state.status).toBe('paused');
        expect(state.phaseDeadline).toBeNull();
        expect(state.phaseRemainingMs).toBe(limitMs - elapsed);
        // Pausada, el temporizador no vence aunque pase mucho tiempo.
        expect(expireTimer(state, at(phaseStart + 10 * limitMs)).events).toEqual([]);
        expect(() => apply(state, { type: 'decide', optionId: bestOption(phase).id }, participant, phaseStart + elapsed + 1)).toThrow('pausada');
        expect(() => apply(state, { type: 'advance' }, instructor, phaseStart + elapsed + 1)).toThrow('Reanuda');
        const resumeAt = phaseStart + elapsed + 3_600_000;
        state = apply(state, { type: 'resume' }, instructor, resumeAt);
        expect(state.status).toBe('active');
        expect(state.phaseRemainingMs).toBeNull();
        expect(state.phaseDeadline).toBe(at(resumeAt + limitMs - elapsed));
      }
      const now = Date.parse(state.phaseStartedAt) - t0 + 1000;
      state = apply(state, { type: 'decide', optionId: bestOption(phase).id }, participant, now);
      if (index < scenario.phases.length - 1) state = apply(state, { type: 'advance' }, instructor, now + 1000);
    });
    expect(performanceReport(state).timeouts).toBe(0);
  });

  it('al vencer el temporizador aplica timeoutRiskDelta una sola vez por fase', () => {
    let clock = 0;
    let state = createSession('s-timeout', 'tenant-1', instructor, at(clock), scenario);
    state = apply(state, { type: 'join' }, participant, clock);
    let timed = 0;
    scenario.phases.forEach((phase, index) => {
      if (phase.timeLimitSec) {
        timed += 1;
        const deadline = Date.parse(state.phaseDeadline!) - t0;
        expect(expireTimer(state, at(deadline - 1)).events).toEqual([]);
        const riskBefore = state.meters.risk;
        const result = expireTimer(state, at(deadline));
        expect(result.events).toMatchObject([{ type: 'timer_expired', actorId: 'system', detail: { phaseId: phase.id, riskDelta: phase.timeoutRiskDelta ?? 0 } }]);
        expect(result.state.meters.risk).toBe(clampMeter(riskBefore + (phase.timeoutRiskDelta ?? 0)));
        expect(result.state.phaseDeadline).toBeNull();
        expect(expireTimer(result.state, at(deadline + 60_000)).events).toEqual([]);
        state = result.state;
        clock = deadline;
      } else {
        expect(state.phaseDeadline).toBeNull();
      }
      // Tras vencer el tiempo aún se puede decidir; el informe lo marca como fuera de tiempo.
      state = apply(state, { type: 'decide', optionId: bestOption(phase).id }, participant, (clock += 1000));
      if (index < scenario.phases.length - 1) state = apply(state, { type: 'advance' }, instructor, (clock += 1000));
    });
    state = apply(state, { type: 'complete' }, instructor, (clock += 1000));
    const report = performanceReport(state);
    expect(report.timeouts).toBe(timed);
    expect(report.timeline.map(entry => entry.timedOut)).toEqual(scenario.phases.map(phase => Boolean(phase.timeLimitSec)));
  });

  it('un participante no puede decidir dos veces en la misma fase, pero otro participante sí decide', () => {
    let state = createSession('s-twice', 'tenant-1', instructor, at(0), scenario);
    state = apply(state, { type: 'join' }, participant, 0);
    state = apply(state, { type: 'join' }, other, 0);
    const [phase] = scenario.phases;
    state = apply(state, { type: 'decide', optionId: bestOption(phase).id }, participant, 1000);
    for (const option of phase.options) {
      expect(() => apply(state, { type: 'decide', optionId: option.id }, participant, 2000)).toThrow('Ya has decidido');
    }
    state = apply(state, { type: 'decide', optionId: worstOption(phase).id }, other, 3000);
    expect(state.decisions.map(decision => decision.userId)).toEqual([participant.id, other.id]);
    expect(() => apply(state, { type: 'decide', optionId: 'no-existe' }, { ...other, id: 'participant-3' }, 4000)).toThrow('unirte');
    expect(() => apply(state, { type: 'decide', optionId: bestOption(phase).id }, instructor, 4000)).toThrow('unirte');
    expect(() => apply(state, { type: 'join' }, instructor, 4000)).toThrow('participante');
    if (scenario.phases.length > 1) {
      state = apply(state, { type: 'advance' }, instructor, 5000);
      // En la fase siguiente vuelve a poder decidir, pero no con una opción de otra fase.
      const foreign = phase.options.find(option => !scenario.phases[1].options.some(item => item.id === option.id));
      if (foreign) expect(() => apply(state, { type: 'decide', optionId: foreign.id }, participant, 6000)).toThrow('Opción no válida');
      state = apply(state, { type: 'decide', optionId: bestOption(scenario.phases[1]).id }, participant, 6000);
      // Modo individual: quien llega tarde puede unirse y empieza en la fase actual, sin decisiones previas.
      const late: Actor = { ...other, id: 'participant-late' };
      state = apply(state, { type: 'join' }, late, 7000);
      expect(state.participantMeters[late.id]).toEqual(scenario.initialMeters);
      expect(state.decisions.some(decision => decision.userId === late.id)).toBe(false);
    }
  });

  it('solo el instructor de la sesión puede avanzar, pausar, reanudar, finalizar o ajustar indicadores', () => {
    let state = createSession('s-roles', 'tenant-1', instructor, at(0), scenario);
    state = apply(state, { type: 'join' }, participant, 0);
    state = apply(state, { type: 'decide', optionId: bestOption(scenario.phases[0]).id }, participant, 1000);
    const control: CommandBody[] = [
      { type: 'advance' }, { type: 'pause' }, { type: 'complete' },
      { type: 'incident', note: 'Corte de luz', riskDelta: 5 },
      { type: 'set-meter', meter: 'risk', value: 10 }
    ];
    for (const actor of [participant, colleague]) {
      for (const body of control) expect(() => apply(state, body, actor, 2000), `${actor.id} ${body.type}`).toThrow('reservada');
    }
    const paused = apply(state, { type: 'pause' }, instructor, 2000);
    expect(() => apply(paused, { type: 'resume' }, participant, 3000)).toThrow('reservada');
    expect(apply(paused, { type: 'resume' }, instructor, 3000).status).toBe('active');
    expect(() => createSession('x', 'tenant-1', participant, at(0), scenario)).toThrow('instructor');
  });

  it('los comandos son idempotentes por id, incluido el cierre', () => {
    let state = createSession('s-idem', 'tenant-1', instructor, at(0), scenario);
    const join: Command = { id: 'join-000001', type: 'join' };
    state = applyCommand(state, join, participant, at(0)).state;
    const replayJoin = applyCommand(state, join, participant, at(500));
    expect(replayJoin.state).toBe(state);
    expect(replayJoin.events).toEqual([]);

    const decide: Command = { id: 'decide-000001', type: 'decide', optionId: worstOption(scenario.phases[0]).id };
    state = applyCommand(state, decide, participant, at(1000)).state;
    const meters = { ...state.meters };
    // Un reintento con el mismo id no aplica dos veces los efectos aunque cambie el contenido.
    const replay = applyCommand(state, { ...decide, optionId: bestOption(scenario.phases[0]).id }, participant, at(2000));
    expect(replay.events).toEqual([]);
    expect(replay.state.meters).toEqual(meters);
    expect(replay.state.decisions).toHaveLength(1);
    expect(state.processedCommands).toEqual(['join-000001', 'decide-000001']);

    // Un comando rechazado no queda registrado y no bloquea otros ids.
    expect(() => applyCommand(state, { id: 'advance-bad01', type: 'advance' }, participant, at(3000))).toThrow();
    expect(state.processedCommands).not.toContain('advance-bad01');

    scenario.phases.forEach((phase, index) => {
      if (index === 0) return;
      state = apply(state, { type: 'advance' }, instructor, 3000 + index * 2000);
      state = apply(state, { type: 'decide', optionId: bestOption(phase).id }, participant, 4000 + index * 2000);
    });
    const complete: Command = { id: 'complete-000001', type: 'complete' };
    state = applyCommand(state, complete, instructor, at(60_000)).state;
    expect(state.status).toBe('complete');
    const replayComplete = applyCommand(state, complete, instructor, at(61_000));
    expect(replayComplete.state).toBe(state);
    expect(replayComplete.events).toEqual([]);
    expect(() => applyCommand(state, { id: 'complete-000002', type: 'complete' }, instructor, at(62_000))).toThrow('terminó');
    expect(state.events.filter(event => event.type === 'completed')).toHaveLength(1);
  });

  it('no permite avanzar sin decisiones ni más allá de la última fase', () => {
    let state = createSession('s-order', 'tenant-1', instructor, at(0), scenario);
    state = apply(state, { type: 'join' }, participant, 0);
    scenario.phases.forEach((phase, index) => {
      expect(() => apply(state, { type: 'advance' }, instructor, 1000)).toThrow('al menos una decisión');
      state = apply(state, { type: 'decide', optionId: bestOption(phase).id }, participant, 2000 + index * 2000);
      if (index < scenario.phases.length - 1) state = apply(state, { type: 'advance' }, instructor, 3000 + index * 2000);
    });
    expect(() => apply(state, { type: 'advance' }, instructor, 99_000)).toThrow('última fase');
    state = apply(state, { type: 'complete' }, instructor, 99_500);
    expect(state.events.at(-1)).toMatchObject({ type: 'completed', detail: { early: false } });
  });

  it('el docente puede finalizar antes de tiempo, también en pausa y sin decisiones', () => {
    let state = createSession('s-early', 'tenant-1', instructor, at(0), scenario);
    state = apply(state, { type: 'join' }, participant, 0);
    state = apply(state, { type: 'pause' }, instructor, 1000);
    state = apply(state, { type: 'complete' }, instructor, 2000);
    expect(state.status).toBe('complete');
    expect(state.phaseDeadline).toBeNull();
    expect(state.events.at(-1)).toMatchObject({ type: 'completed', detail: { early: true } });
    expect(() => apply(state, { type: 'decide', optionId: bestOption(scenario.phases[0]).id }, participant, 3000)).toThrow('terminó');
    expect(() => apply(createSession('s-p', 'tenant-1', instructor, at(0), scenario), { type: 'complete' }, participant, 1000)).toThrow('instructor');
  });
});

describe('casos límite del temporizador', () => {
  const scenario = catalogScenarios.find(item => item.phases[0].timeLimitSec && item.phases[0].timeoutRiskDelta) ?? catalogScenarios[0];
  const limitMs = (scenario.phases[0].timeLimitSec ?? 0) * 1000;

  it('no arranca el temporizador hasta que se une el primer participante, aunque se pause antes', () => {
    let state = createSession('s-prejoin', 'tenant-1', instructor, at(0), scenario);
    state = apply(state, { type: 'pause' }, instructor, 1000);
    expect(state.phaseRemainingMs).toBeNull();
    state = apply(state, { type: 'join' }, participant, 2000);
    expect(state.phaseDeadline).toBeNull();
    state = apply(state, { type: 'resume' }, instructor, 5000);
    expect(state.phaseDeadline).toBe(scenario.phases[0].timeLimitSec ? at(5000 + limitMs) : null);
  });

  it('tras vencer el tiempo, pausar y reanudar no reinicia el temporizador de la fase', () => {
    if (!limitMs) return;
    let state = createSession('s-expired-pause', 'tenant-1', instructor, at(0), scenario);
    state = apply(state, { type: 'join' }, participant, 0);
    state = expireTimer(state, at(limitMs)).state;
    state = apply(state, { type: 'pause' }, instructor, limitMs + 1000);
    state = apply(state, { type: 'resume' }, instructor, limitMs + 2000);
    expect(state.phaseDeadline).toBeNull();
    expect(performanceReport(state).timeouts).toBe(1);
  });

  // Regresión: pausar con el plazo vencido pero antes de la alarma dejaba phaseRemainingMs en 0 y, al reanudar,
  // la fase nunca vencía. Ahora 0 cuenta como vencido y la penalización se aplica al reanudar.
  it('pausar con el plazo ya agotado (antes de que salte la alarma) no evita la penalización por tiempo', () => {
    if (!limitMs) throw new Error('El escenario no tiene temporizador');
    let state = createSession('s-late-pause', 'tenant-1', instructor, at(0), scenario);
    state = apply(state, { type: 'join' }, participant, 0);
    state = apply(state, { type: 'pause' }, instructor, limitMs + 500);
    state = apply(state, { type: 'resume' }, instructor, limitMs + 60_000);
    const expired = expireTimer(state, at(limitMs + 60_000));
    const timeouts = expired.state.events.filter(event => event.type === 'timer_expired').length;
    expect(timeouts).toBe(1);
  });
});
