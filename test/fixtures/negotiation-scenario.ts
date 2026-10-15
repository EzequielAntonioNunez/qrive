import type { Scenario } from '../../shared/simulation';

/**
 * Escenario de prueba genérico (sin personaje VictorIA, sin etiquetas de indicadores, sin explicaciones ni ideas clave).
 * Ya no forma parte del catálogo: los tests lo usan para cubrir escenarios «planos» y ids estables.
 */
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
