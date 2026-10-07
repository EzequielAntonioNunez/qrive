/**
 * Voz de VictorIA en tiempo real (modo IA en vivo · demo).
 *
 * Soniox TTS por WebSocket (https://soniox.com/docs/api-reference/tts/websocket-api):
 *   POST /api/voice/tts-key → { apiKey, websocketUrl, model, voice, language }
 *   WebSocket(websocketUrl, ['soniox-api-key', apiKey]); por cada frase un `stream_id` nuevo (máx. 5 a la vez):
 *   { stream_id, model, language, voice, audio_format: 'pcm_s16le', sample_rate: 24000 } y { stream_id, text, text_end: true }.
 *   Respuestas: { stream_id, audio: <base64>, audio_end } … { stream_id, terminated: true }; para cortar, { stream_id, cancel: true }.
 * El audio PCM16 se reproduce sin huecos con AudioBufferSourceNodes encadenados y pasa por un AnalyserNode
 * (nivel para la presencia animada). `stop()` corta en seco (interrupción por voz del usuario).
 * Sin Soniox (demo sin conexión o error), se usa la síntesis del navegador como respaldo.
 */

export type TtsGrant = { apiKey: string; websocketUrl: string; model: string; voice: string; language: string };
export type TtsProgress = { text: string; fraction: number; segment: number; segments: number } | null;
export type SpeakResult = 'done' | 'stopped';

const SAMPLE_RATE = 24000;
const MAX_STREAMS = 4;
const IDLE_CLOSE_MS = 18000;

