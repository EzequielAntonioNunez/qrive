export type MeterName = 'relationship' | 'margin' | 'risk';
export type Meters = Record<MeterName, number>;

export interface Choice {
  id: string;
  label: string;
  consequence: string;
  effects: Meters;
  skill: 'preparation' | 'negotiation' | 'risk';
}

export interface Phase {
  id: string;
  title: string;
  briefing: string;
  options: Choice[];
}

export interface Scenario {
  id: string;
  version: number;
  title: string;
  summary: string;
  initialMeters: Meters;
  phases: Phase[];
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
  type: 'session_started' | 'participant_joined' | 'decision' | 'phase_advanced' | 'paused' | 'resumed' | 'incident' | 'completed';
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
  meters: Meters;
  completedAt: string | null;
}

export const negotiationScenario: Scenario = {
  id: 'supplier-negotiation',
  version: 1,
  title: 'Renegociación con un proveedor estratégico',
  summary: 'Negocia un contrato de tres años sin comprometer la continuidad del suministro ni el margen.',
  initialMeters: { relationship: 50, margin: 50, risk: 50 },
  phases: [
    {
      id: 'prepare',
      title: 'Preparación',
      briefing: 'El proveedor solicita una subida del 12 %. Tu equipo dispone de otra oferta, pero cambiar de proveedor retrasaría la operación. Quedan ocho minutos para fijar una postura.',
      options: [
        { id: 'ask-data', label: 'Pedir desglose de costes y confirmar alternativas.', consequence: 'Obtienes una base objetiva antes de negociar y conservas margen de maniobra.', effects: { relationship: 5, margin: 8, risk: -10 }, skill: 'preparation' },
        { id: 'accept-increase', label: 'Aceptar la subida para evitar conflicto.', consequence: 'El proveedor se tranquiliza, pero el coste compromete el margen.', effects: { relationship: 12, margin: -22, risk: 5 }, skill: 'risk' },
        { id: 'threaten-switch', label: 'Amenazar con cambiar de proveedor.', consequence: 'La presión genera resistencia y aumenta el riesgo de ruptura.', effects: { relationship: -20, margin: 4, risk: 18 }, skill: 'negotiation' }
      ]
    },
    {
      id: 'counteroffer',
      title: 'Contraoferta',
      briefing: 'El proveedor admite que podría reducir la subida si obtiene un compromiso de tres años. Existe una oferta alternativa, pero aún no está validada.',
      options: [
        { id: 'three-year-eight', label: 'Proponer un 8 % y contrato de tres años sujeto a hitos.', consequence: 'El acuerdo reparte el riesgo y protege parte del margen.', effects: { relationship: 10, margin: 10, risk: -12 }, skill: 'negotiation' },
        { id: 'demand-zero', label: 'Exigir que no haya ninguna subida.', consequence: 'El proveedor duda de que exista una salida negociada.', effects: { relationship: -16, margin: 14, risk: 18 }, skill: 'negotiation' },
        { id: 'accept-twelve', label: 'Aceptar el 12 % a cambio de una renovación inmediata.', consequence: 'Aseguras suministro a un coste elevado.', effects: { relationship: 12, margin: -18, risk: -3 }, skill: 'risk' }
      ]
    },
    {
      id: 'close',
      title: 'Cierre',
      briefing: 'El proveedor pide una decisión final y una forma de comprobar los compromisos durante el contrato.',
      options: [
        { id: 'milestones', label: 'Cerrar con hitos trimestrales y cláusula de revisión.', consequence: 'Queda un mecanismo claro para detectar y corregir problemas.', effects: { relationship: 8, margin: 6, risk: -16 }, skill: 'risk' },
        { id: 'verbal', label: 'Cerrar verbalmente y redactar los detalles más adelante.', consequence: 'La ambigüedad puede generar disputas.', effects: { relationship: 3, margin: 0, risk: 16 }, skill: 'risk' },
        { id: 'walk-away', label: 'Abandonar la mesa y activar la alternativa sin verificar.', consequence: 'Conservas poder negociador, pero expones la continuidad.', effects: { relationship: -18, margin: 7, risk: 25 }, skill: 'risk' }
      ]
    }
  ]
};

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
    meters: { ...state.meters },
    completedAt: state.status === 'complete' ? state.events.findLast(event => event.type === 'completed')?.at ?? null : null
  };
}
