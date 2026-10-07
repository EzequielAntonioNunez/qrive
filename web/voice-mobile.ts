/**
 * Respuesta por voz en el móvil. Mismo protocolo que el simulador web (plantilla UFV de Unity, voice.js):
 * /api/voice/config → /api/voice/temporary-key → WebSocket de Soniox con el subprotocolo «soniox-api-key»,
 * PCM 16 bits a 16 kHz desde un AudioWorklet y detección de fin de frase (`<end>`).
 * Las órdenes cortas («la dos», «opción B») deciden directamente; las frases libres se interpretan en el servidor
 * (`/api/voice/interpret`) con un modelo de IA, que pide confirmación si duda. El audio no se guarda.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { guestApi } from './guest';

const TARGET_RATE = 16000;
const SOCKET_LIMIT = 256 * 1024;
const WORKLET_SOURCE = `
class UfvCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(2048); this.used = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.used++] = channel[i];
      if (this.used === this.buffer.length) { this.port.postMessage(this.buffer, [this.buffer.buffer]); this.buffer = new Float32Array(2048); this.used = 0; }
    }
    return true;
  }
}
registerProcessor('ufv-capture', UfvCapture);`;

export type VoicePhase = 'unavailable' | 'off' | 'notice' | 'starting' | 'listening' | 'thinking' | 'confirm' | 'error';
export type VoiceConfig = { enabled: boolean; region: string; websocketUrl: string | null };

export const normalizeSpeech = (value: string) => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

const SHORT_OPTION: RegExp[] = [
  /^(?:(?:la|el) )?(?:opcion |respuesta |letra )?(?:1|uno|una|primer[oa]?|a)$/,
  /^(?:(?:la|el) )?(?:opcion |respuesta |letra )?(?:2|dos|segund[oa]|b|be)$/,
  /^(?:(?:la|el) )?(?:opcion |respuesta |letra )?(?:3|tres|tercer[oa]?|c|ce)$/,
  /^(?:(?:la|el) )?(?:opcion |respuesta |letra )?(?:4|cuatro|cuart[oa]|d|de)$/
];
/** Índice de opción si la frase es una orden corta («la dos», «opción B», «tercera»); si no, null. */
export function shortOption(phrase: string, count: number): number | null {
  const text = normalizeSpeech(phrase).replace(/^(?:elijo|escojo|me quedo con|quiero) /, '');
  if (text.split(' ').length > 4) return null;
  const index = SHORT_OPTION.findIndex(pattern => pattern.test(text));
  return index >= 0 && index < count ? index : null;
}

type Options = {
  sessionId: string;
  optionCount: number;
  canDecide: boolean;
  /** Decide la opción (índice). Devuelve una promesa para mostrar el resultado. */
  onChoose: (index: number) => void;
};

