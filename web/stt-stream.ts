/**
 * Escucha continua para el modo IA en vivo (demo). Mismo protocolo que la respuesta por voz del móvil
 * (voice-mobile.ts): clave temporal de un solo uso (`POST /api/voice/temporary-key` con `{ aiRunId }`),
 * WebSocket de Soniox con el subprotocolo «soniox-api-key», PCM 16 bits a 16 kHz desde un AudioWorklet y
 * detección de fin de frase (`<end>`). El micrófono queda abierto (interrupción por voz) y la conexión se
 * renueva sola si se cierra. El audio no se guarda.
 */
import { normalizeSpeech } from './voice-mobile';

const TARGET_RATE = 16000;
const SOCKET_LIMIT = 256 * 1024;
const WORKLET_SOURCE = `
class UfvLiveCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(1600); this.used = 0; }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;
    for (let i = 0; i < channel.length; i++) {
      this.buffer[this.used++] = channel[i];
      if (this.used === this.buffer.length) { this.port.postMessage(this.buffer, [this.buffer.buffer]); this.buffer = new Float32Array(1600); this.used = 0; }
    }
    return true;
  }
}
registerProcessor('ufv-live-capture', UfvLiveCapture);`;

export type ListenerState = 'off' | 'starting' | 'on' | 'error';
export type ListenerEvents = {
  /** Texto provisional mientras se habla (también sirve para detectar que la persona ha empezado a hablar). */
  onPartial?: (text: string) => void;
  /** Frase completa al detectar el final. */
  onFinal?: (phrase: string) => void;
  onState?: (state: ListenerState, message?: string) => void;
};

export class LiveListener {
  private socket: WebSocket | null = null;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private node: AudioWorkletNode | null = null;
  private finalText = '';
  private active = false;
  private reconnects = 0;
  private samples = new Uint8Array(512);
  private generation = 0;

  constructor(private readonly fetchKey: () => Promise<{ apiKey?: string; websocketUrl?: string }>, private readonly events: ListenerEvents) {}

  get running() { return this.active; }

  /** Debe llamarse dentro de un gesto del usuario (permiso de micrófono y AudioContext en iOS). */
  async start() {
    if (this.active) return;
    this.active = true; this.reconnects = 0;
    const generation = ++this.generation;
    this.events.onState?.('starting');
    try {
      let context: AudioContext;
      try { context = new AudioContext({ sampleRate: TARGET_RATE }); } catch { context = new AudioContext(); }
      this.context = context;
      context.resume().catch(() => undefined);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
      try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
      const source = context.createMediaStreamSource(stream);
      this.analyser = context.createAnalyser(); this.analyser.fftSize = 512;
      const node = new AudioWorkletNode(context, 'ufv-live-capture');
      const sink = context.createGain(); sink.gain.value = 0;
      source.connect(this.analyser); source.connect(node); node.connect(sink); sink.connect(context.destination);
      node.port.onmessage = event => this.send(event.data as Float32Array);
      this.node = node;
      await context.resume();
      await this.connect(generation);
    } catch (cause) {
      if (generation !== this.generation) return;
      const name = (cause as { name?: string })?.name;
      this.shutdown();
      this.events.onState?.('error', name === 'NotAllowedError' ? 'Permite el micrófono en el navegador para hablar con VictorIA.' : String((cause as Error)?.message ?? cause).replace(/^Error: /, '') || 'No se pudo activar el micrófono.');
    }
  }