/** Parte el texto en frases (las cortas se unen) para que el primer audio llegue antes. */
export function splitSentences(text: string): string[] {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return [];
  const parts = clean.match(/[^.!?…:;]+[.!?…:;]+["»”)]*\s*|[^.!?…:;]+$/g) ?? [clean];
  const out: string[] = [];
  for (const raw of parts) {
    const part = raw.trim();
    if (!part) continue;
    if (out.length && (out[out.length - 1].length < 40 || part.length < 12)) out[out.length - 1] = `${out[out.length - 1]} ${part}`;
    else out.push(part);
  }
  // Frases muy largas: se cortan por comas para no pasar de ~260 caracteres.
  return out.flatMap(sentence => {
    if (sentence.length <= 260) return [sentence];
    const pieces: string[] = []; let current = '';
    for (const chunk of sentence.split(/(?<=,)\s+/)) {
      if ((current + ' ' + chunk).length > 220 && current) { pieces.push(current.trim()); current = chunk; } else current = `${current} ${chunk}`;
    }
    if (current.trim()) pieces.push(current.trim());
    return pieces;
  });
}

function decodePcm16(base64: string): Float32Array {
  const binary = atob(base64);
  const length = binary.length >> 1;
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let value = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
    if (value >= 0x8000) value -= 0x10000;
    out[i] = value / 32768;
  }
  return out;
}

export interface Speaker {
  readonly kind: 'soniox' | 'browser' | 'none';
  /** Debe llamarse dentro de un gesto del usuario (botón «Empezar»). */
  unlock(): Promise<void>;
  speak(text: string): Promise<SpeakResult>;
  stop(): void;
  /** Nivel 0–1 de la voz que suena ahora (para la presencia animada). */
  level(): number;
  /** Frase que suena y fracción leída (subtítulos sincronizados). */
  progress(): TtsProgress;
  speaking(): boolean;
  dispose(): void;
}

type Segment = { id: string; text: string; chunks: Float32Array[]; scheduled: number; received: boolean; failed: boolean; start: number; end: number; sentAt: number };

/** Soniox TTS en tiempo real con reproducción sin huecos. */
export class SonioxSpeaker implements Speaker {
  readonly kind = 'soniox' as const;
  private context: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private out: GainNode | null = null;
  private socket: WebSocket | null = null;
  private opening: Promise<WebSocket> | null = null;
  private grant: TtsGrant | null = null;
  private segments: Segment[] = [];
  private current = 0;
  private cursor = 0;
  private sources = new Set<AudioBufferSourceNode>();
  private finish: ((result: SpeakResult) => void) | null = null;
  private idleTimer = 0;
  private finishTimer = 0;
  private counter = 0;
  private samples = new Uint8Array(1024);

  constructor(private readonly fetchGrant: () => Promise<TtsGrant>, private readonly onError?: (message: string) => void) {}

  async unlock() {
    if (!this.context) {
      this.context = new AudioContext();
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      this.out = this.context.createGain();
      this.out.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    await this.context.resume().catch(() => undefined);
    // Abre la conexión por adelantado para que la primera frase no espere al handshake.
    void this.open().catch(() => undefined);
  }

  private open(): Promise<WebSocket> {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
    if (this.opening) return this.opening;
    this.opening = (async () => {
      const grant = await this.fetchGrant();
      if (!grant?.apiKey || !grant.websocketUrl) throw new Error('La voz de VictorIA no está disponible.');
      this.grant = grant;
      const socket = new WebSocket(grant.websocketUrl, ['soniox-api-key', grant.apiKey]);
      await new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => reject(new Error('La voz de VictorIA no responde.')), 8000);
        socket.onopen = () => { window.clearTimeout(timer); resolve(); };
        socket.onerror = () => { window.clearTimeout(timer); reject(new Error('No se pudo conectar con la voz de VictorIA.')); };
      });
      socket.onmessage = event => this.onMessage(event);
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null;
        // Si se corta a mitad de una frase, se da por terminada para no quedarse colgado.
        for (const segment of this.segments) if (!segment.received) { segment.received = true; segment.failed = true; }
        this.pump();
      };
      socket.onerror = () => undefined;
      this.socket = socket;
      return socket;
    })().finally(() => { this.opening = null; });
    return this.opening;
  }

  private onMessage(event: MessageEvent) {
    if (typeof event.data !== 'string') return;
    let payload: { stream_id?: string; audio?: string; audio_end?: boolean; terminated?: boolean; error_code?: unknown; error_message?: string };
    try { payload = JSON.parse(event.data); } catch { return; }
    const segment = this.segments.find(item => item.id === payload.stream_id);
    if (payload.error_code) {
      if (segment) { segment.received = true; segment.failed = true; }
      this.onError?.(payload.error_message ? `Voz: ${payload.error_message}` : 'La voz de VictorIA ha fallado en una frase.');
      this.pump(); this.sendPending();
      return;
    }
    if (!segment) return;
    if (payload.audio) segment.chunks.push(decodePcm16(payload.audio));
    if (payload.audio_end || payload.terminated) segment.received = true;
    if (payload.terminated) this.sendPending();
    this.pump();
  }

  /** Envía las frases pendientes respetando el máximo de streams simultáneos. */
  private sendPending() {
    const socket = this.socket;
    const grant = this.grant;
    if (!socket || socket.readyState !== WebSocket.OPEN || !grant) return;
    const inFlight = this.segments.filter(item => item.sentAt > 0 && !item.received).length;
    let free = MAX_STREAMS - inFlight;
    for (const segment of this.segments) {
      if (free <= 0) break;
      if (segment.sentAt > 0) continue;
      segment.sentAt = performance.now();
      socket.send(JSON.stringify({ stream_id: segment.id, model: grant.model, language: grant.language, voice: grant.voice, audio_format: 'pcm_s16le', sample_rate: SAMPLE_RATE }));
      socket.send(JSON.stringify({ stream_id: segment.id, text: segment.text, text_end: true }));
      free--;
    }
  }

  /** Programa el audio recibido en orden de frase, sin huecos. */
  private pump() {
    const context = this.context;
    if (!context || !this.out) return;
    while (this.current < this.segments.length) {
      const segment = this.segments[this.current];
      while (segment.scheduled < segment.chunks.length) {
        const samples = segment.chunks[segment.scheduled++];
        if (!samples.length) continue;
        const buffer = context.createBuffer(1, samples.length, SAMPLE_RATE);
        buffer.copyToChannel(samples as Float32Array<ArrayBuffer>, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(this.out);
        const at = Math.max(this.cursor, context.currentTime + 0.04);
        if (segment.start === 0) segment.start = at;
        source.start(at);
        this.cursor = at + buffer.duration;
        segment.end = this.cursor;
        this.sources.add(source);
        source.onended = () => this.sources.delete(source);
      }
      if (!segment.received) return;
      this.current++;
    }
    // Todo programado: se resuelve cuando acaba de sonar.
    if (this.finish && this.segments.length) {
      window.clearTimeout(this.finishTimer);
      const wait = Math.max(0, (this.cursor - context.currentTime) * 1000) + 60;
      this.finishTimer = window.setTimeout(() => this.settle('done'), wait);
    }
  }

  private settle(result: SpeakResult) {
    window.clearTimeout(this.finishTimer);
    const done = this.finish;
    this.finish = null;
    this.segments = []; this.current = 0;
    this.scheduleIdleClose();
    done?.(result);
  }

  private scheduleIdleClose() {
    window.clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => { if (!this.finish && this.socket) { try { this.socket.close(); } catch { /* cerrado */ } this.socket = null; } }, IDLE_CLOSE_MS);
  }

  async speak(text: string): Promise<SpeakResult> {
    this.stop();
    const sentences = splitSentences(text);
    if (!sentences.length || !this.context) return 'done';
    window.clearTimeout(this.idleTimer);
    await this.context.resume().catch(() => undefined);
    const generation = ++this.counter;
    this.segments = sentences.map((sentence, i) => ({ id: `v${generation}-${i}-${Math.random().toString(36).slice(2, 8)}`, text: sentence, chunks: [], scheduled: 0, received: false, failed: false, start: 0, end: 0, sentAt: 0 }));
    this.current = 0;
    this.cursor = 0;
    const result = new Promise<SpeakResult>(resolve => { this.finish = resolve; });
    try {
      await this.open();
      if (generation !== this.counter) return 'stopped';
      this.sendPending();
    } catch (cause) {
      if (generation === this.counter) { this.onError?.((cause as Error).message); this.settle('done'); }
    }
    return result;
  }

  stop() {
    this.counter++;
    const socket = this.socket;
    for (const segment of this.segments) {
      if (segment.sentAt > 0 && !segment.received && socket?.readyState === WebSocket.OPEN) {
        try { socket.send(JSON.stringify({ stream_id: segment.id, cancel: true })); } catch { /* cerrado */ }
      }
    }
    for (const source of this.sources) { try { source.stop(); } catch { /* ya parado */ } source.disconnect(); }
    this.sources.clear();
    if (this.finish) this.settle('stopped');
    this.segments = []; this.current = 0; this.cursor = 0;
  }

  speaking() { return !!this.finish; }

  level() {
    if (!this.analyser || !this.finish) return 0;
    this.analyser.getByteTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) { const value = (this.samples[i] - 128) / 128; sum += value * value; }
    return Math.min(1, Math.sqrt(sum / this.samples.length) * 4);
  }

  progress(): TtsProgress {
    const context = this.context;
    if (!context || !this.finish || !this.segments.length) return null;
    const now = context.currentTime;
    let index = -1;
    for (let i = 0; i < this.segments.length; i++) if (this.segments[i].start > 0 && this.segments[i].start <= now) index = i;
    if (index < 0) return null;
    const segment = this.segments[index];
    // Mientras llega el audio, la duración se estima (~15 caracteres por segundo).
    const estimated = segment.received ? segment.end - segment.start : Math.max(segment.end - segment.start, segment.text.length / 15);
    return { text: segment.text, fraction: Math.max(0, Math.min(1, (now - segment.start) / Math.max(0.2, estimated))), segment: index, segments: this.segments.length };
  }

  dispose() {
    this.stop();
    window.clearTimeout(this.idleTimer);
    if (this.socket) { this.socket.onclose = null; try { this.socket.close(); } catch { /* cerrado */ } this.socket = null; }
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}

