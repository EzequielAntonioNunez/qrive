/*
 * Modo IA en vivo en 3D (/simulador/?ia=<runId>): VictorIA plantea en la escena de Unity las situaciones que la IA
 * genera a partir de los documentos del docente, las narra con voz en tiempo real, escucha la respuesta hablada
 * (micrófono abierto, se la puede interrumpir) y reacciona. Mismo bucle y mismo protocolo que la consola
 * (web/page-ai-live.tsx): next → narrar → escuchar → answer → reacción → next…
 *
 * Todo lo que habla con servicios vive aquí, en el navegador; Unity no tiene claves ni llama a la IA:
 *   - API: GET /api/ai-runs/:id, POST /api/ai-runs/:id/next y /answer (solo el docente dueño de la partida).
 *   - Voz de VictorIA: POST /api/voice/tts-key → WebSocket TTS de Soniox (voz Carmen, PCM 24 kHz) reproducido con
 *     WebAudio (port de web/tts-stream.ts). Un AnalyserNode da el nivel y un visema aproximado para la boca.
 *   - Escucha: POST /api/voice/temporary-key { aiRunId } → WebSocket STT de Soniox (port de web/stt-stream.ts).
 * Unity recibe por SendMessage('AXYRO Demo', …): AiSituation, AiState, AiSpeaking, AiLip, AiSubtitle, AiReaction,
 * AiSummary y AiError; y devuelve las órdenes del participante con AxyroAiCommand → command().
 * Transparencia (AI Act): el distintivo de contenido generado con IA está en Unity y en la pantalla de inicio.
 * La valoración es de la decisión, nunca de la persona; no se infieren emociones. El audio no se guarda.
 */
