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
  /** Por qué la opción es o no buena práctica (máx. 300 caracteres). Se muestra en el debriefing. */
  rationale?: string;
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
  /** Idea clave de buena práctica que deja la situación (máx. 240 caracteres). */
  takeaway?: string;
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
  /**
   * Procedencia. Solo la fija el servidor al publicar un borrador generado con IA en el «Modo IA en vivo» tras la
   * revisión del docente (`POST /api/ai-runs/:id/publish`); IDs seudónimos de la partida y la colección, sin texto.
   */
  origin?: ScenarioOrigin;
}

export interface ScenarioOrigin { kind: 'ai'; runId: string; collectionId: string }

export const defaultMeterLabels: Record<MeterName, string> = { relationship: 'Relación', margin: 'Margen', risk: 'Riesgo' };

export function meterLabels(scenario: Scenario): Record<MeterName, string> {
  return scenario.meterLabels ?? defaultMeterLabels;
}

export type SessionStatus = 'active' | 'paused' | 'complete';

export interface Participant {
  userId: string;
  name: string;
  joinedAt: string;
  /** Participante simulado de la «clase simulada» de demostración (no es una persona ni un usuario). Ausente en los reales. */
  simulated?: true;
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
  /**
   * Media redondeada de la clase (indicadores iniciales si no hay participantes).
   * Se conserva para la consola y Unity; el modo individual usa `participantMeters`.
   */
  meters: Meters;
  /**
   * Indicadores de cada participante por userId (modo individual). Los estados guardados antes de
   * este campo no lo tienen: `normalizeState` lo reconstruye con los indicadores globales antiguos.
   */
  participantMeters: Record<string, Meters>;
  participants: Participant[];
  decisions: Decision[];
  events: SimEvent[];
  processedCommands: string[];
  pendingEvents: SimEvent[];
  createdAt: string;
}

/** Campos comunes del informe de la clase y del informe individual. Valoran decisiones, no personas. */
export interface ReportCore {
  score: number;
  decisions: number;
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
}

/**
 * Informe de la clase (sin userId) o de un participante (con userId). En el de la clase, score y objetivos
 * se calculan sobre la media de indicadores y el resto sobre todas las decisiones.
 */
export interface PerformanceReport extends ReportCore {
  /** Participantes incluidos: todos en el de la clase; 1 (o 0 si no se unió) en el individual. */
  participants: number;
  completedAt: string | null;
  /** Informe individual de cada participante. Solo en el informe de la clase; vacío en el individual. */
  participantReports: ParticipantReport[];
}

/** Informe individual de un participante dentro del informe de la clase (vista del docente). */
export interface ParticipantReport extends ReportCore {
  userId: string;
  name: string;
  joinedAt: string;
  /** Presente (true) solo en los participantes simulados de la clase de demostración, para etiquetarlos o excluirlos. */
  simulated?: true;
}

export interface DebriefEntry {
  phaseId: string;
  phaseTitle: string;
  userId: string;
  optionId: string;
  label: string;
  consequence: string;
  quality: ChoiceQuality | null;
  /** Por qué la opción elegida es o no buena práctica. Null si el escenario no lo explica. */
  rationale: string | null;
  /** Idea clave de la fase. Null si el escenario no la define. */
  takeaway: string | null;
  durationMs: number;
  timedOut: boolean;
}

/**
 * Escenario principal del catálogo: uso responsable de la IA generativa en un despacho de abogados (ficticio).
 * Marco: secreto profesional, Código Deontológico de la Abogacía Española, Estatuto General de la Abogacía Española,
 * RGPD/LOPDGDD y alfabetización en IA del Reglamento de IA. La valoración `quality` es de la decisión, nunca de la persona.
 */
