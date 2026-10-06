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
  version: 3,
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
      takeaway: 'Antes de usar IA con información de personas, minimiza o anonimiza los datos y trabaja solo con las herramientas autorizadas por la universidad.',
      options: [
        { id: 'anonimizar', label: 'Anonimizar los datos y usar solo la herramienta de IA autorizada por la universidad.', consequence: 'Ahorras tiempo sin exponer datos personales: cumples el RGPD y la política de la universidad.', effects: { relationship: 8, margin: 6, risk: -14 }, skill: 'risk', quality: 'best',
          rationale: 'Minimizar los datos y usar una herramienta con garantías contractuales de la universidad permite aprovechar la IA respetando el RGPD: los datos identificables de estudiantes no salen a servicios no autorizados.' },
        { id: 'pegar-todo', label: 'Pegar la hoja completa en un chat de IA público.', consequence: 'Los datos de los alumnos salen a un servicio externo sin base legal: es una brecha de confidencialidad.', effects: { relationship: -15, margin: 8, risk: 25 }, skill: 'risk', quality: 'poor',
          rationale: 'Notas y comentarios son datos personales. Pegarlos en un servicio público sin contrato ni base legal es una comunicación no autorizada, y el proveedor puede conservarlos o usarlos para entrenar sus modelos.' },
        { id: 'a-mano', label: 'Renunciar a la IA y redactar todos los informes a mano.', consequence: 'No hay riesgo, pero pierdes días de trabajo que una IA bien usada te habría ahorrado.', effects: { relationship: 2, margin: -12, risk: -4 }, skill: 'preparation', quality: 'acceptable',
          rationale: 'Es seguro, pero renuncia a un uso legítimo de la IA. La buena práctica no es evitar la herramienta, sino usarla con datos minimizados y en un entorno autorizado.' }
      ]
    },
    {
      id: 'verificacion',
      title: 'Verificación',
      briefing: 'La IA ha resumido la nueva normativa de evaluación con tres referencias legales. El resumen se enviará al claustro esta tarde.',
      characterLine: 'La inteligencia artificial me ha preparado un resumen de la nueva normativa con tres referencias legales. Suena muy convincente. ¿Lo enviamos tal cual al claustro?',
      timeLimitSec: 180,
      timeoutRiskDelta: 8,
      takeaway: 'La IA redacta, pero respondes tú: verifica datos y referencias en las fuentes oficiales antes de difundir cualquier contenido generado.',
      options: [
        { id: 'contrastar', label: 'Comprobar cada referencia en la fuente oficial antes de enviarlo.', consequence: 'Detectas una referencia inventada y la corriges: el documento que llega al claustro es fiable.', effects: { relationship: 10, margin: 4, risk: -14 }, skill: 'preparation', quality: 'best',
          rationale: 'Los modelos generativos pueden inventar referencias verosímiles. Quien firma el documento responde de su exactitud, así que cada cita se comprueba en la fuente oficial antes de difundirla.' },
        { id: 'enviar', label: 'Enviarlo tal cual: la IA suele acertar.', consequence: 'Una de las referencias no existe. El claustro pierde la confianza en el documento.', effects: { relationship: -18, margin: 6, risk: 20 }, skill: 'risk', quality: 'poor',
          rationale: 'Que un texto suene convincente no lo hace correcto. Enviar contenido generado sin revisar traslada los errores al claustro y compromete la credibilidad del documento y de quien lo firma.' },
        { id: 'autoverificar', label: 'Pedir a la misma IA que confirme que las referencias son correctas.', consequence: 'La IA confirma sus propios errores: sigues sin una verificación real.', effects: { relationship: -6, margin: 4, risk: 12 }, skill: 'preparation', quality: 'poor',
          rationale: 'Preguntar al mismo modelo no es verificar: tiende a confirmar su propia respuesta. La comprobación tiene que hacerse contra fuentes primarias e independientes.' },
        { id: 'borrador', label: 'Enviarlo como borrador generado con IA pendiente de revisión.', consequence: 'Eres transparente, pero trasladas a otros una verificación que te corresponde.', effects: { relationship: 2, margin: 2, risk: 4 }, skill: 'negotiation', quality: 'acceptable',
          rationale: 'Declarar el uso de IA es correcto, pero verificar corresponde a quien elabora el documento; no debe delegarse en los destinatarios.' }
      ]
    },
    {
      id: 'evaluacion',
      title: 'Evaluación justa',
      briefing: 'Un detector señala que un trabajo de fin de grado tiene un 80 % de probabilidad de estar escrito con IA. La guía docente permite usar IA si se declara.',
      characterLine: 'Un detector dice que este trabajo tiene un ochenta por ciento de probabilidad de estar hecho con inteligencia artificial. ¿Lo suspendemos directamente?',
      timeLimitSec: 180,
      timeoutRiskDelta: 10,
      takeaway: 'Un detector de IA es un indicio, no una prueba: decide con evidencias, escucha al estudiante y aplica lo que establece la guía docente.',
      options: [
        { id: 'dialogar', label: 'Revisar el trabajo, hablar con el alumno y aplicar la guía docente.', consequence: 'Decides con evidencias y con garantías: el detector es un indicio, no una prueba.', effects: { relationship: 12, margin: 4, risk: -14 }, skill: 'negotiation', quality: 'best',
          rationale: 'Los detectores de texto generado tienen tasas de error relevantes. Una decisión académica exige evidencias, escuchar al estudiante y aplicar la guía docente, que aquí permite la IA declarada.' },
        { id: 'suspender', label: 'Suspender basándote solo en el detector.', consequence: 'Los detectores se equivocan con frecuencia: arriesgas una decisión injusta y una reclamación.', effects: { relationship: -20, margin: 2, risk: 22 }, skill: 'risk', quality: 'poor',
          rationale: 'Un porcentaje de un detector no es una prueba. Calificar solo con ese indicio deja al estudiante sin garantías y convierte una herramienta automática en quien decide.' },
        { id: 'ignorar', label: 'Ignorarlo: no hay forma de saberlo.', consequence: 'Evitas el conflicto, pero la guía docente queda sin aplicar.', effects: { relationship: -6, margin: 0, risk: 10 }, skill: 'negotiation', quality: 'poor',
          rationale: 'Ignorar el indicio deja la guía docente sin aplicar. Lo adecuado es revisar el trabajo y comprobar si el uso de IA se declaró como exige la asignatura.' }
      ]
    }
  ]
};

