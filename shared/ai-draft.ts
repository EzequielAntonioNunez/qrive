import { validateScenario } from './scenario';
import type { Choice, ChoiceQuality, MeterName, Meters, Scenario } from './simulation';

/**
 * «Guardar como escenario»: convierte las situaciones generadas en una partida del «Modo IA en vivo» en un BORRADOR
 * de escenario versionado. Es determinista (sin IA) y lo usan el Worker y la demo en navegador. El borrador no se
 * publica aquí: el docente lo revisa y edita antes de publicarlo como cualquier otro escenario.
 *
 * Correspondencias:
 * - Escenario: id `ia-<slug del título>-<6 caracteres de la partida>`, título = enfoque de la partida o nombre de la
 *   colección, personaje VictorIA, indicadores Confianza / Cumplimiento / Riesgo (internos relationship / margin / risk).
 * - Situación → fase `<8 caracteres de la partida>-s<n>` (no coincide con fases del catálogo, así que nunca se le
 *   asocia una locución pregrabada ajena): `title`, `characterLine` = narración, `briefing` = fuentes citadas,
 *   `takeaway` = «por qué» de la mejor opción, `timeLimitSec` 120 y `timeoutRiskDelta` 8.
 * - Opción → `opcion-a…d` con `label`, `consequence`, `rationale`, `quality` y efectos según la valoración de la
 *   DECISIÓN (`AI_EFFECTS`). `skill` = `risk` (contenido de cumplimiento y uso responsable).
 */
export const AI_METER_LABELS: Record<MeterName, string> = { relationship: 'Confianza', margin: 'Cumplimiento', risk: 'Riesgo' };
export const AI_INITIAL_METERS: Meters = { relationship: 50, margin: 50, risk: 50 };
/** Efectos de cada opción según la valoración de la decisión (nunca de la persona). */
export const AI_EFFECTS: Record<ChoiceQuality, Meters> = {
  best: { relationship: 8, margin: 8, risk: -12 },
  acceptable: { relationship: 2, margin: 2, risk: 2 },
  poor: { relationship: -10, margin: -8, risk: 15 }
};
export const AI_DRAFT_TIME_LIMIT = 120;
export const AI_DRAFT_TIMEOUT_RISK = 8;
export const AI_DRAFT_CHARACTER = 'VictorIA';
/** Un escenario para clase necesita al menos dos situaciones. */
export const AI_DRAFT_MIN_PHASES = 2;
export const AI_DRAFT_MAX_PHASES = 8;
/** Longitudes máximas de `shared/scenario.ts` (las usa también el editor para validar en línea). */
export const SCENARIO_LIMITS = {
  title: 120, summary: 400, character: 80, phaseTitle: 80, briefing: 600, characterLine: 600, takeaway: 240,
  label: 160, consequence: 300, rationale: 300, timeMin: 30, timeMax: 3600
} as const;

export interface DraftSituation {
  title: string;
  narration: string;
  options: { label: string; quality: ChoiceQuality; consequence: string; rationale: string }[];
  sources?: { document: string; location?: string | null }[];
}
export interface DraftInput {
  runId: string;
  collectionId: string;
  collectionName: string;
  focus: string | null;
  /** Situaciones previstas en la partida (para avisar si no se generaron todas). */
  total: number;
  situations: DraftSituation[];
  /** Versión que tendrá el borrador (la siguiente a la última publicada con ese id; 1 si no hay). */
  version?: number;
}
export interface DraftResult { draft: Scenario; warnings: string[] }

const OPTION_IDS = ['opcion-a', 'opcion-b', 'opcion-c', 'opcion-d'];

