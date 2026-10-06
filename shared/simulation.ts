import type { SimEventType } from './events';

export type MeterName = 'relationship' | 'margin' | 'risk';
export type Meters = Record<MeterName, number>;

export interface Choice {
  id: string;
  label: string;
  consequence: string;
  effects: Meters;
  skill: 'preparation' | 'negotiation' | 'risk';
  /** Valoración de diseño de la opción para el debriefing. No mide a la persona, solo la decisión. */
  quality?: ChoiceQuality;
}

export type ChoiceQuality = 'best' | 'acceptable' | 'poor';

export interface Phase {
  id: string;
  title: string;
  briefing: string;
  options: Choice[];
  /** Lo que dice el personaje al abrir la fase. Unity lo muestra y lo locuta. */
  characterLine: string;
  /** Tiempo disponible para la fase. Sin valor, la fase no tiene temporizador. */
  timeLimitSec?: number;
  /** Consecuencia en riesgo cuando el temporizador vence sin cerrar la fase. */
  timeoutRiskDelta?: number;
}

export interface Scenario {
  id: string;
  version: number;
  title: string;
  summary: string;
  character: { name: string };
  initialMeters: Meters;
  /** Nombre visible de cada indicador en este escenario. Sin valor: Relación, Margen y Riesgo. */
  meterLabels?: Record<MeterName, string>;
  phases: Phase[];
}

export const defaultMeterLabels: Record<MeterName, string> = { relationship: 'Relación', margin: 'Margen', risk: 'Riesgo' };

export function meterLabels(scenario: Scenario): Record<MeterName, string> {
  return scenario.meterLabels ?? defaultMeterLabels;
}

export type SessionStatus = 'active' | 'paused' | 'complete';

export interface Participant {
  userId: string;
  name: string;
  joinedAt: string;
}

export interface Decision {
  userId: string;
  phaseId: string;
  optionId: string;
  at: string;
  durationMs: number;
}

export interface SimEvent {
  seq: number;
  type: SimEventType;
  at: string;
  actorId: string;
  detail: Record<string, string | number | boolean>;
}

export interface SessionState {
  id: string;
  tenantId: string;
  instructorId: string;
  scenario: Scenario;
  status: SessionStatus;
  phaseIndex: number;
  phaseStartedAt: string;
  /** Fin del temporizador de la fase activa (ISO). Null si no corre. */
  phaseDeadline?: string | null;
  /** Tiempo restante congelado mientras la sesión está pausada. */
  phaseRemainingMs?: number | null;
  meters: Meters;
  participants: Participant[];
  decisions: Decision[];
  events: SimEvent[];
  processedCommands: string[];
  pendingEvents: SimEvent[];
  createdAt: string;
}

export interface PerformanceReport {
  score: number;
  decisions: number;
  participants: number;
  avgReactionMs: number;
  objectivesMet: number;
  objectivesTotal: number;
  timeouts: number;
  /** % de decisiones valoradas como la mejor opción. Null si el escenario no valora opciones. */
  correctDecisionsPct: number | null;
  /** % medio de tiempo sobrante al decidir respecto al límite de la fase. Null sin temporizadores. */
  reactionPct: number | null;
  objectivesPct: number;
  criticalDecisions: number;
  timeline: DebriefEntry[];
  meters: Meters;
  completedAt: string | null;
}

export interface DebriefEntry {
  phaseId: string;
  phaseTitle: string;
  userId: string;
  optionId: string;
  label: string;
  consequence: string;
  quality: ChoiceQuality | null;
  durationMs: number;
  timedOut: boolean;
}

