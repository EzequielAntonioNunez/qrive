import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../unity/AXYRO.Simulation/Assets/WebGLTemplates/UFV/voice.js', import.meta.url), 'utf8');

function voiceAt(now: number) {
  const window = {} as { axyroVoice?: any };
  runInNewContext(source, { window, performance: { now: () => now } });
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
