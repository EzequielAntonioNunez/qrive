import { describe, expect, it } from 'vitest';
import { clefRequest, interpretClef } from '../worker/voice-intent';
import { defaultScenario } from '../shared/simulation';

const answer = (choice: string, probability: number) => ({ answers: { opcion: { choice, probabilities: { [choice]: probability } } } });

describe('respuesta libre por voz con Clef', () => {
  it('ofrece las opciones de la fase y una salida «ninguna»', () => {
    const phase = defaultScenario.phases[0];
    const request = clefRequest(phase, 'haría la tres');
    expect(Object.keys(request.questions.opcion.criteria)).toEqual([...phase.options.map((_, i) => `opcion_${i + 1}`), 'ninguna']);
    expect(request.questions.opcion.type).toBe('choice');
    expect(request.questions.opcion.instructions).toBeTruthy();
  });

  it('decide con confianza alta, pide confirmación con confianza media y no decide con baja', () => {
    expect(interpretClef(answer('opcion_3', 0.82), 4)).toEqual({ kind: 'decide', option: 2, confidence: 0.82 });
    expect(interpretClef(answer('opcion_1', 0.6), 4)).toEqual({ kind: 'confirm', option: 0, confidence: 0.6 });
    expect(interpretClef(answer('opcion_1', 0.3), 4)).toMatchObject({ kind: 'unclear' });
  });

  it('nunca decide con «ninguna», opciones fuera de rango o respuestas mal formadas', () => {
    expect(interpretClef(answer('ninguna', 0.99), 4)).toMatchObject({ kind: 'unclear' });
    expect(interpretClef(answer('opcion_4', 0.99), 3)).toMatchObject({ kind: 'unclear' });
    expect(interpretClef(null, 4)).toMatchObject({ kind: 'unclear', confidence: 0 });
    expect(interpretClef({ answers: { opcion: { choice: 'opcion_2' } } }, 4)).toMatchObject({ kind: 'unclear' });
  });
});