export const negotiationScenario: Scenario = {
  id: 'supplier-negotiation',
  version: 3,
  title: 'Renegociación con un proveedor estratégico',
  summary: 'Negocia un contrato de tres años sin comprometer la continuidad del suministro ni el margen.',
  character: { name: 'Elena Vega' },
  initialMeters: { relationship: 50, margin: 50, risk: 50 },
  phases: [
    {
      id: 'prepare',
      title: 'Preparación',
      briefing: 'El proveedor solicita una subida del 12 %. Tu equipo dispone de otra oferta, pero cambiar de proveedor retrasaría la operación. Quedan ocho minutos para fijar una postura.',
      characterLine: 'Gracias por venir. Nuestros costes han subido y necesitamos revisar el precio. Si encontramos una propuesta equilibrada, podremos seguir trabajando juntos.',
      timeLimitSec: 480,
      timeoutRiskDelta: 8,
      options: [
        { id: 'ask-data', label: 'Pedir desglose de costes y confirmar alternativas.', consequence: 'Obtienes una base objetiva antes de negociar y conservas margen de maniobra.', effects: { relationship: 5, margin: 8, risk: -10 }, skill: 'preparation', quality: 'best' },
        { id: 'accept-increase', label: 'Aceptar la subida para evitar conflicto.', consequence: 'El proveedor se tranquiliza, pero el coste compromete el margen.', effects: { relationship: 12, margin: -22, risk: 5 }, skill: 'risk', quality: 'poor' },
        { id: 'threaten-switch', label: 'Amenazar con cambiar de proveedor.', consequence: 'La presión genera resistencia y aumenta el riesgo de ruptura.', effects: { relationship: -20, margin: 4, risk: 18 }, skill: 'negotiation', quality: 'poor' }
      ]
    },
    {
      id: 'counteroffer',
      title: 'Contraoferta',
      briefing: 'El proveedor admite que podría reducir la subida si obtiene un compromiso de tres años. Existe una oferta alternativa, pero aún no está validada.',
      characterLine: 'Podría reducir la subida si acordamos tres años de colaboración. Necesito saber qué garantías y compromisos estaríais dispuestos a aceptar.',
      timeLimitSec: 300,
      timeoutRiskDelta: 8,
      options: [
        { id: 'three-year-eight', label: 'Proponer un 8 % y contrato de tres años sujeto a hitos.', consequence: 'El acuerdo reparte el riesgo y protege parte del margen.', effects: { relationship: 10, margin: 10, risk: -12 }, skill: 'negotiation', quality: 'best' },
        { id: 'demand-zero', label: 'Exigir que no haya ninguna subida.', consequence: 'El proveedor duda de que exista una salida negociada.', effects: { relationship: -16, margin: 14, risk: 18 }, skill: 'negotiation', quality: 'poor' },
        { id: 'accept-twelve', label: 'Aceptar el 12 % a cambio de una renovación inmediata.', consequence: 'Aseguras suministro a un coste elevado.', effects: { relationship: 12, margin: -18, risk: -3 }, skill: 'risk', quality: 'acceptable' }
      ]
    },
    {
      id: 'close',
      title: 'Cierre',
      briefing: 'El proveedor pide una decisión final y una forma de comprobar los compromisos durante el contrato.',
      characterLine: 'Estamos cerca de un acuerdo. Para cerrarlo hoy, necesito una decisión final y una forma clara de comprobar que cumplimos los compromisos.',
      timeLimitSec: 240,
      timeoutRiskDelta: 10,
      options: [
        { id: 'milestones', label: 'Cerrar con hitos trimestrales y cláusula de revisión.', consequence: 'Queda un mecanismo claro para detectar y corregir problemas.', effects: { relationship: 8, margin: 6, risk: -16 }, skill: 'risk', quality: 'best' },
        { id: 'verbal', label: 'Cerrar verbalmente y redactar los detalles más adelante.', consequence: 'La ambigüedad puede generar disputas.', effects: { relationship: 3, margin: 0, risk: 16 }, skill: 'risk', quality: 'poor' },
        { id: 'walk-away', label: 'Abandonar la mesa y activar la alternativa sin verificar.', consequence: 'Conservas poder negociador, pero expones la continuidad.', effects: { relationship: -18, margin: 7, risk: 25 }, skill: 'risk', quality: 'poor' }
      ]
    }
  ]
};

/**
 * Escenario principal del catálogo UFV: decisiones prácticas sobre IA generativa en el trabajo académico.
 * La valoración `quality` es de la decisión según la política de uso responsable, nunca de la persona.
 */
