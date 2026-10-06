/**
 * Catálogo de eventos de simulación. Es el contrato entre el motor, la cola,
 * D1, la consola web y los clientes (Unity hoy, VR mañana).
 * Los eventos solo contienen IDs seudónimos: nunca nombres ni correos.
 * Añadir un tipo es compatible; cambiar el significado de uno existente
 * exige subir EVENT_SCHEMA_VERSION.
 */
export const EVENT_SCHEMA_VERSION = 1;

export const EVENT_CATALOG = {
  session_started: 'Sesión creada por el instructor. detail: scenarioVersion',
  participant_joined: 'Un participante entra en la sesión. detail: participantId',
  decision: 'Decisión de un participante. detail: phaseId, optionId, durationMs',
  phase_advanced: 'El instructor avanza de fase. detail: phaseId',
  paused: 'El instructor pausa la sesión.',
  resumed: 'El instructor reanuda la sesión.',
  incident: 'Incidente introducido por el instructor. detail: note, riskDelta',
  meter_changed: 'Ajuste manual de un indicador. detail: meter, value',
  timer_expired: 'Vence el tiempo de la fase. actor: system. detail: phaseId, riskDelta',
  completed: 'Sesión finalizada. detail: score'
} as const;

export type SimEventType = keyof typeof EVENT_CATALOG;
export const SYSTEM_ACTOR_ID = 'system';
