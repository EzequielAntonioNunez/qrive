import { describe, expect, it } from 'vitest';
import { defaultScenario, type Phase } from '../shared/simulation';
import { MAX_WORDS, benchmarkComment, benchmarkSentence, revealComment, shortLabel } from '../web/projector-voice';

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const phase = (labels: string[], bestIndex = 0): Phase => ({
  ...defaultScenario.phases[0],
  options: labels.map((label, i) => ({ ...defaultScenario.phases[0].options[0], id: `o${i}`, label, quality: i === bestIndex ? 'best' : 'poor' }))
});

describe('comentarios de VictorIA en el proyector (plantillas)', () => {
  it('shortLabel corta en límite de palabra con «…» y quita el punto final', () => {
    expect(shortLabel('Anonimizar los datos.')).toBe('Anonimizar los datos');
    const long = shortLabel('Copiar el informe completo con nombres y diagnósticos en un chat público para que lo resuma rápido');
    expect(long.length).toBeLessThanOrEqual(60);
    expect(long.endsWith('…')).toBe(true);
    expect(long).not.toMatch(/\s…$/);
  });

  it('sin votos o sin mejor opción, no hay comentario', () => {
    expect(revealComment(phase(['A', 'B']), [0, 0], 0)).toBeNull();
    const unrated = { ...phase(['A', 'B']), options: phase(['A', 'B']).options.map(option => ({ ...option, quality: undefined })) };
    expect(revealComment(unrated, [3, 1], 0)).toBeNull();
  });

  it('mayoría, división y minoría con porcentajes redondeados; la segunda opción solo si llega al 15 %', () => {
    const p = phase(['Anonimizar los datos antes de usar la herramienta', 'Pegarlo tal cual en un chat público', 'Preguntar a un compañero']);
    const majority = revealComment(p, [13, 4, 3], 0)!;
    expect(majority).toContain('65 %');
    expect(majority).toContain('Anonimizar los datos');
    expect(majority).toContain('20 %');
    expect(majority).toContain('Pegarlo tal cual');
    expect(revealComment(p, [18, 2, 0], 0)).not.toContain('Pegarlo');
    expect(revealComment(p, [5, 5, 0], 1)).toContain('50 %');
    const minority = revealComment(p, [1, 8, 1], 0)!;
    expect(minority).toContain('10 %');
    expect(minority).toContain('80 %');
    expect(revealComment(p, [0, 3, 1], 0)).toContain('nadie la ha elegido');
    // Variantes deterministas por situación.
    expect(revealComment(p, [13, 4, 3], 0)).toBe(revealComment(p, [13, 4, 3], 3));
    expect(revealComment(p, [13, 4, 3], 0)).not.toBe(revealComment(p, [13, 4, 3], 1));
  });

  it('nunca pasa de 35 palabras ni habla de personas concretas', () => {
    const long = 'Redactar un correo detallado al responsable del proyecto explicando todas las implicaciones legales y técnicas del caso';
    const p = phase([long, `${long} con copia a todo el departamento`, 'Otra']);
    for (let i = 0; i < 6; i++) for (const counts of [[5, 4, 1], [1, 8, 1], [9, 1, 0], [0, 5, 5]]) {
      const text = revealComment(p, counts, i)!;
      expect(words(text), text).toBeLessThanOrEqual(MAX_WORDS);
      expect(text).not.toMatch(/NaN|undefined/);
    }
    for (const phaseDef of defaultScenario.phases) {
      const text = revealComment(phaseDef, phaseDef.options.map((_, i) => i + 1), 2);
      if (text) expect(words(text)).toBeLessThanOrEqual(MAX_WORDS);
    }
  });

  it('comparación con la media: frase neutra y nunca una cifra inventada', () => {
    expect(benchmarkSentence(0.72, null)).toBe('Primera sesión de la organización: aún no hay media con la que comparar.');
    expect(benchmarkSentence(null, 0.5)).toContain('Aún no hay decisiones');
    expect(benchmarkSentence(0.72, 0.58)).toContain('por encima');
    expect(benchmarkSentence(0.5, 0.58)).toContain('por debajo');
    expect(benchmarkSentence(0.6, 0.58)).toContain('en línea');
    expect(benchmarkComment(0.72, 0.58)).toContain('72 %');
    expect(benchmarkComment(0.72, 0.58)).toContain('58 %');
    // Sin media: solo la cifra de la clase, nunca una media inventada.
    expect(benchmarkComment(0.72, null)).toContain('primera sesión');
    expect(benchmarkComment(0.72, null).match(/\d+ %/g)).toEqual(['72 %']);
  });
});