  private async connect(generation: number) {
    const grant = await this.fetchKey();
    if (generation !== this.generation) return;
    if (!grant.apiKey || !grant.websocketUrl) throw new Error('La conexión de voz no está disponible.');
    const socket = new WebSocket(grant.websocketUrl, ['soniox-api-key', grant.apiKey]);
    this.socket = socket;
    this.finalText = '';
    socket.onopen = () => {
      if (generation !== this.generation) return;
      socket.send(JSON.stringify({ model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: TARGET_RATE, num_channels: 1, language_hints: ['es'], language_hints_strict: true,
        enable_endpoint_detection: true, endpoint_latency_adjustment_level: 2, endpoint_sensitivity: 0.3, max_endpoint_delay_ms: 1200 }));
      this.reconnects = 0;
      this.events.onState?.('on');
    };
    socket.onmessage = event => {
      if (generation !== this.generation || typeof event.data !== 'string') return;
      let payload: { error_code?: unknown; error_message?: string; finished?: boolean; tokens?: { text?: string; is_final?: boolean }[] };
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.error_code) { this.events.onState?.('error', 'El servicio de voz rechazó la conexión.'); return; }
      let provisional = ''; let ended = false;
      for (const token of payload.tokens ?? []) {
        if (token.text === '<end>' || token.text === '<fin>') { ended = true; continue; }
        if (typeof token.text !== 'string') continue;
        if (token.is_final) this.finalText += token.text; else provisional += token.text;
      }
      const now = (this.finalText + provisional).trim();
      if (now) this.events.onPartial?.(now);
      if (ended) { const phrase = this.finalText.trim(); this.finalText = ''; if (phrase) this.events.onFinal?.(phrase); }
    };
    const reopen = () => {
      if (generation !== this.generation || !this.active) return;
      if (this.socket === socket) this.socket = null;
      // La clave temporal es de un solo uso y la sesión de Soniox dura como mucho 10 min: se renueva sola.
      if (this.reconnects++ < 3) window.setTimeout(() => { if (generation === this.generation && this.active) this.connect(generation).catch(() => this.fail(generation)); }, 400 * this.reconnects);
      else this.fail(generation);
    };
    socket.onclose = reopen;
    socket.onerror = () => undefined;
  }

  private fail(generation: number) {
    if (generation !== this.generation) return;
    this.shutdown();
    this.events.onState?.('error', 'Se perdió la conexión de voz. Vuelve a activar el micrófono.');
  }

  private send(samples: Float32Array) {
    const socket = this.socket; const context = this.context;
    if (!socket || socket.readyState !== WebSocket.OPEN || !context) return;
    const ratio = context.sampleRate / TARGET_RATE;
    const out = new Int16Array(Math.ceil(samples.length / ratio));
    let used = 0;
    for (let position = 0; position < samples.length; position += ratio) {
      const value = Math.max(-1, Math.min(1, samples[Math.floor(position)]));
      out[used++] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
    }
    if (socket.bufferedAmount < SOCKET_LIMIT) socket.send(out.subarray(0, used).buffer);
  }

  /** Nivel 0–1 del micrófono. */
  level() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) { const value = (this.samples[i] - 128) / 128; sum += value * value; }
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 5);
  }

  /** Descarta lo oído hasta ahora (por ejemplo, al empezar a hablar VictorIA). */
  reset() { this.finalText = ''; }

  private shutdown() {
    this.active = false;
    if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
    if (this.socket) { this.socket.onclose = null; this.socket.onmessage = null; try { this.socket.close(); } catch { /* cerrado */ } this.socket = null; }
    if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
    if (this.context) { void this.context.close().catch(() => undefined); this.context = null; }
    this.analyser = null;
  }

  stop() {
    this.generation++;
    this.shutdown();
    this.events.onState?.('off');
  }
}

/**
 * ¿Lo oído es eco de lo que VictorIA está diciendo? (altavoces sin cancelación de eco perfecta).
 * Se considera eco si casi todas las palabras oídas están en el texto que suena.
 */
export function looksLikeEcho(heard: string, spoken: string): boolean {
  const words = normalizeSpeech(heard).split(' ').filter(Boolean);
  // Órdenes cortas («sí», «la dos», «opción B») nunca se toman por eco.
  if (words.length <= 3) return false;
  const said = new Set(normalizeSpeech(spoken).split(' '));
  const hits = words.filter(word => said.has(word)).length;
  return hits / words.length >= 0.75;
}

/** ¿La persona ha empezado a hablar por encima de VictorIA? Ignora palabras sueltas que puedan ser eco. */
export function isBargeIn(partial: string, spoken: string): boolean {
  const words = normalizeSpeech(partial).split(' ').filter(Boolean);
  if (!words.length) return false;
  const said = new Set(normalizeSpeech(spoken).split(' '));
  const foreign = words.filter(word => !said.has(word)).length;
  if (words.length === 1) return foreign === 1 && words[0].length > 1;
  return foreign / words.length > 0.4;
}