export const lawFirmAiScenario: Scenario = {
  id: 'ia-despacho',
  version: 1,
  title: 'Uso responsable de la IA en el despacho',
  summary: 'Decide cómo usar la IA generativa en el despacho sin comprometer el secreto profesional, la protección de datos, el rigor ante los tribunales ni la lealtad con el cliente.',
  character: { name: 'VictorIA' },
  initialMeters: { relationship: 50, margin: 50, risk: 50 },
  meterLabels: { relationship: 'Confianza del cliente', margin: 'Deontología', risk: 'Riesgo' },
  phases: [
    {
      id: 'secreto-profesional',
      title: 'Secreto profesional',
      briefing: 'Una abogada junior debe preparar hoy el borrador de una demanda de reclamación por negligencia médica. Quiere pegar el expediente completo del cliente (nombre, DNI, historia clínica e informes periciales) en un chat de IA generativa público y gratuito para que le redacte el escrito.',
      characterLine: 'Nuestra compañera quiere pegar el expediente entero del cliente, con su historia clínica, en un chat de inteligencia artificial gratuito para que le escriba la demanda. Así terminaría en una hora. ¿Le decimos que adelante?',
      timeLimitSec: 210,
      timeoutRiskDelta: 8,
      takeaway: 'El secreto profesional y el RGPD también rigen frente a la IA: elimina los datos identificativos y sensibles y trabaja solo con herramientas contratadas por el despacho con garantías.',
      options: [
        { id: 'anonimizar-herramienta', label: 'Eliminar los datos que identifican al cliente y a terceros y usar solo la herramienta de IA contratada por el despacho.', consequence: 'El borrador avanza sin que la información del cliente salga del entorno controlado del despacho.', effects: { relationship: 8, margin: 10, risk: -14 }, skill: 'risk', quality: 'best',
          rationale: 'El secreto profesional obliga a proteger todo lo conocido por razón del encargo. Minimizar los datos y usar una herramienta con contrato de encargado y confidencialidad permite aprovechar la IA sin revelar información del cliente.' },
        { id: 'pegar-expediente', label: 'Pegar el expediente completo en el chat público: es lo más rápido.', consequence: 'Datos de salud e identificativos del cliente acaban en un servicio externo sin contrato ni garantías: se compromete el secreto profesional.', effects: { relationship: -18, margin: -16, risk: 25 }, skill: 'risk', quality: 'poor',
          rationale: 'Los datos de salud son una categoría especial del RGPD. Comunicarlos a un servicio público sin contrato vulnera el secreto profesional y la protección de datos, y el proveedor puede conservarlos o usarlos para entrenar.' },
        { id: 'permiso-cliente', label: 'Llamar al cliente, pedirle permiso de palabra y pegar el expediente completo.', consequence: 'El cliente acepta sin saber bien a qué, y los datos salen igualmente a un servicio sin garantías.', effects: { relationship: -4, margin: -10, risk: 15 }, skill: 'negotiation', quality: 'poor',
          rationale: 'Un permiso verbal y poco informado no sustituye a las garantías: el servicio sigue sin contrato ni confidencialidad, y el deber de secreto y de diligencia recae en el despacho.' },
        { id: 'sin-ia', label: 'Redactar la demanda sin IA para no correr ningún riesgo.', consequence: 'No hay exposición de datos, pero el escrito llega más tarde y con más horas de trabajo.', effects: { relationship: -2, margin: 4, risk: -4 }, skill: 'preparation', quality: 'acceptable',
          rationale: 'Es seguro, pero renuncia a un uso legítimo de la IA. La buena práctica no es evitar la herramienta, sino usarla con datos minimizados y en un entorno autorizado por el despacho.' }
      ]
    },
    {
      id: 'jurisprudencia-inventada',
      title: 'Jurisprudencia inventada',
      briefing: 'El plazo para presentar un escrito de oposición vence hoy. El borrador generado con IA cita tres sentencias del Tribunal Supremo que encajan a la perfección, pero en una búsqueda rápida en CENDOJ no aparece una de ellas.',
      characterLine: 'El escrito cita tres sentencias del Supremo que vienen como anillo al dedo, pero una no aparece en la base de datos. El plazo vence hoy. ¿Lo presentamos así y luego lo miramos?',
      timeLimitSec: 180,
      timeoutRiskDelta: 10,
      takeaway: 'La IA puede inventar sentencias verosímiles. Quien firma el escrito responde ante el tribunal y el cliente: verifica cada cita en fuentes oficiales antes de presentarlo.',
      options: [
        { id: 'verificar-fuentes', label: 'Comprobar cada sentencia en CENDOJ o en la base de datos del despacho y retirar las que no se puedan verificar.', consequence: 'Una de las sentencias no existe. La retiras, refuerzas el argumento con jurisprudencia real y presentas en plazo.', effects: { relationship: 10, margin: 8, risk: -12 }, skill: 'preparation', quality: 'best',
          rationale: 'La diligencia profesional y la buena fe procesal exigen que lo que se aporta al tribunal sea veraz. Cada cita se comprueba en fuentes oficiales; lo que no se puede verificar no se presenta.' },
        { id: 'presentar-tal-cual', label: 'Presentarlo tal cual: no hay tiempo para revisar.', consequence: 'La parte contraria detecta la sentencia inexistente. El tribunal y el cliente pierden la confianza en el escrito y en el despacho.', effects: { relationship: -20, margin: -18, risk: 24 }, skill: 'risk', quality: 'poor',
          rationale: 'Citar jurisprudencia inexistente puede inducir a error al tribunal y vulnera la buena fe procesal y el deber de diligencia. Las prisas no trasladan la responsabilidad a la herramienta.' },
        { id: 'preguntar-ia', label: 'Pedir a la misma IA que confirme que las sentencias existen.', consequence: 'La IA confirma sus propias citas con seguridad: sigues sin una verificación real.', effects: { relationship: -6, margin: -8, risk: 14 }, skill: 'preparation', quality: 'poor',
          rationale: 'Preguntar al mismo modelo no es verificar: tiende a confirmar su respuesta e incluso a inventar los detalles. La comprobación se hace en fuentes primarias e independientes.' },
        { id: 'quitar-citas', label: 'Quitar todas las citas jurisprudenciales y presentar el escrito sin ellas.', consequence: 'Evitas el error, pero el escrito pierde apoyo jurisprudencial que habría reforzado la posición del cliente.', effects: { relationship: -2, margin: 4, risk: 4 }, skill: 'risk', quality: 'acceptable',
          rationale: 'Lo diligente es verificar y conservar las citas reales, no prescindir de todas: así se pierde jurisprudencia útil que sí existe.' }
      ]
    },
    {
      id: 'proveedor-ia',
      title: 'Contratar un proveedor de IA',
      briefing: 'El despacho quiere contratar una herramienta de IA para revisar contratos y preparar escritos. El proveedor ofrece aceptar sus condiciones generales en línea. No está claro dónde se alojan los datos ni si se usarán para entrenar sus modelos.',
      characterLine: 'El proveedor nos deja usar su herramienta hoy mismo si aceptamos sus condiciones generales. No dice dónde guarda los datos ni si entrena con ellos. ¿Firmamos y empezamos a trabajar?',
      timeLimitSec: 240,
      timeoutRiskDelta: 8,
      takeaway: 'Antes de introducir datos de clientes en una herramienta de IA: contrato de encargado del tratamiento, confidencialidad, sin entrenamiento con esos datos, ubicación clara y formación del equipo.',
      options: [
        { id: 'contrato-garantias', label: 'Exigir contrato de encargado del tratamiento, confidencialidad, no entrenar con datos de clientes, datos en la UE o con garantías, y formar al equipo.', consequence: 'La contratación tarda unas semanas más, pero el despacho puede usar la herramienta con datos de clientes con garantías.', effects: { relationship: 6, margin: 10, risk: -14 }, skill: 'negotiation', quality: 'best',
          rationale: 'El artículo 28 del RGPD exige un contrato con el encargado del tratamiento. Además, el secreto profesional pide confidencialidad reforzada, y el Reglamento de IA obliga a asegurar la alfabetización en IA del personal.' },
        { id: 'condiciones-estandar', label: 'Aceptar las condiciones generales en línea: el proveedor es conocido.', consequence: 'Las condiciones permiten al proveedor reutilizar los contenidos para mejorar su servicio y alojarlos fuera de la UE.', effects: { relationship: -6, margin: -12, risk: 18 }, skill: 'risk', quality: 'poor',
          rationale: 'Que un proveedor sea conocido no sustituye a las garantías. Sin contrato de encargado, sin confidencialidad y con posible entrenamiento, los datos de clientes quedan fuera del control del despacho.' },
        { id: 'version-gratuita', label: 'Empezar ya con la versión gratuita y con casos reales mientras se negocia el contrato.', consequence: 'Durante la negociación, expedientes de clientes pasan por un servicio sin ninguna garantía contractual.', effects: { relationship: -12, margin: -16, risk: 22 }, skill: 'risk', quality: 'poor',
          rationale: 'Usar datos reales antes de tener las garantías es precisamente el riesgo que el contrato debe evitar. Las versiones gratuitas suelen permitir el uso de los contenidos para entrenar.' },
        { id: 'piloto-sin-datos', label: 'Probar la herramienta solo con documentos sin datos de clientes hasta cerrar el contrato.', consequence: 'Conoces la herramienta sin exponer información, aunque el despacho aún no puede aprovecharla en los asuntos.', effects: { relationship: 2, margin: 4, risk: 0 }, skill: 'preparation', quality: 'acceptable',
          rationale: 'Probar sin datos de clientes es prudente, pero no resuelve la contratación: falta negociar las garantías que permitirán usarla en el trabajo real.' }
      ]
    },
    {
      id: 'transparencia-cliente',
      title: 'Transparencia con el cliente',
      briefing: 'Una clienta recibe la minuta de un recurso y pregunta si el despacho usó IA para prepararlo y cómo se refleja en las horas facturadas. La hoja de encargo prevé honorarios por horas.',
      characterLine: 'La clienta pregunta si hemos usado inteligencia artificial en su recurso y por qué le cobramos esas horas. Es una pregunta incómoda. ¿Qué le contestamos?',
      timeLimitSec: 180,
      timeoutRiskDelta: 8,
      takeaway: 'La confianza del cliente se apoya en la información veraz: explica cómo se ha usado la IA, que un abogado revisó el trabajo y factura conforme a lo pactado en la hoja de encargo.',
      options: [
        { id: 'explicar-minuta', label: 'Explicar qué tareas se apoyaron en IA, que un abogado lo revisó todo y cómo se reflejan en las horas según la hoja de encargo.', consequence: 'La clienta entiende el trabajo realizado y confía en que la minuta responde a lo pactado.', effects: { relationship: 14, margin: 8, risk: -10 }, skill: 'negotiation', quality: 'best',
          rationale: 'El deber de información y la lealtad con el cliente piden explicar con claridad cómo se ha trabajado. Los honorarios deben responder a lo pactado en la hoja de encargo y al trabajo efectivamente realizado.' },
        { id: 'negar-uso', label: 'Decirle que no se usó IA para evitar dudas.', consequence: 'La clienta descubre después que sí se usó. La relación se rompe y presenta una queja ante el colegio.', effects: { relationship: -20, margin: -16, risk: 20 }, skill: 'negotiation', quality: 'poor',
          rationale: 'Faltar a la verdad con el cliente quiebra la confianza en la que se basa la relación profesional y puede tener consecuencias deontológicas.' },
        { id: 'facturar-como-manual', label: 'Reconocer el uso de IA, pero mantener las horas como si todo se hubiera hecho a mano.', consequence: 'La clienta percibe que paga horas que no se trabajaron y pide la revisión de la minuta.', effects: { relationship: -14, margin: -14, risk: 16 }, skill: 'risk', quality: 'poor',
          rationale: 'En honorarios por horas solo se factura el tiempo efectivamente dedicado. Cobrar horas no trabajadas no es leal con el cliente, aunque se reconozca el uso de la herramienta.' },
        { id: 'respuesta-generica', label: 'Responder que el despacho usa herramientas tecnológicas, sin entrar en detalles.', consequence: 'La respuesta no es falsa, pero la clienta se queda con dudas sobre el trabajo y la minuta.', effects: { relationship: -4, margin: 0, risk: 6 }, skill: 'negotiation', quality: 'acceptable',
          rationale: 'No engaña, pero no responde a lo que la clienta pregunta. La información clara sobre el trabajo y los honorarios refuerza la confianza.' }
      ]
    }
  ]
};