/** Respaldo: síntesis del navegador (demo sin conexión). El nivel se simula a partir de los límites de palabra. */
export class BrowserSpeaker implements Speaker {
  readonly kind: 'browser' | 'none';
  private finish: ((result: SpeakResult) => void) | null = null;
  private sentences: string[] = [];
  private index = 0;
  private charIndex = 0;
  private pulse = 0;
  private voice: SpeechSynthesisVoice | null = null;
  private counter = 0;
  private startedAt = 0;

  constructor() { this.kind = typeof window !== 'undefined' && 'speechSynthesis' in window ? 'browser' : 'none'; }

  async unlock() {
    if (this.kind === 'none') return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices();
      this.voice = voices.find(item => /^es-ES/i.test(item.lang) && /female|mujer|helena|elvira|laura|monica|paulina|sabina/i.test(item.name))
        ?? voices.find(item => /^es-ES/i.test(item.lang)) ?? voices.find(item => /^es/i.test(item.lang)) ?? null;
    };
    pick();
    if (!this.voice) window.speechSynthesis.onvoiceschanged = pick;
    // Desbloqueo en iOS: una locución vacía dentro del gesto.
    try { const warm = new SpeechSynthesisUtterance(' '); warm.volume = 0; window.speechSynthesis.speak(warm); } catch { /* sin síntesis */ }
  }

  speak(text: string): Promise<SpeakResult> {
    this.stop();
    if (this.kind === 'none') return Promise.resolve('done');
    this.sentences = splitSentences(text);
    this.index = 0;
    const generation = ++this.counter;
    const result = new Promise<SpeakResult>(resolve => { this.finish = resolve; });
    const next = () => {
      if (generation !== this.counter) return;
      if (this.index >= this.sentences.length) { const done = this.finish; this.finish = null; done?.('done'); return; }
      const utterance = new SpeechSynthesisUtterance(this.sentences[this.index]);
      utterance.lang = 'es-ES'; utterance.rate = 1.04;
      if (this.voice) utterance.voice = this.voice;
      this.charIndex = 0; this.startedAt = performance.now();
      // Vigilancia: algunos navegadores sin voces nunca emiten «end»; se avanza al tiempo estimado de lectura.
      let started = false; let advanced = false;
      const text = this.sentences[this.index];
      const advance = () => { if (advanced || generation !== this.counter) return; advanced = true; window.clearTimeout(watchdog); this.index++; next(); };
      const watchdog = window.setTimeout(function check() { if (!started) advance(); else window.setTimeout(advance, text.length / 6 * 1000 + 4000); }, text.length / 14 * 1000 + 1500);
      utterance.onstart = () => { started = true; this.startedAt = performance.now(); };
      utterance.onboundary = event => { this.charIndex = event.charIndex; this.pulse = 1; };
      utterance.onend = advance;
      utterance.onerror = advance;
      window.speechSynthesis.speak(utterance);
    };
    next();
    return result;
  }

  stop() {
    this.counter++;
    if (this.kind !== 'none') window.speechSynthesis.cancel();
    const done = this.finish; this.finish = null; done?.('stopped');
  }

  speaking() { return !!this.finish; }

  level() {
    if (!this.finish) return 0;
    this.pulse *= 0.86;
    const t = performance.now() / 1000;
    return Math.min(1, 0.22 + 0.18 * Math.abs(Math.sin(t * 9.1)) * Math.abs(Math.sin(t * 3.7)) + this.pulse * 0.35);
  }

  progress(): TtsProgress {
    if (!this.finish || this.index >= this.sentences.length) return null;
    const text = this.sentences[this.index];
    // Algunos motores no emiten límites de palabra: se estima por tiempo.
    const byTime = (performance.now() - this.startedAt) / 1000 * 14 / Math.max(1, text.length);
    const byBoundary = this.charIndex / Math.max(1, text.length);
    return { text, fraction: Math.min(1, Math.max(byBoundary, byTime)), segment: this.index, segments: this.sentences.length };
  }

  dispose() { this.stop(); }
}