/**
 * IA generativa en la docencia: diseño de actividades evaluables, feedback asistido y materiales.
 * La valoración `quality` es de la decisión según la política de uso responsable, nunca de la persona.
 */
export const aiTeachingScenario: Scenario = {
  id: 'ia-docencia',
  version: 1,
  title: 'IA generativa en la docencia',
  summary: 'Diseña actividades, feedback y materiales con IA generativa sin perder de vista el aprendizaje, la responsabilidad docente y el respeto a la autoría.',
  character: { name: 'VictorIA' },
  initialMeters: { relationship: 50, margin: 50, risk: 50 },
  meterLabels: { relationship: 'Aprendizaje', margin: 'Eficiencia', risk: 'Riesgo' },
  phases: [
    {
      id: 'actividad-evaluable',
      title: 'Actividad evaluable con IA',
      briefing: 'VictorIA prepara con un profesor de primer curso una práctica evaluable de análisis de casos. Quieren permitir la IA generativa, pero la guía docente no dice cómo se usa ni cómo se declara. La actividad se publica en el aula virtual la semana que viene.',
      characterLine: 'Vamos a permitir la inteligencia artificial en la práctica de análisis de casos, pero la guía docente todavía no dice nada sobre cómo usarla. ¿Cómo planteamos la actividad para que aprendan de verdad y la evaluación sea justa?',
      timeLimitSec: 180,
      timeoutRiskDelta: 8,
      takeaway: 'Si permites la IA en una actividad evaluable, déjalo por escrito: qué usos se aceptan, cómo se declaran y cómo se evalúa el proceso, no solo el resultado.',
      options: [
        { id: 'uso-declarado', label: 'Definir qué usos de IA se permiten, pedir una declaración de uso y evaluar también el proceso y la reflexión del estudiante.', consequence: 'Los estudiantes saben a qué atenerse, declaran cómo han usado la IA y la evaluación valora su razonamiento, no solo el texto final.', effects: { relationship: 12, margin: 4, risk: -12 }, skill: 'preparation', quality: 'best',
          rationale: 'Unas reglas claras y una declaración de uso hacen visible el papel de la IA. Evaluar el proceso protege el aprendizaje y reduce el incentivo de entregar un texto generado sin comprenderlo.' },
        { id: 'prohibir-ia', label: 'Prohibir cualquier uso de IA y controlarlo con un detector.', consequence: 'La prohibición es difícil de comprobar y el detector da falsos positivos: aparecen sospechas y reclamaciones.', effects: { relationship: -8, margin: -4, risk: 14 }, skill: 'risk', quality: 'poor',
          rationale: 'Prohibir sin una forma fiable de comprobarlo y apoyarse en detectores con errores conocidos traslada la sospecha al estudiante y no le enseña a usar la IA con criterio.' },
        { id: 'libre-sin-reglas', label: 'Permitir la IA sin condiciones y evaluar solo el resultado final.', consequence: 'Las entregas mejoran en forma, pero no sabes qué ha aprendido cada estudiante ni qué parte del trabajo es suya.', effects: { relationship: -10, margin: 8, risk: 12 }, skill: 'risk', quality: 'poor',
          rationale: 'Sin reglas ni declaración, evaluar solo el producto final no distingue la aportación del estudiante de la de la herramienta, y se pierde la evidencia del aprendizaje.' },
        { id: 'defensa-oral', label: 'Mantener la práctica sin cambios y añadir una breve defensa oral para todos.', consequence: 'Compruebas la comprensión, pero la carga docente se dispara y sigue sin estar claro qué uso de la IA es aceptable.', effects: { relationship: 6, margin: -10, risk: -2 }, skill: 'preparation', quality: 'acceptable',
          rationale: 'La defensa oral aporta evidencias de aprendizaje, pero no sustituye a unas reglas de uso claras y tiene un coste de tiempo difícil de sostener en grupos grandes.' }
      ]
    },
    {
      id: 'feedback-asistido',
      title: 'Feedback asistido por IA',
      briefing: 'Hay 90 entregas pendientes y el profesor debe devolver el feedback en cinco días. VictorIA propone usar la herramienta de IA institucional para redactar borradores de comentarios a partir de la rúbrica de la asignatura.',
      characterLine: 'Tenemos noventa entregas y cinco días para corregirlas. La herramienta de inteligencia artificial de la universidad puede redactar los comentarios a partir de la rúbrica. ¿Se los mandamos directamente a los estudiantes?',
      timeLimitSec: 180,
      timeoutRiskDelta: 8,
      takeaway: 'La IA puede redactar borradores de feedback, pero la valoración y la nota las revisa y decide siempre el docente, con herramientas autorizadas.',
      options: [
        { id: 'revisar-borradores', label: 'Usar la IA para los borradores según la rúbrica, revisar y ajustar cada comentario y decidir la nota como docente.', consequence: 'Ahorras tiempo de redacción y cada estudiante recibe un comentario revisado, coherente con su trabajo y con su calificación.', effects: { relationship: 10, margin: 8, risk: -12 }, skill: 'preparation', quality: 'best',
          rationale: 'La IA agiliza la redacción, pero evaluar es responsabilidad del docente. Revisar cada comentario evita errores y valoraciones genéricas, y mantiene la decisión en manos humanas.' },
        { id: 'envio-automatico', label: 'Enviar sin revisar los comentarios y las notas que proponga la IA.', consequence: 'Varios comentarios no corresponden al trabajo entregado y dos notas no cuadran con la rúbrica: llegan las primeras reclamaciones.', effects: { relationship: -16, margin: 10, risk: 20 }, skill: 'risk', quality: 'poor',
          rationale: 'Delegar la calificación en un sistema automático sin supervisión humana produce errores que afectan a los derechos del estudiante. La nota debe ser una decisión revisada por el docente.' },
        { id: 'chat-externo', label: 'Pegar las entregas con nombre en un chat de IA externo porque redacta mejor.', consequence: 'Los trabajos y los datos de los estudiantes salen a un servicio no autorizado que puede conservarlos y reutilizarlos.', effects: { relationship: -12, margin: 8, risk: 22 }, skill: 'risk', quality: 'poor',
          rationale: 'Las entregas contienen datos personales y obras de los estudiantes. Un servicio no autorizado expone esa información; solo deben usarse herramientas con garantías de la universidad.' },
        { id: 'solo-nota', label: 'Prescindir de la IA y devolver solo la nota, sin comentarios, para llegar a tiempo.', consequence: 'Cumples el plazo, pero los estudiantes no saben qué mejorar en la siguiente entrega.', effects: { relationship: -6, margin: 4, risk: 2 }, skill: 'preparation', quality: 'acceptable',
          rationale: 'Evita los riesgos de la IA, pero sacrifica el valor formativo del feedback. Un uso supervisado de la herramienta permitía cumplir el plazo sin renunciar a él.' }
      ]
    },
    {
      id: 'materiales-fuentes',
      title: 'Materiales y derechos de autor',
      briefing: 'VictorIA ha generado con IA los apuntes del nuevo tema, varias imágenes y un caso práctico. Algunos párrafos se parecen mucho a un manual con derechos reservados y las imágenes no indican su origen. Los materiales se publicarán en el aula virtual.',
      characterLine: 'He preparado con inteligencia artificial los apuntes del nuevo tema, con imágenes y un caso práctico. Algunos párrafos se parecen mucho a un manual que conozco. ¿Los publico así en el aula virtual?',
      timeLimitSec: 180,
      timeoutRiskDelta: 10,
      takeaway: 'Antes de publicar material generado con IA, comprueba que no reproduce obras ajenas, cita las fuentes, verifica las licencias de las imágenes y declara el uso de la herramienta.',
      options: [
        { id: 'revisar-citar', label: 'Revisar el contenido, reescribir o citar lo que proceda del manual, comprobar las licencias de las imágenes y declarar el uso de IA.', consequence: 'Los materiales son originales o están citados, las imágenes tienen una licencia clara y los estudiantes saben cómo se elaboraron.', effects: { relationship: 10, margin: 2, risk: -14 }, skill: 'preparation', quality: 'best',
          rationale: 'El docente responde de los materiales que publica. Un texto generado puede reproducir obras protegidas; revisar, citar las fuentes y declarar el uso de IA respeta la autoría y da ejemplo a los estudiantes.' },
        { id: 'publicar-tal-cual', label: 'Publicarlos tal cual: si lo ha generado la IA, no tiene autor.', consequence: 'Un compañero reconoce párrafos casi literales del manual. Hay que retirar los materiales y dar explicaciones.', effects: { relationship: -14, margin: 8, risk: 20 }, skill: 'risk', quality: 'poor',
          rationale: 'Que lo genere una IA no elimina los derechos de terceros si reproduce obras existentes. Publicar sin revisar expone a la universidad a una infracción y da un mal ejemplo de integridad académica.' },
        { id: 'solo-mencion', label: 'Añadir al pie «Elaborado con IA» y publicarlos sin más revisión.', consequence: 'Eres transparente sobre la herramienta, pero los párrafos copiados y las imágenes sin licencia siguen ahí.', effects: { relationship: 0, margin: 6, risk: 10 }, skill: 'risk', quality: 'poor',
          rationale: 'Declarar el uso de IA es necesario, pero no suficiente: no sustituye a citar las fuentes ni a comprobar que el texto y las imágenes pueden publicarse legalmente.' },
        { id: 'descartar-ia', label: 'Descartar todo lo generado y reutilizar los materiales del curso pasado.', consequence: 'Evitas el riesgo, pero pierdes el trabajo hecho y el tema queda sin actualizar.', effects: { relationship: -2, margin: -8, risk: -4 }, skill: 'preparation', quality: 'acceptable',
          rationale: 'Es una opción segura, pero desaprovecha un borrador útil. Con revisión, citas y licencias comprobadas, el material generado podía mejorarse y publicarse con garantías.' }
      ]
    }
  ]
};