/** Escenarios incluidos en el código y publicados en D1; el primero es el que se usa por defecto. */
export const catalogScenarios: Scenario[] = [lawFirmAiScenario];
export const defaultScenario = lawFirmAiScenario;

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

/** Media redondeada de los indicadores de los participantes; sin participantes, los iniciales del escenario. */
export function classMeters(state: Pick<SessionState, 'scenario' | 'participants' | 'participantMeters'>): Meters {
  const list = state.participants.map(person => state.participantMeters[person.userId] ?? state.scenario.initialMeters);
  if (!list.length) return { ...state.scenario.initialMeters };
  const average = (name: MeterName) => Math.round(list.reduce((sum, meters) => sum + meters[name], 0) / list.length);
  return { relationship: average('relationship'), margin: average('margin'), risk: average('risk') };
}

/**
 * Compatibilidad con estados guardados antes del modo individual (sin `participantMeters`): cada participante
 * hereda los indicadores globales antiguos. Si el estado ya está al día, devuelve el mismo objeto.
 */
export function normalizeState(state: SessionState): SessionState {
  if ((state as Partial<SessionState>).participantMeters) return state;
  return { ...state, participantMeters: Object.fromEntries(state.participants.map(person => [person.userId, { ...state.meters }])) };
}

function timelineOf(state: SessionState, decisions: SessionState['decisions']): DebriefEntry[] {
  return decisions.map(decision => {
    const phase = state.scenario.phases.find(item => item.id === decision.phaseId);
    const option = phase?.options.find(item => item.id === decision.optionId);
    return {
      phaseId: decision.phaseId, phaseTitle: phase?.title ?? decision.phaseId, userId: decision.userId, optionId: decision.optionId,
      label: option?.label ?? decision.optionId, consequence: option?.consequence ?? '', quality: option?.quality ?? null,
      rationale: option?.rationale ?? null, takeaway: phase?.takeaway ?? null,
      durationMs: decision.durationMs,
      timedOut: state.events.some(event => event.type === 'timer_expired' && event.detail.phaseId === decision.phaseId && Date.parse(event.at) <= Date.parse(decision.at))
    };
  });
}