export const aiPracticesScenario: Scenario = {
  id: 'ia-buenas-practicas',
  version: 2,
  title: 'Uso responsable de la IA en la universidad',
  summary: 'Decide cómo aplicar la IA generativa en situaciones reales del trabajo académico: datos personales, verificación de resultados y evaluación justa.',
  character: { name: 'VictorIA' },
  initialMeters: { relationship: 50, margin: 50, risk: 50 },
  meterLabels: { relationship: 'Confianza', margin: 'Productividad', risk: 'Riesgo' },
  phases: [
    {
      id: 'datos-personales',
      title: 'Datos personales',
      briefing: 'VictorIA coordina la calidad académica del grado. Tiene las notas y los comentarios de 120 alumnos en una hoja de cálculo y quiere un informe individual para cada uno antes del viernes.',
      characterLine: 'Tengo las notas y los comentarios de todos los alumnos en una hoja de cálculo. Si la pego en un chat de inteligencia artificial, nos redacta los informes en un momento. ¿Lo hacemos así?',
      timeLimitSec: 180,
      timeoutRiskDelta: 8,
      options: [
        { id: 'anonimizar', label: 'Anonimizar los datos y usar solo la herramienta de IA autorizada por la universidad.', consequence: 'Ahorras tiempo sin exponer datos personales: cumples el RGPD y la política de la universidad.', effects: { relationship: 8, margin: 6, risk: -14 }, skill: 'risk', quality: 'best' },
        { id: 'pegar-todo', label: 'Pegar la hoja completa en un chat de IA público.', consequence: 'Los datos de los alumnos salen a un servicio externo sin base legal: es una brecha de confidencialidad.', effects: { relationship: -15, margin: 8, risk: 25 }, skill: 'risk', quality: 'poor' },
        { id: 'a-mano', label: 'Renunciar a la IA y redactar todos los informes a mano.', consequence: 'No hay riesgo, pero pierdes días de trabajo que una IA bien usada te habría ahorrado.', effects: { relationship: 2, margin: -12, risk: -4 }, skill: 'preparation', quality: 'acceptable' }
      ]
    },
    {
      id: 'verificacion',
      title: 'Verificación',
      briefing: 'La IA ha resumido la nueva normativa de evaluación con tres referencias legales. El resumen se enviará al claustro esta tarde.',
      characterLine: 'La inteligencia artificial me ha preparado un resumen de la nueva normativa con tres referencias legales. Suena muy convincente. ¿Lo enviamos tal cual al claustro?',
      timeLimitSec: 180,
      timeoutRiskDelta: 8,
      options: [
        { id: 'contrastar', label: 'Comprobar cada referencia en la fuente oficial antes de enviarlo.', consequence: 'Detectas una referencia inventada y la corriges: el documento que llega al claustro es fiable.', effects: { relationship: 10, margin: 4, risk: -14 }, skill: 'preparation', quality: 'best' },
        { id: 'enviar', label: 'Enviarlo tal cual: la IA suele acertar.', consequence: 'Una de las referencias no existe. El claustro pierde la confianza en el documento.', effects: { relationship: -18, margin: 6, risk: 20 }, skill: 'risk', quality: 'poor' },
        { id: 'autoverificar', label: 'Pedir a la misma IA que confirme que las referencias son correctas.', consequence: 'La IA confirma sus propios errores: sigues sin una verificación real.', effects: { relationship: -6, margin: 4, risk: 12 }, skill: 'preparation', quality: 'poor' },
        { id: 'borrador', label: 'Enviarlo como borrador generado con IA pendiente de revisión.', consequence: 'Eres transparente, pero trasladas a otros una verificación que te corresponde.', effects: { relationship: 2, margin: 2, risk: 4 }, skill: 'negotiation', quality: 'acceptable' }
      ]
    },
    {
      id: 'evaluacion',
      title: 'Evaluación justa',
      briefing: 'Un detector señala que un trabajo de fin de grado tiene un 80 % de probabilidad de estar escrito con IA. La guía docente permite usar IA si se declara.',
      characterLine: 'Un detector dice que este trabajo tiene un ochenta por ciento de probabilidad de estar hecho con inteligencia artificial. ¿Lo suspendemos directamente?',
      timeLimitSec: 180,
      timeoutRiskDelta: 10,
      options: [
        { id: 'dialogar', label: 'Revisar el trabajo, hablar con el alumno y aplicar la guía docente.', consequence: 'Decides con evidencias y con garantías: el detector es un indicio, no una prueba.', effects: { relationship: 12, margin: 4, risk: -14 }, skill: 'negotiation', quality: 'best' },
        { id: 'suspender', label: 'Suspender basándote solo en el detector.', consequence: 'Los detectores se equivocan con frecuencia: arriesgas una decisión injusta y una reclamación.', effects: { relationship: -20, margin: 2, risk: 22 }, skill: 'risk', quality: 'poor' },
        { id: 'ignorar', label: 'Ignorarlo: no hay forma de saberlo.', consequence: 'Evitas el conflicto, pero la guía docente queda sin aplicar.', effects: { relationship: -6, margin: 0, risk: 10 }, skill: 'negotiation', quality: 'poor' }
      ]
    }
  ]
};

