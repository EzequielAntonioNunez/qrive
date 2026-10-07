import type { Choice, Meters, Phase, Scenario } from './simulation';

/** Error de validación con la ruta del campo, para que el autor del escenario sepa qué corregir. */
export class ScenarioError extends Error {}

const ID = /^[a-z0-9][a-z0-9-]{1,63}$/;
/** IDs seudónimos de procedencia (partida y colección del modo IA en vivo). */
const REF = /^[A-Za-z0-9][A-Za-z0-9-]{0,79}$/;
const meterNames = ['relationship', 'margin', 'risk'] as const;

function text(value: unknown, path: string, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ScenarioError(`${path}: texto obligatorio de hasta ${max} caracteres.`);
  return value.trim();
}

function int(value: unknown, path: string, min: number, max: number): number {
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) throw new ScenarioError(`${path}: entero entre ${min} y ${max}.`);
  return value as number;
}

function quality(value: unknown, path: string): NonNullable<Choice['quality']> {
  if (value !== 'best' && value !== 'acceptable' && value !== 'poor') throw new ScenarioError(`${path}: best, acceptable o poor.`);
  return value;
}

function id(value: unknown, path: string): string {
  if (typeof value !== 'string' || !ID.test(value)) throw new ScenarioError(`${path}: identificador en minúsculas, números y guiones.`);
  return value;
}

function meters(value: unknown, path: string, min: number, max: number): Meters {
  if (!value || typeof value !== 'object') throw new ScenarioError(`${path}: objeto obligatorio.`);
  const data = value as Record<string, unknown>;
  return { relationship: int(data.relationship, `${path}.relationship`, min, max), margin: int(data.margin, `${path}.margin`, min, max), risk: int(data.risk, `${path}.risk`, min, max) };
}

/**
 * Valida y normaliza una definición de escenario. Todo escenario que entra en D1 pasa por aquí,
 * incluido el escenario de catálogo, así que el motor nunca recibe datos sin validar.
 */
export function validateScenario(value: unknown): Scenario {
  if (!value || typeof value !== 'object') throw new ScenarioError('El escenario debe ser un objeto JSON.');
  const data = value as Record<string, unknown>;
  const character = data.character as Record<string, unknown> | undefined;
  if (!Array.isArray(data.phases) || data.phases.length < 1 || data.phases.length > 8) throw new ScenarioError('phases: entre 1 y 8 fases.');
  const phaseIds = new Set<string>();
  const phases: Phase[] = data.phases.map((raw, index) => {
    const path = `phases[${index}]`;
    const phase = raw as Record<string, unknown>;
    const phaseId = id(phase.id, `${path}.id`);
    if (phaseIds.has(phaseId)) throw new ScenarioError(`${path}.id: repetido.`);
    phaseIds.add(phaseId);
    if (!Array.isArray(phase.options) || phase.options.length < 2 || phase.options.length > 4) throw new ScenarioError(`${path}.options: entre 2 y 4 opciones.`);
    const optionIds = new Set<string>();
    const options: Choice[] = phase.options.map((rawOption, optionIndex) => {
      const optionPath = `${path}.options[${optionIndex}]`;
      const option = rawOption as Record<string, unknown>;
      const optionId = id(option.id, `${optionPath}.id`);
      if (optionIds.has(optionId)) throw new ScenarioError(`${optionPath}.id: repetido.`);
      optionIds.add(optionId);
      if (!['preparation', 'negotiation', 'risk'].includes(String(option.skill))) throw new ScenarioError(`${optionPath}.skill: preparation, negotiation o risk.`);
      return {
        id: optionId,
        label: text(option.label, `${optionPath}.label`, 160),
        consequence: text(option.consequence, `${optionPath}.consequence`, 300),
        effects: meters(option.effects, `${optionPath}.effects`, -50, 50),
        skill: option.skill as Choice['skill'],
        ...(option.quality === undefined ? {} : { quality: quality(option.quality, `${optionPath}.quality`) }),
        ...(option.rationale === undefined ? {} : { rationale: text(option.rationale, `${optionPath}.rationale`, 300) })
      };
    });
    const result: Phase = {
      id: phaseId,
      title: text(phase.title, `${path}.title`, 80),
      briefing: text(phase.briefing, `${path}.briefing`, 600),
      characterLine: text(phase.characterLine, `${path}.characterLine`, 600),
      options
    };
    if (phase.timeLimitSec !== undefined) result.timeLimitSec = int(phase.timeLimitSec, `${path}.timeLimitSec`, 30, 3600);
    if (phase.timeoutRiskDelta !== undefined) result.timeoutRiskDelta = int(phase.timeoutRiskDelta, `${path}.timeoutRiskDelta`, 0, 50);
    if (phase.takeaway !== undefined) result.takeaway = text(phase.takeaway, `${path}.takeaway`, 240);
    return result;
  });
  const scenario: Scenario = {
    id: id(data.id, 'id'),
    version: int(data.version, 'version', 1, 100000),
    title: text(data.title, 'title', 120),
    summary: text(data.summary, 'summary', 400),
    character: { name: text(character?.name, 'character.name', 80) },
    initialMeters: meters(data.initialMeters, 'initialMeters', 0, 100),
    phases
  };
  if (data.meterLabels !== undefined) {
    const labels = data.meterLabels as Record<string, unknown> | null;
    if (!labels || typeof labels !== 'object') throw new ScenarioError('meterLabels: objeto con relationship, margin y risk.');
    scenario.meterLabels = {
      relationship: text(labels.relationship, 'meterLabels.relationship', 24),
      margin: text(labels.margin, 'meterLabels.margin', 24),
      risk: text(labels.risk, 'meterLabels.risk', 24)
    };
  }
  if (data.origin !== undefined) {
    const origin = data.origin as Record<string, unknown> | null;
    const ref = (value: unknown, path: string) => {
      if (typeof value !== 'string' || !REF.test(value)) throw new ScenarioError(`${path}: identificador no válido.`);
      return value;
    };
    if (!origin || typeof origin !== 'object' || origin.kind !== 'ai') throw new ScenarioError('origin: objeto con kind "ai", runId y collectionId.');
    scenario.origin = { kind: 'ai', runId: ref(origin.runId, 'origin.runId'), collectionId: ref(origin.collectionId, 'origin.collectionId') };
  }
  return scenario;
}

export { meterNames };