/** Campos comunes a partir de unos indicadores, unas decisiones y los vencimientos que cuentan. */
function summarize(state: SessionState, meters: Meters, decisions: SessionState['decisions'], timeouts: number): ReportCore {
  const objectivesMet = Number(meters.relationship >= 55) + Number(meters.margin >= 55) + Number(meters.risk <= 40);
  const score = Math.round((meters.relationship + meters.margin + (100 - meters.risk)) / 3);
  const timeline = timelineOf(state, decisions);
  const rated = timeline.filter(entry => entry.quality !== null);
  const timed = timeline.flatMap(entry => {
    const limit = state.scenario.phases.find(item => item.id === entry.phaseId)?.timeLimitSec;
    return limit ? [Math.max(0, Math.min(100, 100 - (100 * entry.durationMs) / (limit * 1000)))] : [];
  });
  const avgReactionMs = decisions.length ? Math.round(decisions.reduce((sum, decision) => sum + decision.durationMs, 0) / decisions.length) : 0;
  return {
    score,
    decisions: decisions.length,
    avgReactionMs,
    objectivesMet,
    objectivesTotal: 3,
    timeouts,
    correctDecisionsPct: rated.length ? Math.round(100 * rated.filter(entry => entry.quality === 'best').length / rated.length) : null,
    reactionPct: timed.length ? Math.round(timed.reduce((sum, value) => sum + value, 0) / timed.length) : null,
    objectivesPct: Math.round(100 * objectivesMet / 3),
    criticalDecisions: timeline.filter(entry => entry.quality === 'poor').length,
    timeline,
    meters: { ...meters }
  };
}