(function () {
  'use strict';

  // ---------- Utilidades puras (las prueba test/web-ai-live.test.ts) ----------

  const normalize = value => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

  const SHORT_OPTION = [
    /^(?:(?:la|el) )?(?:opcion |respuesta |letra )?(?:1|uno|una|primer[oa]?|a)$/,
    /^(?:(?:la|el) )?(?:opcion |respuesta |letra )?(?:2|dos|segund[oa]|b|be)$/,
    /^(?:(?:la|el) )?(?:opcion |respuesta |letra )?(?:3|tres|tercer[oa]?|c|ce)$/,
    /^(?:(?:la|el) )?(?:opcion |respuesta |letra )?(?:4|cuatro|cuart[oa]|d|de)$/
  ];
  /** Índice de opción si la frase es una orden corta («la dos», «opción B», «tercera»); si no, null. */
  function shortOption(phrase, count) {
    const text = normalize(phrase).replace(/^(?:elijo|escojo|me quedo con|quiero) /, '');
    if (text.split(' ').length > 4) return null;
    const index = SHORT_OPTION.findIndex(pattern => pattern.test(text));
    return index >= 0 && index < count ? index : null;
  }

  /** Parte el texto en frases (las cortas se unen) para que el primer audio llegue antes. */
  function splitSentences(text) {
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return [];
    const parts = clean.match(/[^.!?…:;]+[.!?…:;]+["»”)]*\s*|[^.!?…:;]+$/g) || [clean];
    const out = [];
    for (const raw of parts) {
      const part = raw.trim();
      if (!part) continue;
      if (out.length && (out[out.length - 1].length < 40 || part.length < 12)) out[out.length - 1] = out[out.length - 1] + ' ' + part;
      else out.push(part);
    }
    const result = [];
    for (const sentence of out) {
      if (sentence.length <= 260) { result.push(sentence); continue; }
      let current = '';
      for (const chunk of sentence.split(/(?<=,)\s+/)) {
        if ((current + ' ' + chunk).length > 220 && current) { result.push(current.trim()); current = chunk; } else current = current + ' ' + chunk;
      }
      if (current.trim()) result.push(current.trim());
    }
    return result;
  }

  /** ¿Lo oído es eco de lo que VictorIA está diciendo? Las órdenes cortas nunca se toman por eco. */
  function looksLikeEcho(heard, spoken) {
    const words = normalize(heard).split(' ').filter(Boolean);
    if (words.length <= 3) return false;
    const said = new Set(normalize(spoken).split(' '));
    return words.filter(word => said.has(word)).length / words.length >= 0.75;
  }

  /** ¿La persona ha empezado a hablar por encima de VictorIA? Ignora palabras sueltas que puedan ser eco. */
  function isBargeIn(partial, spoken) {
    const words = normalize(partial).split(' ').filter(Boolean);
    if (!words.length) return false;
    const said = new Set(normalize(spoken).split(' '));
    const foreign = words.filter(word => !said.has(word)).length;
    if (words.length === 1) return foreign === 1 && words[0].length > 1;
    return foreign / words.length > 0.4;
  }

  // Visemas de AxyroTutor3D: 0 A, 1 I, 2 U, 3 E, 4 O, 5 reposo.
  const VISEME_REST = 5;
  /**
   * Visema aproximado a partir del espectro (getByteFrequencyData): centroide entre 150 Hz y 4 kHz (de U, la más
   * grave, a I, la más aguda) y fricativas por la energía de 4-8 kHz. No es reconocimiento fonético: basta para que
   * la boca no abra siempre igual.
   */
  function visemeFromSpectrum(bins, sampleRate, fftSize) {
    const hz = sampleRate / fftSize;
    let total = 0, weighted = 0, high = 0;
    const from = Math.max(1, Math.floor(150 / hz)), to = Math.min(bins.length, Math.ceil(4000 / hz));
    for (let i = from; i < to; i++) { total += bins[i]; weighted += bins[i] * i * hz; }
    for (let i = to; i < Math.min(bins.length, Math.ceil(8000 / hz)); i++) high += bins[i];
    if (total < (to - from) * 8) return VISEME_REST;
    if (high > total * 0.9) return 1;
    const centroid = weighted / total;
    return centroid < 650 ? 2 : centroid < 900 ? 4 : centroid < 1350 ? 0 : centroid < 1800 ? 3 : 1;
  }

  function decodePcm16(base64) {
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

  // ---------- Voz de VictorIA: Soniox TTS en tiempo real (port de web/tts-stream.ts) ----------

  const TTS_RATE = 24000;
  const MAX_STREAMS = 4;
  const IDLE_CLOSE_MS = 18000;

  class SonioxSpeaker {
    constructor(fetchGrant, onError) {
      this.kind = 'soniox';
      this.fetchGrant = fetchGrant; this.onError = onError;
      this.context = null; this.analyser = null; this.out = null; this.socket = null; this.opening = null; this.grant = null;
      this.segments = []; this.current = 0; this.cursor = 0; this.sources = new Set(); this.finish = null;
      this.idleTimer = 0; this.finishTimer = 0; this.counter = 0;
      this.samples = new Uint8Array(1024); this.spectrum = new Uint8Array(512);
    }
    async unlock() {
      if (!this.context) {
        this.context = new AudioContext();
        this.analyser = this.context.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.smoothingTimeConstant = 0.5;
        this.out = this.context.createGain();
        this.out.connect(this.analyser);
        this.analyser.connect(this.context.destination);
      }
      await this.context.resume().catch(() => undefined);
      this.open().catch(() => undefined);
    }
    open() {
      if (this.socket && this.socket.readyState === WebSocket.OPEN) return Promise.resolve(this.socket);
      if (this.opening) return this.opening;
      this.opening = (async () => {
        const grant = await this.fetchGrant();
        if (!grant || !grant.apiKey || !grant.websocketUrl) throw new Error('La voz de VictorIA no está disponible.');
        this.grant = grant;
        const socket = new WebSocket(grant.websocketUrl, ['soniox-api-key', grant.apiKey]);
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('La voz de VictorIA no responde.')), 8000);
          socket.onopen = () => { clearTimeout(timer); resolve(); };
          socket.onerror = () => { clearTimeout(timer); reject(new Error('No se pudo conectar con la voz de VictorIA.')); };
        });
        socket.onmessage = event => this.onMessage(event);
        socket.onclose = () => {
          if (this.socket === socket) this.socket = null;
          for (const segment of this.segments) if (!segment.received) { segment.received = true; segment.failed = true; }
          this.pump();
        };
        socket.onerror = () => undefined;
        this.socket = socket;
        return socket;
      })().finally(() => { this.opening = null; });
      return this.opening;
    }
    onMessage(event) {
      if (typeof event.data !== 'string') return;
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      const segment = this.segments.find(item => item.id === payload.stream_id);
      if (payload.error_code) {
        if (segment) { segment.received = true; segment.failed = true; }
        if (this.onError) this.onError(payload.error_message ? 'Voz: ' + payload.error_message : 'La voz de VictorIA ha fallado en una frase.');
        this.pump(); this.sendPending();
        return;
      }
      if (!segment) return;
      if (payload.audio) segment.chunks.push(decodePcm16(payload.audio));
      if (payload.audio_end || payload.terminated) segment.received = true;
      if (payload.terminated) this.sendPending();
      this.pump();
    }
    sendPending() {
      const socket = this.socket, grant = this.grant;
      if (!socket || socket.readyState !== WebSocket.OPEN || !grant) return;
      let free = MAX_STREAMS - this.segments.filter(item => item.sentAt > 0 && !item.received).length;
      for (const segment of this.segments) {
        if (free <= 0) break;
        if (segment.sentAt > 0) continue;
        segment.sentAt = performance.now();
        socket.send(JSON.stringify({ stream_id: segment.id, model: grant.model, language: grant.language, voice: grant.voice, audio_format: 'pcm_s16le', sample_rate: TTS_RATE }));
        socket.send(JSON.stringify({ stream_id: segment.id, text: segment.text, text_end: true }));
        free--;
      }
    }
    pump() {
      const context = this.context;
      if (!context || !this.out) return;
      while (this.current < this.segments.length) {
        const segment = this.segments[this.current];
        while (segment.scheduled < segment.chunks.length) {
          const samples = segment.chunks[segment.scheduled++];
          if (!samples.length) continue;
          const buffer = context.createBuffer(1, samples.length, TTS_RATE);
          buffer.copyToChannel(samples, 0);
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
      if (this.finish && this.segments.length) {
        clearTimeout(this.finishTimer);
        const wait = Math.max(0, (this.cursor - context.currentTime) * 1000) + 60;
        this.finishTimer = setTimeout(() => this.settle('done'), wait);
      }
    }
    settle(result) {
      clearTimeout(this.finishTimer);
      const done = this.finish;
      this.finish = null;
      this.segments = []; this.current = 0;
      this.scheduleIdleClose();
      if (done) done(result);
    }
    scheduleIdleClose() {
      clearTimeout(this.idleTimer);
      this.idleTimer = setTimeout(() => { if (!this.finish && this.socket) { try { this.socket.close(); } catch { /* cerrado */ } this.socket = null; } }, IDLE_CLOSE_MS);
    }
    async speak(text) {
      this.stop();
      const sentences = splitSentences(text);
      if (!sentences.length || !this.context) return 'done';
      clearTimeout(this.idleTimer);
      await this.context.resume().catch(() => undefined);
      const generation = ++this.counter;
      this.segments = sentences.map((sentence, i) => ({ id: 'v' + generation + '-' + i + '-' + Math.random().toString(36).slice(2, 8), text: sentence, chunks: [], scheduled: 0, received: false, failed: false, start: 0, end: 0, sentAt: 0 }));
      this.current = 0; this.cursor = 0;
      const result = new Promise(resolve => { this.finish = resolve; });
      try {
        await this.open();
        if (generation !== this.counter) return 'stopped';
        this.sendPending();
      } catch (cause) {
        if (generation === this.counter) { if (this.onError) this.onError(cause && cause.message); this.settle('done'); }
      }
      return result;
    }
    stop() {
      this.counter++;
      const socket = this.socket;
      for (const segment of this.segments) {
        if (segment.sentAt > 0 && !segment.received && socket && socket.readyState === WebSocket.OPEN) {
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
    viseme() {
      if (!this.analyser || !this.finish) return VISEME_REST;
      this.analyser.getByteFrequencyData(this.spectrum);
      return visemeFromSpectrum(this.spectrum, this.context.sampleRate, this.analyser.fftSize);
    }
    progress() {
      const context = this.context;
      if (!context || !this.finish || !this.segments.length) return null;
      const now = context.currentTime;
      let index = -1;
      for (let i = 0; i < this.segments.length; i++) if (this.segments[i].start > 0 && this.segments[i].start <= now) index = i;
      if (index < 0) return null;
      const segment = this.segments[index];
      const estimated = segment.received ? segment.end - segment.start : Math.max(segment.end - segment.start, segment.text.length / 15);
      return { text: segment.text, fraction: Math.max(0, Math.min(1, (now - segment.start) / Math.max(0.2, estimated))), segment: index, segments: this.segments.length };
    }
    dispose() {
      this.stop();
      clearTimeout(this.idleTimer);
      if (this.socket) { this.socket.onclose = null; try { this.socket.close(); } catch { /* cerrado */ } this.socket = null; }
      if (this.context) this.context.close().catch(() => undefined);
      this.context = null;
    }
  }

  /** Respaldo: síntesis del navegador. El nivel y el visema se simulan a partir de los límites de palabra. */
  class BrowserSpeaker {
    constructor() {
      this.kind = typeof window !== 'undefined' && 'speechSynthesis' in window ? 'browser' : 'none';
      this.finish = null; this.sentences = []; this.index = 0; this.charIndex = 0; this.pulse = 0; this.voice = null; this.counter = 0; this.startedAt = 0;
    }
    async unlock() {
      if (this.kind === 'none') return;
      const pick = () => {
        const voices = window.speechSynthesis.getVoices();
        this.voice = voices.find(item => /^es-ES/i.test(item.lang) && /female|mujer|helena|elvira|laura|monica|paulina|sabina/i.test(item.name))
          || voices.find(item => /^es-ES/i.test(item.lang)) || voices.find(item => /^es/i.test(item.lang)) || null;
      };
      pick();
      if (!this.voice) window.speechSynthesis.onvoiceschanged = pick;
      try { const warm = new SpeechSynthesisUtterance(' '); warm.volume = 0; window.speechSynthesis.speak(warm); } catch { /* sin síntesis */ }
    }
    speak(text) {
      this.stop();
      if (this.kind === 'none') return Promise.resolve('done');
      this.sentences = splitSentences(text);
      this.index = 0;
      const generation = ++this.counter;
      const result = new Promise(resolve => { this.finish = resolve; });
      const next = () => {
        if (generation !== this.counter) return;
        if (this.index >= this.sentences.length) { const done = this.finish; this.finish = null; if (done) done('done'); return; }
        const sentence = this.sentences[this.index];
        const utterance = new SpeechSynthesisUtterance(sentence);
        utterance.lang = 'es-ES'; utterance.rate = 1.04;
        if (this.voice) utterance.voice = this.voice;
        this.charIndex = 0; this.startedAt = performance.now();
        let started = false, advanced = false;
        const advance = () => { if (advanced || generation !== this.counter) return; advanced = true; clearTimeout(watchdog); this.index++; next(); };
        const watchdog = setTimeout(() => { if (!started) advance(); else setTimeout(advance, sentence.length / 6 * 1000 + 4000); }, sentence.length / 14 * 1000 + 1500);
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
      const done = this.finish; this.finish = null; if (done) done('stopped');
    }
    speaking() { return !!this.finish; }
    level() {
      if (!this.finish) return 0;
      this.pulse *= 0.86;
      const t = performance.now() / 1000;
      return Math.min(1, 0.22 + 0.18 * Math.abs(Math.sin(t * 9.1)) * Math.abs(Math.sin(t * 3.7)) + this.pulse * 0.35);
    }
    viseme() { return this.finish ? [0, 3, 4, 1, 0, 2][Math.floor(performance.now() / 140) % 6] : VISEME_REST; }
    progress() {
      if (!this.finish || this.index >= this.sentences.length) return null;
      const text = this.sentences[this.index];
      const byTime = (performance.now() - this.startedAt) / 1000 * 14 / Math.max(1, text.length);
      const byBoundary = this.charIndex / Math.max(1, text.length);
      return { text, fraction: Math.min(1, Math.max(byBoundary, byTime)), segment: this.index, segments: this.sentences.length };
    }
    dispose() { this.stop(); }
  }

  /** Soniox si el servidor da credencial; si falla, la síntesis del navegador (nunca se queda en silencio). */
  class AdaptiveSpeaker {
    constructor(fetchGrant, onNotice) {
      this.fallback = new BrowserSpeaker();
      this.failed = false;
      this.onNotice = onNotice;
      this.engine = fetchGrant ? new SonioxSpeaker(fetchGrant, message => this.fail(message)) : this.fallback;
    }
    get kind() { return this.engine.kind; }
    fail(message) {
      if (this.failed || this.engine === this.fallback) return;
      this.failed = true;
      if (this.onNotice) this.onNotice((message || 'La voz de VictorIA ha fallado.') + ' Se usa la voz del navegador.');
      const broken = this.engine;
      this.engine = this.fallback;
      this.fallback.unlock();
      setTimeout(() => broken.dispose(), 0);
    }
    async unlock() { await Promise.all([this.engine.unlock(), this.fallback.unlock()]); }
    async speak(text) {
      const engine = this.engine;
      const result = await engine.speak(text);
      if (engine !== this.engine && result === 'done') return this.engine.speak(text);
      return result;
    }
    stop() { this.engine.stop(); }
    level() { return this.engine.level(); }
    viseme() { return this.engine.viseme(); }
    progress() { return this.engine.progress(); }
    speaking() { return this.engine.speaking(); }
    dispose() { this.engine.dispose(); this.fallback.dispose(); }
  }

  // ---------- Escucha continua: Soniox STT (port de web/stt-stream.ts) ----------

  const STT_RATE = 16000;
  const SOCKET_LIMIT = 256 * 1024;
  const WORKLET_SOURCE = `
class UfvIa3dCapture extends AudioWorkletProcessor {
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
registerProcessor('ufv-ia3d-capture', UfvIa3dCapture);`;

  class LiveListener {
    constructor(fetchKey, events) {
      this.fetchKey = fetchKey; this.events = events;
      this.socket = null; this.stream = null; this.context = null; this.node = null;
      this.finalText = ''; this.active = false; this.reconnects = 0; this.generation = 0;
    }
    get running() { return this.active; }
    state(value, message) { if (this.events.onState) this.events.onState(value, message); }
    async start() {
      if (this.active) return;
      this.active = true; this.reconnects = 0;
      const generation = ++this.generation;
      this.state('starting');
      try {
        let context;
        try { context = new AudioContext({ sampleRate: STT_RATE }); } catch { context = new AudioContext(); }
        this.context = context;
        context.resume().catch(() => undefined);
        // El permiso se pide dentro del gesto del usuario, antes de cualquier espera de red.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 }, video: false });
        if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
        const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
        try { await context.audioWorklet.addModule(url); } finally { URL.revokeObjectURL(url); }
        const source = context.createMediaStreamSource(stream);
        const node = new AudioWorkletNode(context, 'ufv-ia3d-capture');
        const sink = context.createGain(); sink.gain.value = 0;
        source.connect(node); node.connect(sink); sink.connect(context.destination);
        node.port.onmessage = event => this.send(event.data);
        this.node = node;
        await context.resume();
        await this.connect(generation);
      } catch (cause) {
        if (generation !== this.generation) return;
        this.shutdown();
        this.state('error', cause && cause.name === 'NotAllowedError' ? 'Permite el micrófono en el navegador para hablar con VictorIA.' : ((cause && cause.message) || 'No se pudo activar el micrófono.'));
      }
    }
    async connect(generation) {
      const grant = await this.fetchKey();
      if (generation !== this.generation) return;
      if (!grant || !grant.apiKey || !grant.websocketUrl) throw new Error('La conexión de voz no está disponible.');
      const socket = new WebSocket(grant.websocketUrl, ['soniox-api-key', grant.apiKey]);
      this.socket = socket;
      this.finalText = '';
      socket.onopen = () => {
        if (generation !== this.generation) return;
        socket.send(JSON.stringify({ model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: STT_RATE, num_channels: 1, language_hints: ['es'], language_hints_strict: true,
          enable_endpoint_detection: true, endpoint_latency_adjustment_level: 2, endpoint_sensitivity: 0.3, max_endpoint_delay_ms: 1200 }));
        this.reconnects = 0;
        this.state('on');
      };
      socket.onmessage = event => this.onMessage(event, generation);
      const reopen = () => {
        if (generation !== this.generation || !this.active) return;
        if (this.socket === socket) this.socket = null;
        // Clave temporal de un solo uso y sesiones de 10 min como mucho: se renueva sola.
        if (this.reconnects++ < 3) setTimeout(() => { if (generation === this.generation && this.active) this.connect(generation).catch(() => this.fail(generation)); }, 400 * this.reconnects);
        else this.fail(generation);
      };
      socket.onclose = reopen;
      socket.onerror = () => undefined;
    }
    onMessage(event, generation) {
      if (generation !== this.generation || typeof event.data !== 'string') return;
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.error_code) { this.state('error', 'El servicio de voz rechazó la conexión.'); return; }
      let provisional = '', ended = false;
      for (const token of payload.tokens || []) {
        if (token.text === '<end>' || token.text === '<fin>') { ended = true; continue; }
        if (typeof token.text !== 'string') continue;
        if (token.is_final) this.finalText += token.text; else provisional += token.text;
      }
      const now = (this.finalText + provisional).trim();
      if (now && this.events.onPartial) this.events.onPartial(now);
      if (ended) { const phrase = this.finalText.trim(); this.finalText = ''; if (phrase && this.events.onFinal) this.events.onFinal(phrase); }
    }
    fail(generation) {
      if (generation !== this.generation) return;
      this.shutdown();
      this.state('error', 'Se perdió la conexión de voz. Vuelve a activar el micrófono.');
    }
    send(samples) {
      const socket = this.socket, context = this.context;
      if (!socket || socket.readyState !== WebSocket.OPEN || !context) return;
      const ratio = context.sampleRate / STT_RATE;
      const out = new Int16Array(Math.ceil(samples.length / ratio));
      let used = 0;
      for (let position = 0; position < samples.length; position += ratio) {
        const value = Math.max(-1, Math.min(1, samples[Math.floor(position)]));
        out[used++] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
      }
      if (socket.bufferedAmount < SOCKET_LIMIT) socket.send(out.subarray(0, used).buffer);
    }
    /** Descarta lo oído (al empezar a hablar VictorIA). */
    reset() { this.finalText = ''; }
    shutdown() {
      this.active = false;
      if (this.node) { this.node.port.onmessage = null; this.node.disconnect(); this.node = null; }
      if (this.socket) { this.socket.onclose = null; this.socket.onmessage = null; try { this.socket.close(); } catch { /* cerrado */ } this.socket = null; }
      if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
      if (this.context) { this.context.close().catch(() => undefined); this.context = null; }
    }
    stop() { this.generation++; this.shutdown(); this.state('off'); }
  }

  // ---------- Conversación ----------

  const FILLERS_FIRST = ['Estoy leyendo tus documentos para preparar la primera situación. Un momento.'];
  const FILLERS = ['Dame un momento, estoy preparando la siguiente situación.', 'Vamos con la siguiente. Un segundo.', 'Estoy preparando otra situación a partir de tus documentos.'];
  const ACTIVE = ['speaking', 'listening', 'confirm'];
  const RUN_ID = /^[\w-]{1,80}$/;
  const reducedMotion = () => typeof window !== 'undefined' && !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  const live = {
    unity: null, runId: null, run: null, situation: null, summary: null, voice: null,
    phase: 'loading', pending: null, heard: '', notice: '', error: '', mic: 'off', micMessage: '',
    turn: 0, sayToken: 0, spoken: '', started: false, speaker: null, listener: null,
    frame: 0, smooth: 0, lastLip: '', lastLipAt: 0, lastCaption: '',
    ui: null,
    helpers: { normalize, shortOption, splitSentences, looksLikeEcho, isBargeIn, visemeFromSpectrum },
    wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
    createSpeaker: (grant, notice) => new AdaptiveSpeaker(grant, notice),
    createListener: (fetchKey, events) => new LiveListener(fetchKey, events),

    send(method, value) {
      if (this.unity) this.unity.SendMessage('AXYRO Demo', method, typeof value === 'string' ? value : JSON.stringify(value));
    },

    async api(path, body) {
      const init = { credentials: 'same-origin', cache: 'no-store', headers: {} };
      if (body !== undefined) { init.method = 'POST'; init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
      const response = await fetch('/api' + path, init);
      let data = null;
      try { data = await response.json(); } catch { data = null; }
      if (!response.ok) {
        const error = new Error((data && data.error) || 'No se ha podido completar la petición. Inténtalo de nuevo.');
        error.status = response.status;
        throw error;
      }
      return data;
    },
    runPath(suffix) { return '/ai-runs/' + encodeURIComponent(this.runId) + (suffix || ''); },

    statusText() {
      const phase = this.phase;
      const micOn = this.mic === 'on';
      return phase === 'generating' ? 'VictorIA está preparando la ' + (this.situation ? 'siguiente' : 'primera') + ' situación…'
        : phase === 'thinking' ? 'VictorIA está pensando…'
        : phase === 'confirm' ? 'Di «sí» o «no», o pulsa S o N.'
        : phase === 'listening' ? (micOn ? 'Te escucho: explica qué harías o di el número de una opción.' : 'Elige una opción con el ratón o las teclas 1 a 4.')
        : phase === 'reaction' ? 'Consecuencia de tu decisión'
        : phase === 'speaking' ? (micOn ? 'Puedes interrumpirla hablando.' : '')
        : phase === 'summary' ? 'Fin de la simulación'
        : '';
    },

    /** Cambia el estado, lo comunica a Unity y repinta los controles del navegador. */
    setView(patch) {
      Object.assign(this, patch);
      this.send('AiState', { phase: this.phase, pending: this.pending == null ? -1 : this.pending, status: this.statusText() });
      this.render();
    },

    /** VictorIA dice un texto. `mode`: '1' situación o respuesta, '2' reacción a una decisión. */
    async say(text, mode) {
      if (!this.speaker || !text) return 'done';
      const token = ++this.sayToken;
      this.spoken = text;
      if (this.listener) this.listener.reset();
      this.lastCaption = '';
      this.send('AiSpeaking', mode || '1');
      const result = await this.speaker.speak(text);
      // Solo la última locución cierra la boca: si otra la ha sustituido, esa ya ha avisado a Unity.
      if (token === this.sayToken) {
        this.send('AiSpeaking', '0');
        this.send('AiLip', '0,' + VISEME_REST);
        this.send('AiSubtitle', '');
        this.lastLip = '';
      }
      return result;
    },

    showSituation(situation) {
      const sources = [];
      for (const source of situation.sources || []) if (source && source.document && sources.indexOf(source.document) < 0) sources.push(source.document);
      this.send('AiSituation', {
        index: situation.index || 0, total: (this.run && this.run.situationsTotal) || 0, title: situation.title || '', narration: situation.narration || '',
        options: (situation.options || []).map(option => option.label || ''), sources
      });
    },

    async narrate(turn) {
      this.setView({ phase: 'speaking' });
      await this.say(this.situation.narration);
      if (this.turn === turn && this.phase === 'speaking') this.setView({ phase: 'listening' });
    },

    async goNext() {
      const turn = ++this.turn;
      const first = !this.situation;
      if (this.speaker) this.speaker.stop();
      this.setView({ phase: 'generating', pending: null, heard: '', error: '' });
      let filler = null;
      const timer = setTimeout(() => {
        if (this.turn !== turn || this.phase !== 'generating') return;
        const list = first ? FILLERS_FIRST : FILLERS;
        filler = this.say(list[Math.floor(Math.random() * list.length)]);
      }, 1500);
      let result;
      try { result = await this.api(this.runPath('/next'), {}); }
      catch (cause) { clearTimeout(timer); if (this.turn === turn) this.fail(cause); return; }
      clearTimeout(timer);
      if (this.turn !== turn) return;
      if (filler) await filler;
      if (this.turn !== turn) return;
      if (result.done) { await this.presentSummary(result.summary); return; }
      this.situation = result.situation;
      if (this.run) this.run.index = result.situation.index;
      this.showSituation(result.situation);
      await this.narrate(turn);
    },

    async presentSummary(summary) {
      const turn = ++this.turn;
      this.summary = summary;
      this.situation = null;
      this.send('AiSummary', { optimalCount: summary.optimalCount || 0, total: summary.total || 0, takeaways: summary.takeaways || [] });
      this.setView({ phase: 'summary', pending: null });
      if (this.turn === turn) await this.say(summary.spoken);
    },

    /** Habla y, si nada lo ha interrumpido, vuelve a escuchar. */
    async speakThenListen(text, during) {
      const phase = during || 'speaking';
      const turn = ++this.turn;
      this.setView({ phase });
      await this.say(text);
      if (this.turn === turn && this.phase === phase) this.setView({ phase: phase === 'confirm' ? 'confirm' : 'listening' });
    },

    async submit(body) {
      const situation = this.situation;
      if (!situation) return;
      const turn = ++this.turn;
      if (this.speaker) this.speaker.stop();
      this.setView({ phase: 'thinking' });
      let result;
      try { result = await this.api(this.runPath('/answer'), body); }
      catch (cause) {
        if (this.turn !== turn) return;
        this.notice = cause && cause.message ? cause.message : '';
        this.speakThenListen('Perdona, he tenido un problema al procesarlo. ¿Puedes repetirlo?');
        return;
      }
      if (this.turn !== turn) return;
      switch (result.kind) {
        case 'decision': {
          const option = situation.options[result.optionIndex] || {};
          const reaction = result.reaction || {};
          this.send('AiReaction', { optionIndex: result.optionIndex, quality: reaction.quality || option.quality || '', label: option.label || '', consequence: option.consequence || '' });
          this.setView({ phase: 'reaction', pending: null });
          await this.say(reaction.spoken || '', '2');
          if (this.turn !== turn) return;
          await this.wait(reducedMotion() ? 300 : 900);
          if (this.turn === turn) this.goNext();
          return;
        }
        case 'confirm':
          this.pending = result.optionIndex;
          this.speakThenListen(result.prompt || '¿Te refieres a la opción ' + (result.optionIndex + 1) + '?', 'confirm');
          return;
        case 'answer':
          this.speakThenListen(result.spoken);
          return;
        case 'repeat':
          this.speakThenListen(situation.narration);
          return;
        case 'next':
          this.goNext();
          return;
        default:
          this.speakThenListen(result.spoken || 'No te he entendido bien. Dime qué harías con tus palabras o di el número de la opción.');
      }
    },

    answerConfirm(yes) {
      const pending = this.pending;
      if (pending == null || this.phase !== 'confirm') return;
      if (yes) this.submit({ optionIndex: pending });
      else { this.pending = null; this.speakThenListen('De acuerdo. ¿Qué harías tú?'); }
    },

    /** Frase completa (voz). */
    handlePhrase(phrase) {
      if (!this.situation || ['loading', 'intro', 'generating', 'thinking', 'summary', 'error', 'reaction'].indexOf(this.phase) >= 0) return;
      if (this.speaker) this.speaker.stop();
      const text = normalize(phrase);
      if (this.pending != null && this.phase === 'confirm') {
        if (/^(si|vale|correcto|exacto|eso|confirmo|claro|efectivamente)\b/.test(text)) { this.answerConfirm(true); return; }
        if (/^no\b/.test(text)) { this.answerConfirm(false); return; }
      }
      const direct = shortOption(phrase, this.situation.options.length);
      if (direct !== null) { this.submit({ optionIndex: direct }); return; }
      this.submit({ phrase });
    },

    choose(index) {
      if (!this.situation || ACTIVE.indexOf(this.phase) < 0) return;
      if (!(index >= 0 && index < this.situation.options.length)) return;
      this.submit({ optionIndex: index });
    },

    /** Órdenes que llegan de Unity (tarjetas y teclado). */
    command(text) {
      const [name, value] = String(text || '').split(':');
      if (name === 'choose') this.choose(parseInt(value, 10));
      else if (name === 'confirm') this.answerConfirm(value === '1');
      else if (name === 'repeat' && this.situation && (this.phase === 'listening' || this.phase === 'speaking')) this.speakThenListen(this.situation.narration);
    },

    // ---------- Micrófono ----------
    async startMic() {
      if (!this.voice || (this.listener && this.listener.running)) return;
      this.listener = this.createListener(
        () => this.api('/voice/temporary-key', { aiRunId: this.runId }),
        {
          onState: (mic, message) => this.setView({ mic, micMessage: message || '' }),
          onPartial: text => this.onPartial(text),
          onFinal: phrase => this.onFinal(phrase)
        });
      await this.listener.start();
    },
    onPartial(text) {
      // Interrupción: si la persona habla por encima de VictorIA (y no es eco), se corta la voz al momento.
      if (this.speaker && this.speaker.speaking() && isBargeIn(text, this.spoken) && ACTIVE.concat(['reaction']).indexOf(this.phase) >= 0) this.speaker.stop();
      if (!this.speaker || !this.speaker.speaking()) { this.heard = text; this.render(); }
    },
    onFinal(phrase) {
      if (this.speaker && this.speaker.speaking() && looksLikeEcho(phrase, this.spoken)) return;
      this.heard = phrase;
      this.render();
      this.handlePhrase(phrase);
    },

    // ---------- Ciclo de vida ----------
    fail(cause) {
      if (this.speaker) this.speaker.stop();
      const status = cause && cause.status;
      const message = status === 404 ? 'No encontramos esta simulación, o el Modo IA en vivo no está activo.'
        : status === 403 || status === 401 ? 'El Modo IA en vivo está reservado al docente que creó la simulación.'
        : (cause && cause.message) || 'Algo no ha ido bien.';
      this.send('AiError', message);
      this.setView({ phase: 'error', error: message });
    },

    async attach(unity, runId) {
      this.unity = unity;
      this.runId = runId;
      this.bindUi();
      if (!RUN_ID.test(runId || '')) { this.fail({ message: 'El enlace no es válido. Ábrelo desde el Modo IA de la consola.' }); return; }
      this.setView({ phase: 'loading' });
      fetch('/api/voice/config', { credentials: 'same-origin', cache: 'no-store' })
        .then(response => response.ok ? response.json() : null)
        .then(config => { if (config && config.enabled && config.websocketUrl && navigator.mediaDevices && window.AudioContext) { this.voice = config; this.render(); } })
        .catch(() => undefined);
      try {
        const result = await this.api(this.runPath());
        this.run = result.run || null;
        if (result.summary) this.summary = result.summary;
        else this.situation = result.current || null;
        this.setView({ phase: 'intro' });
      } catch (cause) { this.fail(cause); }
    },

    /** Inicio: gesto del usuario (desbloquea el audio y pide el micrófono). */
    async begin(withMic) {
      if (this.started) return;
      this.started = true;
      const grant = () => this.api('/voice/tts-key', {});
      this.speaker = this.createSpeaker(grant, message => { this.notice = message; this.render(); });
      const unlocking = this.speaker.unlock();
      if (withMic && this.voice) this.startMic();
      await Promise.race([unlocking, this.wait(1500)]);
      this.startLoop();
      if (this.summary) { await this.presentSummary(this.summary); return; }
      if (this.situation) {
        this.showSituation(this.situation);
        await this.narrate(++this.turn);
      } else await this.goNext();
    },

    exit() {
      this.turn++;
      if (this.speaker) this.speaker.dispose();
      if (this.listener) this.listener.stop();
      const collection = this.run && this.run.collectionId;
      location.href = collection ? '/escenarios/ia?coleccion=' + encodeURIComponent(collection) : '/escenarios/ia';
    },

    convert() {
      this.turn++;
      if (this.speaker) this.speaker.dispose();
      if (this.listener) this.listener.stop();
      location.href = '/escenarios/borrador/' + encodeURIComponent(this.runId);
    },

    /** Un solo bucle: nivel y visema de la voz para la boca y subtítulos sincronizados con el audio. */
    startLoop() {
      if (this.frame || typeof requestAnimationFrame !== 'function') return;
      const tick = () => { this.frame = requestAnimationFrame(tick); this.tick(performance.now()); };
      this.frame = requestAnimationFrame(tick);
    },
    tick(now) {
      const speaker = this.speaker;
      const speaking = !!(speaker && speaker.speaking());
      const raw = speaking ? speaker.level() : 0;
      this.smooth += (raw - this.smooth) * (raw > this.smooth ? 0.5 : 0.2);
      if (!speaking) return;
      // ~30 mensajes por segundo como mucho, y solo si cambia algo.
      if (now - this.lastLipAt >= 33) {
        this.lastLipAt = now;
        const value = this.smooth.toFixed(2) + ',' + speaker.viseme();
        if (value !== this.lastLip) { this.lastLip = value; this.send('AiLip', value); }
      }
      const progress = speaker.progress();
      if (progress) {
        const words = progress.text.split(/\s+/).length;
        const shown = Math.min(words, Math.max(1, Math.ceil(progress.fraction * words + 0.6)));
        const caption = shown + '|' + progress.text;
        if (caption !== this.lastCaption) { this.lastCaption = caption; this.send('AiSubtitle', caption); }
      }
    },

    // ---------- Controles del navegador (fuera del lienzo de Unity) ----------
    bindUi() {
      if (typeof document === 'undefined' || !document.getElementById) return;
      const get = id => document.getElementById(id);
      const ui = { root: get('ia'), intro: get('ia-intro'), introText: get('ia-intro-texto'), transfer: get('ia-transferencia'), withMic: get('ia-con-voz'), withoutMic: get('ia-sin-voz'),
        errorBox: get('ia-error'), errorText: get('ia-error-texto'), retry: get('ia-reintentar'), back: get('ia-volver'),
        bar: get('ia-barra'), mic: get('ia-mic'), micButton: get('ia-activar-voz'), status: get('ia-estado'), exit: get('ia-salir'),
        confirm: get('ia-confirmar'), confirmText: get('ia-confirmar-texto'), yes: get('ia-si'), no: get('ia-no'), end: get('ia-fin'), convert: get('ia-convertir') };
      if (!ui.root) return;
      this.ui = ui;
      ui.root.hidden = false;
      ui.withMic.addEventListener('click', () => this.begin(true));
      ui.withoutMic.addEventListener('click', () => this.begin(false));
      ui.micButton.addEventListener('click', () => this.startMic());
      ui.exit.addEventListener('click', () => this.exit());
      ui.back.addEventListener('click', () => this.exit());
      ui.retry.addEventListener('click', () => { if (this.started) this.goNext(); else location.reload(); });
      ui.yes.addEventListener('click', () => this.answerConfirm(true));
      ui.no.addEventListener('click', () => this.answerConfirm(false));
      ui.convert.addEventListener('click', () => this.convert());
      window.addEventListener('pagehide', () => { if (this.speaker) this.speaker.dispose(); if (this.listener) this.listener.stop(); });
    },
    render() {
      const ui = this.ui;
      if (!ui) return;
      const phase = this.phase;
      const intro = phase === 'intro' && !this.started;
      ui.intro.hidden = !intro;
      if (intro) {
        const total = this.run && this.run.situationsTotal;
        ui.introText.textContent = this.summary
          ? 'Esta simulación ya ha terminado: VictorIA te contará el resumen.'
          : 'VictorIA te planteará ' + (total ? total + ' situaciones' : 'varias situaciones') + ' generadas a partir de tus documentos. Responde con tu voz, como en una conversación; también puedes elegir con el ratón o las teclas 1 a 4.';
        ui.transfer.hidden = !(this.voice && this.voice.region !== 'eu');
        ui.withMic.hidden = !this.voice;
        ui.withoutMic.textContent = this.voice ? 'Empezar sin micrófono' : 'Empezar';
        ui.withoutMic.className = this.voice ? 'boton' : 'boton principal';
      }
      ui.errorBox.hidden = phase !== 'error';
      if (phase === 'error') ui.errorText.textContent = this.error;
      ui.retry.hidden = !this.started;
      ui.bar.hidden = intro || phase === 'loading' || phase === 'error';
      ui.mic.textContent = this.mic === 'on' ? '● Micrófono activo' : this.mic === 'starting' ? 'Activando micrófono…' : this.mic === 'error' ? 'Sin micrófono' : 'Micrófono apagado';
      ui.mic.className = 'ia-mic ia-mic-' + this.mic;
      ui.micButton.hidden = !(this.started && this.voice && this.mic !== 'on' && this.mic !== 'starting');
      const heard = this.heard && ['listening', 'thinking', 'confirm'].indexOf(phase) >= 0 ? '«' + this.heard.slice(0, 140) + '»' : '';
      const notice = [this.notice, this.mic === 'error' ? this.micMessage : ''].filter(Boolean).join(' · ');
      ui.status.textContent = [heard || this.statusText(), notice].filter(Boolean).join(' · ');
      ui.confirm.hidden = phase !== 'confirm' || this.pending == null;
      if (!ui.confirm.hidden) ui.confirmText.textContent = '¿Opción ' + (this.pending + 1) + '?';
      ui.end.hidden = phase !== 'summary';
    }
  };

  window.axyroAiLive = live;
})();
