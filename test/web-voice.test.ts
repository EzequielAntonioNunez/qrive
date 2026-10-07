import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../unity/AXYRO.Simulation/Assets/WebGLTemplates/UFV/voice.js', import.meta.url), 'utf8');

function voiceAt(now: number, fetch?: (url: string, init: RequestInit) => Promise<Response>) {
  const window = {} as { axyroVoice?: any };
  runInNewContext(source, { window, performance: { now: () => now }, fetch, location: { href: 'https://axyro.test/simulador/?sesion=session-12345678' }, URL });
  const calls: { method: string; value: string }[] = [];
  const voice = window.axyroVoice!;
  voice.unity = { SendMessage: (_target: string, method: string, value: string) => calls.push({ method, value }) };
  return { voice, calls };
}

describe('voz WebGL: turnos e interrupción', () => {
  it('detiene a VictorIA tras habla reconocida y ejecuta una sola frase final al recibir <end>', () => {
    const { voice, calls } = voiceAt(2000);
    voice.setUnityState(true, false, 0);
    voice.voiceStartAt = 1000;
    voice.lastSpeechAt = 1900;
    voice.onMessage({ data: JSON.stringify({ tokens: [{ text: 'u', is_final: false }] }) }, 0);
    expect(calls).toEqual([]);
    voice.onMessage({ data: JSON.stringify({ tokens: [{ text: 'uno', is_final: false }] }) }, 0);
    expect(calls).toEqual([{ method: 'OnWebVoiceInterrupt', value: '' }]);
    voice.onMessage({ data: JSON.stringify({ tokens: [{ text: 'uno', is_final: true }, { text: '<end>', is_final: true }] }) }, 0);
    expect(calls).toEqual([
      { method: 'OnWebVoiceInterrupt', value: '' },
      { method: 'OnWebVoiceTranscript', value: 'uno' }
    ]);
  });

  it('interpreta una respuesta con palabras propias con Clef y confirma si no está seguro', async () => {
    const replies = [{ kind: 'confirm', option: 2, confidence: 0.6 }, { kind: 'decide', option: 1, confidence: 0.9 }];
    const requests: unknown[] = [];
    const { voice, calls } = voiceAt(2000, async (_url, init) => {
      requests.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify(replies.shift()), { status: 200 });
    });
    voice.setUnityState(false, true, 4);
    await voice.handlePhrase('Primero quitaría los datos personales y luego lo consultaría');
    expect(requests).toEqual([{ sessionId: 'session-12345678', phrase: 'Primero quitaría los datos personales y luego lo consultaría' }]);
    expect(calls).toEqual([]);
    voice.handlePhrase('Sí');
    expect(calls).toEqual([{ method: 'OnWebVoiceTranscript', value: 'tres' }]);
    await voice.handlePhrase('Lo haría con la herramienta autorizada de la universidad');
    expect(calls.at(-1)).toEqual({ method: 'OnWebVoiceTranscript', value: 'dos' });
    voice.handlePhrase('la cuatro');
    expect(calls.at(-1)).toEqual({ method: 'OnWebVoiceTranscript', value: 'la cuatro' });
    expect(requests).toHaveLength(2);
  });

  it('ignora ruido sin palabras y no usa texto provisional como decisión', () => {
    const { voice, calls } = voiceAt(2000);
    voice.setUnityState(true, false, 0);
    voice.voiceStartAt = 1000;
    voice.lastSpeechAt = 0;
    voice.onMessage({ data: JSON.stringify({ tokens: [{ text: 'dos', is_final: false }] }) }, 0);
    expect(calls).toEqual([]);
    voice.onMessage({ data: JSON.stringify({ tokens: [{ text: '<end>', is_final: true }] }) }, 0);
    expect(calls).toEqual([]);
  });
});

describe('voz en el móvil: interrupción de VictorIA (misma regla que voice.js)', async () => {
  const { shouldBargeIn, nextSpeechMs } = await import('../web/voice-mobile');
  const base = { speakingForMs: 1200, interrupted: false, sinceSpeechMs: 200, heard: 'quiero' };
  it('corta el audio con habla reciente y una palabra reconocida mientras suena VictorIA', () => {
    expect(shouldBargeIn(base)).toBe(true);
  });
  it('no corta sin audio sonando, en los primeros 350 ms, sin energía reciente, con una sola letra o si ya se cortó', () => {
    expect(shouldBargeIn({ ...base, speakingForMs: null })).toBe(false);
    expect(shouldBargeIn({ ...base, speakingForMs: 200 })).toBe(false);
    expect(shouldBargeIn({ ...base, sinceSpeechMs: 1500 })).toBe(false);
    expect(shouldBargeIn({ ...base, heard: 'u' })).toBe(false);
    expect(shouldBargeIn({ ...base, heard: '1 2' })).toBe(false);
    expect(shouldBargeIn({ ...base, interrupted: true })).toBe(false);
  });
  it('acumula voz por energía y la descarta con silencio', () => {
    const loud = new Float32Array(1600).fill(0.1);
    const quiet = new Float32Array(1600);
    let ms = 0;
    ms = nextSpeechMs(ms, loud, 16000);
    expect(ms).toBe(100);
    ms = nextSpeechMs(ms, loud, 16000);
    expect(ms).toBe(200);
    ms = nextSpeechMs(ms, quiet, 16000);
    expect(ms).toBe(0);
  });
});