/**
 * Vencimientos que penalizaron a un participante: ya estaba unido y aún no había decidido en esa fase.
 * Se reconstruye por el orden (seq) de los eventos, igual que lo aplicó `expireTimer`.
 */
function participantTimeouts(state: SessionState, userId: string): number {
  return state.events.filter(expired => expired.type === 'timer_expired'
    && state.events.some(event => event.type === 'participant_joined' && event.actorId === userId && event.seq < expired.seq)
    && !state.events.some(event => event.type === 'decision' && event.actorId === userId && event.detail.phaseId === expired.detail.phaseId && event.seq < expired.seq)).length;
}

function individualCore(state: SessionState, userId: string): ReportCore {
  const joined = state.participants.some(person => person.userId === userId);
  const meters = (joined ? state.participantMeters[userId] : undefined) ?? state.scenario.initialMeters;
  return summarize(state, meters, state.decisions.filter(decision => decision.userId === userId), joined ? participantTimeouts(state, userId) : 0);
}

/**
 * Informe de debriefing. Sin `userId`, el de la CLASE: score y objetivos sobre la media de indicadores, el resto
 * sobre todas las decisiones, y `participantReports` con el detalle de cada participante (vista del docente).
 * Con `userId`, el informe individual de ese participante, con `participantReports` vacío.
 */