/**
 * Elige el motor: Soniox si el servidor da credencial; si no, el navegador. El motor Soniox cae al navegador si
 * falla al conectar (no se queda en silencio).
 */
export class AdaptiveSpeaker implements Speaker {
  private engine: Speaker;
  private readonly fallback = new BrowserSpeaker();
  private failed = false;
  constructor(fetchGrant: (() => Promise<TtsGrant>) | null, private readonly onNotice?: (message: string) => void) {
    this.engine = fetchGrant ? new SonioxSpeaker(fetchGrant, message => this.fail(message)) : this.fallback;
  }
  get kind() { return this.engine.kind; }
  private fail(message: string) {
    if (this.failed || this.engine === this.fallback) return;
    this.failed = true;
    this.onNotice?.(`${message} Se usa la voz del navegador.`);
    const broken = this.engine;
    this.engine = this.fallback;
    void this.fallback.unlock();
    window.setTimeout(() => broken.dispose(), 0);
  }
  async unlock() { await Promise.all([this.engine.unlock(), this.fallback.unlock()]); }
  async speak(text: string) {
    const engine = this.engine;
    const result = await engine.speak(text);
    // Si Soniox falló durante esta frase, se repite con la voz del navegador.
    if (engine !== this.engine && result === 'done') return this.engine.speak(text);
    return result;
  }
  stop() { this.engine.stop(); }
  level() { return this.engine.level(); }
  progress() { return this.engine.progress(); }
  speaking() { return this.engine.speaking(); }
  dispose() { this.engine.dispose(); this.fallback.dispose(); }
}