/** Recorta en el último espacio antes de `max` con «…» (o devuelve el texto tal cual si cabe). */
export function clipText(value: string, max: number): string {
  const clean = value.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:.\s]+$/, '')}…`;
}

export function slugify(value: string, max = 40): string {
  const slug = value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ñ/g, 'n')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, max).replace(/-+$/g, '');
  return slug || 'escenario';
}

/** Parte de la partida que identifica sus escenarios: 6 caracteres alfanuméricos en minúsculas. */
export function runShort(runId: string, length = 6): string {
  const clean = runId.toLowerCase().replace(/[^a-z0-9]/g, '');
  return (clean || 'ia0000').slice(0, length).padEnd(length, '0');
}

export function aiScenarioId(runId: string, title: string): string {
  return `ia-${slugify(title)}-${runShort(runId)}`;
}

/** ¿El id es de un escenario generado a partir de esta partida? (el publicador no acepta otro id). */
export function isAiScenarioIdFor(id: string, runId: string): boolean {
  return /^ia-[a-z0-9-]+$/.test(id) && id.endsWith(`-${runShort(runId)}`) && id.length <= 64;
}

const capitalize = (value: string) => value ? value[0].toLocaleUpperCase('es-ES') + value.slice(1) : value;

function firstSentence(value: string): string {
  const match = /^(.+?[.!?])(\s|$)/.exec(value.trim());
  return match ? match[1] : value.trim();
}

function sourcesNote(situation: DraftSituation, collectionName: string): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const source of situation.sources ?? []) {
    const label = source.location ? `${source.document} (${source.location})` : source.document;
    if (seen.has(label)) continue;
    seen.add(label);
    items.push(label);
  }
  return items.length ? `Situación basada en: ${items.join('; ')}.` : `Situación generada a partir de la colección «${collectionName}».`;
}

/**
 * Convierte las situaciones de una partida en un borrador de escenario que valida con `shared/scenario.ts`.
 * Lanza ScenarioError si el resultado no es válido (no debería: todos los textos se recortan a sus límites).
 */
export function draftFromSituations(input: DraftInput): DraftResult {
  const warnings: string[] = [];
  const clipped = new Set<string>();
  const fit = (value: string, max: number, what: string) => {
    const result = clipText(value, max);
    if (result !== value.replace(/\s+/g, ' ').trim()) clipped.add(what);
    return result;
  };
  const situations = input.situations.slice(0, AI_DRAFT_MAX_PHASES);
  if (input.situations.length > AI_DRAFT_MAX_PHASES) warnings.push(`Solo se incluyen las ${AI_DRAFT_MAX_PHASES} primeras situaciones.`);
  if (situations.length < input.total) warnings.push(`La partida tenía ${input.total} situaciones previstas y solo se han generado ${situations.length}: el borrador incluye las generadas.`);
  const base = (input.focus?.trim() ? capitalize(input.focus.trim()) : input.collectionName.trim()) || 'Escenario generado con IA';
  const title = fit(base, SCENARIO_LIMITS.title, 'el título');
  const phasePrefix = runShort(input.runId, 8);
  const phases = situations.map((situation, index) => {
    const options: Choice[] = situation.options.slice(0, 4).map((option, optionIndex) => ({
      id: OPTION_IDS[optionIndex],
      label: fit(option.label, SCENARIO_LIMITS.label, 'opciones'),
      consequence: fit(option.consequence, SCENARIO_LIMITS.consequence, 'consecuencias'),
      effects: { ...AI_EFFECTS[option.quality] },
      skill: 'risk',
      quality: option.quality,
      rationale: fit(option.rationale, SCENARIO_LIMITS.rationale, 'justificaciones')
    }));
    const best = situation.options.find(option => option.quality === 'best');
    if (!best) warnings.push(`La situación ${index + 1} no tiene ninguna opción marcada como mejor.`);
    return {
      id: `${phasePrefix}-s${index + 1}`,
      title: fit(situation.title, SCENARIO_LIMITS.phaseTitle, 'títulos de situación'),
      briefing: fit(sourcesNote(situation, input.collectionName), SCENARIO_LIMITS.briefing, 'contextos'),
      characterLine: fit(situation.narration, SCENARIO_LIMITS.characterLine, 'narraciones'),
      timeLimitSec: AI_DRAFT_TIME_LIMIT,
      timeoutRiskDelta: AI_DRAFT_TIMEOUT_RISK,
      ...(best ? { takeaway: fit(best.rationale.length <= SCENARIO_LIMITS.takeaway ? best.rationale : firstSentence(best.rationale), SCENARIO_LIMITS.takeaway, 'ideas clave') } : {}),
      options
    };
  });
  const titles = phases.map(phase => phase.title);
  const summary = fit(`Situaciones de decisión generadas con IA a partir de «${input.collectionName}»${input.focus?.trim() ? `, centradas en ${input.focus.trim()}` : ''}: ${titles.join(', ')}.`, SCENARIO_LIMITS.summary, 'el resumen');
  for (const what of clipped) warnings.push(`Se han recortado ${what} para respetar la longitud máxima.`);
  warnings.push('Revisa todo el contenido antes de usarlo con estudiantes: lo ha generado una IA y puede contener errores.');
  const draft = validateScenario({
    id: aiScenarioId(input.runId, title),
    version: input.version ?? 1,
    title,
    summary,
    character: { name: AI_DRAFT_CHARACTER },
    initialMeters: { ...AI_INITIAL_METERS },
    meterLabels: { ...AI_METER_LABELS },
    phases,
    origin: { kind: 'ai', runId: input.runId, collectionId: input.collectionId }
  });
  return { draft, warnings };
}

/**
 * Reglas extra para publicar un escenario generado con IA (además de `validateScenario`): al menos dos situaciones,
 * todas las opciones valoradas y con su «por qué», y al menos una mejor opción por situación. Devuelve el primer
 * problema o null.
 */
export function aiScenarioProblem(scenario: Scenario): string | null {
  if (scenario.phases.length < AI_DRAFT_MIN_PHASES) return `Un escenario para clase necesita al menos ${AI_DRAFT_MIN_PHASES} situaciones.`;
  for (const [index, phase] of scenario.phases.entries()) {
    if (phase.options.some(option => !option.quality)) return `Situación ${index + 1}: valora todas las opciones.`;
    if (phase.options.some(option => !option.rationale)) return `Situación ${index + 1}: explica por qué de cada opción.`;
    if (!phase.options.some(option => option.quality === 'best')) return `Situación ${index + 1}: marca al menos una opción como mejor.`;
  }
  return null;
}

/** Efectos según la valoración (el editor los recalcula al cambiar la valoración de una opción). */
export function effectsFor(quality: ChoiceQuality): Meters {
  return { ...AI_EFFECTS[quality] };
}