/** Escenarios incluidos en el código y publicados en D1; el primero es el que se usa por defecto. */
export const catalogScenarios: Scenario[] = [aiPracticesScenario, negotiationScenario];
export const defaultScenario = aiPracticesScenario;

export function clampMeter(value: number): number {
  return Math.max(0, Math.min(100, value));
}

export function applyChoice(meters: Meters, choice: Choice): Meters {
  return {
    relationship: clampMeter(meters.relationship + choice.effects.relationship),
    margin: clampMeter(meters.margin + choice.effects.margin),
    risk: clampMeter(meters.risk + choice.effects.risk)
  };
}

export function performanceReport(state: SessionState): PerformanceReport {
  const objectivesMet = Number(state.meters.relationship >= 55) + Number(state.meters.margin >= 55) + Number(state.meters.risk <= 40);
  const score = Math.round((state.meters.relationship + state.meters.margin + (100 - state.meters.risk)) / 3);
  const timeline: DebriefEntry[] = state.decisions.map(decision => {
    const phase = state.scenario.phases.find(item => item.id === decision.phaseId);
    const option = phase?.options.find(item => item.id === decision.optionId);
    return {
      phaseId: decision.phaseId, phaseTitle: phase?.title ?? decision.phaseId, userId: decision.userId, optionId: decision.optionId,
      label: option?.label ?? decision.optionId, consequence: option?.consequence ?? '', quality: option?.quality ?? null,
      durationMs: decision.durationMs,
      timedOut: state.events.some(event => event.type === 'timer_expired' && event.detail.phaseId === decision.phaseId && Date.parse(event.at) <= Date.parse(decision.at))
    };
  });
  const rated = timeline.filter(entry => entry.quality !== null);
  const timed = timeline.flatMap(entry => {
    const limit = state.scenario.phases.find(item => item.id === entry.phaseId)?.timeLimitSec;
    return limit ? [Math.max(0, Math.min(100, 100 - (100 * entry.durationMs) / (limit * 1000)))] : [];
  });
  const avgReactionMs = state.decisions.length
    ? Math.round(state.decisions.reduce((sum, decision) => sum + decision.durationMs, 0) / state.decisions.length)
    : 0;
  return {
    score,
    decisions: state.decisions.length,
    participants: state.participants.length,
    avgReactionMs,
    objectivesMet,
    objectivesTotal: 3,
    timeouts: state.events.filter(event => event.type === 'timer_expired').length,
    correctDecisionsPct: rated.length ? Math.round(100 * rated.filter(entry => entry.quality === 'best').length / rated.length) : null,
    reactionPct: timed.length ? Math.round(timed.reduce((sum, value) => sum + value, 0) / timed.length) : null,
    objectivesPct: Math.round(100 * objectivesMet / 3),
    criticalDecisions: timeline.filter(entry => entry.quality === 'poor').length,
    timeline,
    meters: { ...state.meters },
    completedAt: state.status === 'complete' ? state.events.findLast(event => event.type === 'completed')?.at ?? null : null
  };
}