export function performanceReport(state: SessionState, userId?: string): PerformanceReport {
  const current = normalizeState(state);
  const completedAt = current.status === 'complete' ? current.events.findLast(event => event.type === 'completed')?.at ?? null : null;
  if (userId !== undefined) {
    const joined = current.participants.some(person => person.userId === userId);
    return { ...individualCore(current, userId), participants: joined ? 1 : 0, completedAt, participantReports: [] };
  }
  return {
    ...summarize(current, classMeters(current), current.decisions, current.events.filter(event => event.type === 'timer_expired').length),
    participants: current.participants.length,
    completedAt,
    participantReports: current.participants.map(person => ({
      userId: person.userId, name: person.name, joinedAt: person.joinedAt,
      ...(person.simulated ? { simulated: true as const } : {}),
      ...individualCore(current, person.userId)
    }))
  };
}

/** Informe individual que puede ver el propio participante. */
export function participantReport(state: SessionState, userId: string): PerformanceReport {
  return performanceReport(state, userId);
}

/**
 * Copia del estado que puede ver un participante:
 * - En las fases donde aún no ha decidido, las opciones van sin `quality`, `rationale` ni `effects` y la fase sin `takeaway`
 *   (también en la fase activa, porque la idea clave anticipa la respuesta). Con la sesión completada se muestra todo.
 * - Solo él mismo en `participants`, sus `decisions`, sus `participantMeters` y `meters` = sus indicadores.
 * - Sin eventos de unión, decisiones ni retiradas de otros participantes; los incidentes conservan su nota.
 * - Sin `processedCommands` ni `pendingEvents`.
 */
export function participantView(state: SessionState, userId: string): SessionState {
  const view = structuredClone(normalizeState(state));
  const decided = new Set(view.decisions.filter(decision => decision.userId === userId).map(decision => decision.phaseId));
  if (view.status !== 'complete') {
    for (const phase of view.scenario.phases) {
      if (decided.has(phase.id)) continue;
      delete phase.takeaway;
      for (const option of phase.options) {
        delete option.quality;
        delete option.rationale;
        // Los efectos numéricos delatan la mejor opción: el participante solo los conoce al decidir.
        delete (option as Partial<Choice>).effects;
      }
    }
  }
  const own = view.participants.some(person => person.userId === userId) ? view.participantMeters[userId] : undefined;
  view.participants = view.participants.filter(person => person.userId === userId);
  view.decisions = view.decisions.filter(decision => decision.userId === userId);
  view.participantMeters = own ? { [userId]: own } : {};
  view.meters = own ? { ...own } : { ...view.scenario.initialMeters };
  view.events = view.events.filter(event => !((event.type === 'participant_joined' || event.type === 'decision') && event.actorId !== userId)
    // La retirada de un compañero tampoco se ve (su detail lleva el ID seudónimo de esa persona).
    && !(event.type === 'participant_removed' && event.detail.participantId !== userId));
  view.processedCommands = [];
  view.pendingEvents = [];
  return view;
}