export function useMobileVoice({ sessionId, optionCount, canDecide, onChoose }: Options) {
  const [config, setConfig] = useState<VoiceConfig | null>(null);
  const [phase, setPhase] = useState<VoicePhase>('unavailable');
  const [status, setStatus] = useState('');
  const [heard, setHeard] = useState('');
  const [pending, setPending] = useState<number | null>(null);
  const live = useRef({ optionCount, canDecide, onChoose, pending: null as number | null });
  live.current.optionCount = optionCount; live.current.canDecide = canDecide; live.current.onChoose = onChoose; live.current.pending = pending;
  const res = useRef<{ socket: WebSocket | null; stream: MediaStream | null; context: AudioContext | null; source: MediaStreamAudioSourceNode | null; node: AudioWorkletNode | null; sink: GainNode | null; finalText: string; generation: number; accepted: boolean }>({ socket: null, stream: null, context: null, source: null, node: null, sink: null, finalText: '', generation: 0, accepted: false });

  const supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined' && typeof AudioWorkletNode !== 'undefined' && window.isSecureContext;

  useEffect(() => {
    if (!supported) return;
    let alive = true;
    guestApi<VoiceConfig>('/voice/config').then(result => { if (alive && result.enabled && result.websocketUrl) { setConfig(result); setPhase('off'); } }).catch(() => undefined);
    return () => { alive = false; };
  }, [supported]);

  const release = useCallback(() => {
    const r = res.current;
    r.generation += 1; r.finalText = '';
    if (r.node) { r.node.port.onmessage = null; r.node.disconnect(); r.node = null; }
    if (r.source) { r.source.disconnect(); r.source = null; }
    if (r.sink) { r.sink.disconnect(); r.sink = null; }
    if (r.context) { r.context.close().catch(() => undefined); r.context = null; }
    if (r.stream) { r.stream.getTracks().forEach(track => track.stop()); r.stream = null; }
    if (r.socket) { r.socket.onclose = null; r.socket.onerror = null; r.socket.onmessage = null; try { r.socket.close(); } catch { /* ya cerrado */ } r.socket = null; }
  }, []);

  const stop = useCallback((message = '') => {
    release();
    setPending(null); setHeard('');
    setPhase(current => current === 'unavailable' ? current : message ? 'error' : 'off');
    setStatus(message);
  }, [release]);

  // Se apaga al ocultar la página, al salir y al desmontar.
  useEffect(() => {
    const onHide = () => { if (document.hidden) stop(); };
    const onLeave = () => release();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onLeave);
    return () => { document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onLeave); release(); };
  }, [stop, release]);

  const choose = useCallback((index: number, prefix: string) => {
    setPending(null);
    setPhase('listening');
    setStatus(`${prefix}: opción ${String.fromCharCode(65 + index)}.`);
    live.current.onChoose(index);
  }, []);

  const interpret = useCallback(async (phrase: string) => {
    const generation = res.current.generation;
    setPhase('thinking'); setStatus(`Interpretando «${phrase.slice(0, 90)}»…`);
    let result: { kind?: string; option?: number } | null = null;
    try { result = await guestApi('/voice/interpret', { method: 'POST', body: JSON.stringify({ sessionId, phrase }) }); }
    catch (cause) { result = null; if (generation === res.current.generation) setStatus(String(cause).replace(/^Error: /, '')); }
    if (generation !== res.current.generation) return;
    const { optionCount: count, canDecide: open } = live.current;
    if (!open) { setPhase('listening'); return; }
    const option = typeof result?.option === 'number' ? result.option : -1;
    if (!result || result.kind === 'unclear' || option < 0 || option >= count) { setPhase('listening'); setStatus('No lo he entendido. Dilo de otra forma, di la letra de la opción o tócala en la pantalla.'); return; }
    if (result.kind === 'decide') { choose(option, 'Entendido'); return; }
    setPending(option); setPhase('confirm');
    setStatus(`¿Te refieres a la opción ${String.fromCharCode(65 + option)}? Di «sí» o «no», o toca un botón.`);
  }, [sessionId, choose]);

  const handlePhrase = useCallback((phrase: string) => {
    const text = normalizeSpeech(phrase);
    setHeard(phrase);
    const waiting = live.current.pending;
    if (waiting != null) {
      if (/^(si|vale|correcto|exacto|eso|confirmo|claro)\b/.test(text)) { choose(waiting, 'Confirmado'); return; }
      if (/^no\b/.test(text)) { setPending(null); setPhase('listening'); setStatus('De acuerdo. Dime qué harías o di la letra de la opción.'); return; }
    }
    const { optionCount: count, canDecide: open } = live.current;
    if (!open || count === 0) { setStatus(`He oído: «${phrase.slice(0, 110)}». Ahora no hay opciones para elegir.`); return; }
    const direct = shortOption(phrase, count);
    if (direct !== null) { choose(direct, 'Entendido'); return; }
    void interpret(phrase);
  }, [choose, interpret]);

  const start = useCallback(async () => {
    if (!config) return;
    if (config.region !== 'eu' && !res.current.accepted) { setPhase('notice'); setStatus(''); return; }
    release();
    const generation = res.current.generation;
    setPhase('starting'); setStatus('Activando el micrófono…'); setHeard('');
    try {
      // iOS Safari: el AudioContext y el permiso se piden dentro del gesto del usuario, antes de cualquier await de red.
      let context: AudioContext;
      try { context = new AudioContext({ sampleRate: TARGET_RATE }); } catch { context = new AudioContext(); }
      res.current.context = context;
      context.resume().catch(() => undefined);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      if (generation !== res.current.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      res.current.stream = stream;
      const grant = await guestApi<{ apiKey?: string; websocketUrl?: string }>('/voice/temporary-key', { method: 'POST', body: JSON.stringify({ sessionId }) });
      if (generation !== res.current.generation) return;
      if (!grant.apiKey || grant.websocketUrl !== config.websocketUrl) throw new Error('La conexión de voz no está disponible.');
      const socket = new WebSocket(grant.websocketUrl, ['soniox-api-key', grant.apiKey]);
      res.current.socket = socket;
      socket.onerror = () => { if (generation === res.current.generation) stop('Se perdió la conexión de voz. Actívala de nuevo.'); };
      socket.onclose = () => { if (generation === res.current.generation) stop('La conexión de voz terminó. Actívala de nuevo.'); };
      socket.onmessage = event => {
        if (generation !== res.current.generation || typeof event.data !== 'string') return;
        let payload: { error_code?: unknown; finished?: boolean; tokens?: { text?: string; is_final?: boolean }[] };
        try { payload = JSON.parse(event.data); } catch { return; }
        if (payload.error_code) { stop('El servicio de voz rechazó la conexión. Actívala de nuevo.'); return; }
        let provisional = ''; let ended = false;
        for (const token of payload.tokens ?? []) {
          if (token.text === '<end>' || token.text === '<fin>') { ended = true; continue; }
          if (typeof token.text !== 'string') continue;
          if (token.is_final) res.current.finalText += token.text; else provisional += token.text;
        }
        const now = (res.current.finalText + provisional).trim();
        if (now) setHeard(now);
        if (ended) { const phrase = res.current.finalText.trim(); res.current.finalText = ''; if (phrase) handlePhrase(phrase); }
        if (payload.finished) stop('La sesión de voz terminó. Actívala de nuevo.');
      };
      socket.onopen = async () => {
        if (generation !== res.current.generation) return;
        try {
          socket.send(JSON.stringify({ model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: TARGET_RATE, num_channels: 1, language_hints: ['es'], language_hints_strict: true,
            enable_endpoint_detection: true, endpoint_latency_adjustment_level: 2, endpoint_sensitivity: 0.3, max_endpoint_delay_ms: 1500 }));
          const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
          try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
          if (generation !== res.current.generation || !res.current.stream) return;
          const source = context.createMediaStreamSource(res.current.stream);
          const node = new AudioWorkletNode(context, 'ufv-capture');
          const sink = context.createGain(); sink.gain.value = 0;
          node.port.onmessage = event => {
            const samples = event.data as Float32Array;
            if (socket.readyState !== WebSocket.OPEN) return;
            // Remuestreo simple si el navegador no aceptó 16 kHz (Safari suele dar 44,1 o 48 kHz).
            const ratio = context.sampleRate / TARGET_RATE;
            const out = new Int16Array(Math.ceil(samples.length / ratio));
            let used = 0;
            for (let position = 0; position < samples.length; position += ratio) {
              const value = Math.max(-1, Math.min(1, samples[Math.floor(position)]));
              out[used++] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
            }
            if (socket.bufferedAmount < SOCKET_LIMIT) socket.send(out.subarray(0, used).buffer);
          };
          source.connect(node); node.connect(sink); sink.connect(context.destination);
          Object.assign(res.current, { source, node, sink });
          await context.resume();
          setPhase('listening');
          setStatus('Te escucho. Explica qué harías con tus palabras o di la letra de la opción.');
        } catch { if (generation === res.current.generation) stop('Este navegador no permite procesar el audio. Responde tocando la opción.'); }
      };
    } catch (cause) {
      if (generation !== res.current.generation) return;
      const name = (cause as { name?: string })?.name;
      stop(name === 'NotAllowedError' ? 'Permite el micrófono en el navegador para responder con la voz.' : String((cause as Error)?.message ?? cause).replace(/^Error: /, '') || 'No se pudo activar el micrófono.');
    }
  }, [config, release, stop, sessionId, handlePhrase]);

  const accept = useCallback(() => { res.current.accepted = true; void start(); }, [start]);
  const confirm = useCallback((yes: boolean) => {
    const waiting = live.current.pending;
    if (waiting == null) return;
    if (yes) choose(waiting, 'Confirmado');
    else { setPending(null); setPhase(res.current.socket ? 'listening' : 'off'); setStatus('De acuerdo. Dime qué harías o toca la opción.'); }
  }, [choose]);

  return { available: phase !== 'unavailable', config, phase, status, heard, pending, start, stop: () => stop(), accept, confirm };
}