/**
 * IA en la atención al estudiante: errores de un asistente, sesgo en la priorización de becas y transparencia.
 * La valoración `quality` es de la decisión según la política de uso responsable, nunca de la persona.
 */
export const aiStudentServicesScenario: Scenario = {
  id: 'ia-atencion-estudiantes',
  version: 1,
  title: 'IA en la atención al estudiante',
  summary: 'Gestiona el uso de IA en los servicios al estudiante: errores de un asistente virtual, sesgos en la priorización de becas y transparencia en la atención.',
  character: { name: 'VictorIA' },
  initialMeters: { relationship: 50, margin: 50, risk: 50 },
  meterLabels: { relationship: 'Confianza', margin: 'Agilidad', risk: 'Riesgo' },
  phases: [
    {
      id: 'chatbot-plazos',
      title: 'Respuesta errónea del asistente',
      briefing: 'El asistente virtual de secretaría ha respondido a varios estudiantes que el plazo para solicitar convalidaciones termina el 30 de octubre. El plazo oficial termina el 15, dentro de tres días. VictorIA, responsable del servicio, lo ha detectado por una reclamación.',
      characterLine: 'El asistente virtual de secretaría ha dicho a varios estudiantes que el plazo de convalidaciones termina el treinta de octubre, pero en realidad termina el quince, dentro de tres días. ¿Qué hacemos?',
      timeLimitSec: 180,
      timeoutRiskDelta: 8,
      takeaway: 'Si un asistente de IA da información errónea, corrige la fuente, avisa a los afectados con la información oficial y registra la incidencia: la responsabilidad es del servicio.',
      options: [
        { id: 'corregir-avisar', label: 'Corregir la fuente del asistente, avisar a los estudiantes afectados con el plazo oficial y registrar la incidencia.', consequence: 'Los estudiantes reciben el plazo correcto a tiempo, el asistente deja de repetir el error y la incidencia queda documentada.', effects: { relationship: 10, margin: 6, risk: -14 }, skill: 'risk', quality: 'best',
          rationale: 'El servicio responde de lo que dice su asistente. Corregir la causa, informar de forma proactiva a los afectados y registrar el fallo protege sus derechos y permite mejorar el sistema.' },
        { id: 'corregir-sin-avisar', label: 'Corregir el asistente sin avisar a nadie para no generar alarma.', consequence: 'El asistente ya responde bien, pero quienes recibieron la fecha errónea pierden el plazo.', effects: { relationship: -14, margin: 6, risk: 18 }, skill: 'risk', quality: 'poor',
          rationale: 'Corregir sin informar deja a los estudiantes afectados con un dato falso que les perjudica. Ser transparente ante un error forma parte de un uso responsable de la IA.' },
        { id: 'pausar-asistente', label: 'Desactivar el asistente hasta revisarlo y atender por correo y en ventanilla.', consequence: 'Cortas la difusión del error, pero la secretaría se satura y quienes ya recibieron la fecha errónea siguen sin saberlo.', effects: { relationship: 2, margin: -12, risk: 2 }, skill: 'risk', quality: 'acceptable',
          rationale: 'Suspender un sistema que falla puede ser prudente, pero no repara el daño ya causado: también hay que avisar a los afectados y corregir la fuente de información.' },
        { id: 'culpar-proveedor', label: 'Responder a la reclamación que el error es del proveedor del asistente.', consequence: 'El estudiante sigue sin solución y la universidad parece eludir su responsabilidad.', effects: { relationship: -16, margin: 0, risk: 14 }, skill: 'negotiation', quality: 'poor',
          rationale: 'Ante el estudiante responde la universidad, no el proveedor tecnológico. Derivar la culpa no corrige el plazo erróneo ni repara el perjuicio.' }
      ]
    },
    {
      id: 'sesgo-becas',
      title: 'Sesgo en la priorización de becas',
      briefing: 'Un modelo ordena las solicitudes de ayuda al estudio para revisarlas por prioridad. Un análisis interno muestra que las de estudiantes mayores de 25 años y las de quienes compatibilizan estudios y trabajo quedan sistemáticamente al final. La convocatoria se resuelve en dos semanas.',
      characterLine: 'El modelo que ordena las solicitudes de beca deja siempre al final a los estudiantes mayores de veinticinco años y a los que trabajan. La convocatoria se resuelve en dos semanas. ¿Seguimos usándolo?',
      timeLimitSec: 180,
      timeoutRiskDelta: 8,
      takeaway: 'Si un sistema de IA que afecta a ayudas o derechos de los estudiantes muestra un sesgo, detén su influencia, revisa con personas y audítalo antes de volver a usarlo.',
      options: [
        { id: 'auditar-revisar', label: 'Suspender el orden automático, revisar todas las solicitudes con los criterios de la convocatoria y auditar el modelo antes de reutilizarlo.', consequence: 'Ninguna solicitud queda perjudicada por el sesgo y el modelo solo vuelve a usarse tras corregirlo y documentarlo.', effects: { relationship: 12, margin: -2, risk: -14 }, skill: 'risk', quality: 'best',
          rationale: 'Un sistema que influye en el acceso a ayudas exige supervisión humana, control de sesgos y documentación. Si se detecta un sesgo, se detiene su influencia y se audita antes de seguir usándolo.' },
        { id: 'seguir-usando', label: 'Seguir usándolo en esta convocatoria y corregirlo para la siguiente.', consequence: 'Se cumplen los plazos, pero estudiantes con derecho a beca quedan relegados por un criterio que nadie ha decidido.', effects: { relationship: -18, margin: 8, risk: 22 }, skill: 'risk', quality: 'poor',
          rationale: 'Mantener un sistema con un sesgo conocido es aceptar decisiones injustas sobre personas concretas. La eficiencia no justifica discriminar por edad o por situación laboral.' },
        { id: 'quitar-variables', label: 'Quitar del modelo la edad y la situación laboral y volver a ejecutarlo.', consequence: 'La lista cambia, pero nadie ha comprobado si otras variables relacionadas siguen reproduciendo el sesgo.', effects: { relationship: 2, margin: 4, risk: 6 }, skill: 'preparation', quality: 'acceptable',
          rationale: 'Eliminar las variables visibles no basta: otras relacionadas, como el año de acceso o el tipo de matrícula, pueden actuar como sustitutas. Hay que medir el sesgo y validar la corrección.' }
      ]
    },
    {
      id: 'transparencia-ia',
      title: 'Transparencia ante el estudiante',
      briefing: 'El servicio de orientación incorporará un asistente de IA al chat de la web. El proveedor sugiere presentarlo con el nombre y la foto de una persona para que resulte más cercano. Algunos estudiantes consultan temas sensibles, como dificultades económicas o adaptaciones por discapacidad.',
      characterLine: 'Vamos a poner un asistente de inteligencia artificial en el chat de orientación. El proveedor propone presentarlo con el nombre y la foto de una persona para que parezca más cercano. ¿Cómo lo presentamos a los estudiantes?',
      timeLimitSec: 180,
      timeoutRiskDelta: 10,
      takeaway: 'Quien habla con una IA debe saberlo desde el primer mensaje y poder pasar a una persona en cualquier momento, sobre todo en temas sensibles.',
      options: [
        { id: 'informar-derivar', label: 'Indicar desde el primer mensaje que es un asistente de IA y ofrecer siempre la opción de hablar con una persona del servicio.', consequence: 'Los estudiantes saben con quién hablan, deciden qué compartir y las consultas delicadas llegan a un orientador.', effects: { relationship: 12, margin: 4, risk: -14 }, skill: 'negotiation', quality: 'best',
          rationale: 'El Reglamento europeo de IA exige informar a las personas de que interactúan con un sistema de IA. Ofrecer además una vía humana, sobre todo en temas sensibles, respeta la autonomía del estudiante.' },
        { id: 'persona-ficticia', label: 'Presentarlo como una orientadora con nombre y foto, sin mencionar la IA.', consequence: 'Algunos estudiantes comparten información delicada creyendo hablar con una persona. Cuando se descubre, la confianza en el servicio cae.', effects: { relationship: -20, margin: 8, risk: 22 }, skill: 'risk', quality: 'poor',
          rationale: 'Hacer pasar un sistema de IA por una persona engaña al estudiante e incumple la obligación de transparencia. Además, puede llevarle a compartir datos sensibles sin saber quién los trata.' },
        { id: 'aviso-legal', label: 'Mencionar el uso de IA solo en el aviso legal de la web.', consequence: 'Formalmente está escrito, pero casi nadie lo lee y la mayoría cree que habla con una persona.', effects: { relationship: -8, margin: 6, risk: 12 }, skill: 'risk', quality: 'poor',
          rationale: 'La transparencia tiene que ser clara y llegar en el momento de la interacción. Un aviso escondido en un texto legal no informa de verdad al estudiante.' },
        { id: 'sin-asistente', label: 'Descartar el asistente y mantener solo la atención por personas en horario de oficina.', consequence: 'La atención es humana, pero las consultas fuera de horario quedan sin respuesta y las esperas crecen.', effects: { relationship: 2, margin: -10, risk: -2 }, skill: 'preparation', quality: 'acceptable',
          rationale: 'Es una opción legítima, pero renuncia a un servicio útil. Un asistente transparente y con derivación a personas podía ampliar la atención sin perder garantías.' }
      ]
    }
  ]
};

/** Escenarios incluidos en el código y publicados en D1; el primero es el que se usa por defecto. */
export const catalogScenarios: Scenario[] = [aiPracticesScenario, aiTeachingScenario, aiStudentServicesScenario, negotiationScenario];
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
    participantReports: current.participants.map(person => ({ userId: person.userId, name: person.name, joinedAt: person.joinedAt, ...individualCore(current, person.userId) }))
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
 * - Sin eventos de unión ni decisiones de otros participantes; los incidentes conservan su nota.
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
  view.events = view.events.filter(event => !((event.type === 'participant_joined' || event.type === 'decision') && event.actorId !== userId));
  view.processedCommands = [];
  view.pendingEvents = [];
  return view;
}
