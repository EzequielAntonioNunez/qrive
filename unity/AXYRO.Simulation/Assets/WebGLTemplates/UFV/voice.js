/* Micrófono WebGL: el audio va directamente del navegador a Soniox; Unity recibe solo estados y órdenes. */
(function () {
  'use strict';
  const TARGET_RATE = 16000;
  const SOCKET_LIMIT = 256 * 1024;
  const WORKLET_SOURCE = `
    class AxyroCapture extends AudioWorkletProcessor {
      constructor() { super(); this.buffer = new Float32Array(2048); this.used = 0; }
      process(inputs) {
        const channel = inputs[0] && inputs[0][0];
        if (!channel) return true;
        for (let i = 0; i < channel.length; i++) {
          this.buffer[this.used++] = channel[i];
          if (this.used === this.buffer.length) {
            this.port.postMessage(this.buffer, [this.buffer.buffer]);
            this.buffer = new Float32Array(2048);
            this.used = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('axyro-capture', AxyroCapture);
  `;

  const OPTION_WORDS = ['uno', 'dos', 'tres', 'cuatro'];
  // Mismas palabras que reconoce AxyroWebVoice.cs: se envían tal cual, sin pasar por Clef.
  const COMMAND_WORDS = /\b(1|2|3|4|uno|dos|tres|cuatro|primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|repetir|repite|escuchar|otra vez)\b/;
  const normalize = value => value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ ]+/g, ' ').replace(/\s+/g, ' ').trim();

  const voice = {
    unity: null, button: null, status: null, active: false, starting: false, websocketUrl: null, region: 'eu', noticeAccepted: false, pendingOption: null,
    speaking: false, canDecide: false, optionCount: 0, interrupted: false,
    socket: null, stream: null, context: null, source: null, processor: null, sink: null,
    finalText: '', lastSpeechAt: 0, speechMs: 0, voiceStartAt: 0, generation: 0,

    send(method, value) {
      if (this.unity) this.unity.SendMessage('AXYRO Demo', method, value);
    },
    setStatus(message) { if (this.status) this.status.textContent = message; },
    setUnityState(speaking, canDecide, optionCount) {
      if (speaking && !this.speaking) {
        this.voiceStartAt = performance.now();
        this.interrupted = false;
      }
      this.speaking = speaking;
      this.canDecide = canDecide;
      this.optionCount = optionCount;
    },
    async attach(unity) {
      this.unity = unity;
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || !window.AudioContext) return;
      try {
        const response = await fetch('/api/voice/config', { credentials: 'same-origin', cache: 'no-store' });
        const config = await response.json();
        if (!response.ok || !config.enabled) return;
        this.websocketUrl = config.websocketUrl;
        this.region = config.region;
      } catch { return; }
      this.button = document.getElementById('axyro-mic');
      this.status = document.getElementById('axyro-mic-status');
      this.button.hidden = false;
      this.button.addEventListener('click', () => {
        if (this.active || this.starting) return this.stop();
        // Fuera de la UE, el participante ve dónde se transcribe su voz antes de abrir el micrófono.
        if (this.region !== 'eu' && !this.noticeAccepted) {
          this.noticeAccepted = true;
          this.button.textContent = '🎙 Aceptar y activar';
          this.setStatus('Tu voz se transcribe en Soniox (EE. UU.) solo mientras la voz está activa; ni el simulador ni la UFV guardan el audio. Si prefieres no usarla, elige con el ratón.');
          return;
        }
        this.start();
      });
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.stop(); });
      window.addEventListener('pagehide', () => this.stop());
    },
    async start() {
      if (this.active || this.starting) return;
      this.starting = true;
      const generation = ++this.generation;
      this.button.disabled = true;
      this.setStatus('Activando micrófono…');
      try {
        this.context = new AudioContext({ sampleRate: TARGET_RATE });
        this.context.resume().catch(() => {});
        // La solicitud de permiso se hace dentro del gesto del usuario, antes de cualquier await de red.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
          video: false
        });
        if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
        this.stream = stream;
        const sessionId = new URL(location.href).searchParams.get('sesion');
        const response = await fetch('/api/voice/temporary-key', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId })
        });
        if (!response.ok) throw new Error('No se pudo iniciar la voz. Vuelve a intentarlo.');
        const grant = await response.json();
        if (generation !== this.generation) return;
        if (!grant.apiKey || grant.websocketUrl !== this.websocketUrl)
          throw new Error('La conexión de voz no está disponible.');
        const socket = new WebSocket(grant.websocketUrl, ['soniox-api-key', grant.apiKey]);
        this.socket = socket;
        socket.onopen = () => this.onOpen(generation);
        socket.onmessage = event => this.onMessage(event, generation);
        socket.onerror = () => { if (generation === this.generation) this.fail('Se perdió la conexión de voz.'); };
        socket.onclose = () => { if (generation === this.generation) this.fail('La conexión de voz terminó. Actívala de nuevo.'); };
      } catch (error) {
        if (generation === this.generation) this.fail(error?.name === 'NotAllowedError'
          ? 'Permite el micrófono en el navegador para responder por voz.'
          : (error?.message || 'No se pudo activar el micrófono.'));
      }
    },
    async onOpen(generation) {
      if (generation !== this.generation || !this.socket) return;
      try {
        this.socket.send(JSON.stringify({
          model: 'stt-rt-v5', audio_format: 'pcm_s16le', sample_rate: TARGET_RATE, num_channels: 1,
          language_hints: ['es'], language_hints_strict: true,
          enable_endpoint_detection: true, endpoint_latency_adjustment_level: 2,
          endpoint_sensitivity: 0.3, max_endpoint_delay_ms: 1500
        }));
        const moduleUrl = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'text/javascript' }));
        try { await this.context.audioWorklet.addModule(moduleUrl); }
        finally { URL.revokeObjectURL(moduleUrl); }
        if (generation !== this.generation || !this.stream) return;
        this.source = this.context.createMediaStreamSource(this.stream);
        this.processor = new AudioWorkletNode(this.context, 'axyro-capture');
        this.sink = this.context.createGain();
        this.sink.gain.value = 0;
        this.processor.port.onmessage = event => this.onAudio(event.data);
        this.source.connect(this.processor);
        this.processor.connect(this.sink);
        this.sink.connect(this.context.destination);
        await this.context.resume();
        this.active = true;
        this.starting = false;
        this.button.disabled = false;
        this.button.classList.add('activo');
        this.button.textContent = '● Voz activa';
        this.setStatus('Te escucho. Explica qué harías con tus palabras o di el número de la opción; puedes interrumpir a VictorIA. Un modelo de IA asigna tu frase a una opción y te pide confirmación si duda.');
        this.send('OnWebVoiceState', '1');
      } catch {
        if (generation === this.generation) this.fail('No se pudo procesar el audio de este navegador.');
      }
    },
    onAudio(samples) {
      if (!this.active || !this.socket || this.socket.readyState !== WebSocket.OPEN) return;
      let energy = 0;
      for (let i = 0; i < samples.length; i++) energy += samples[i] * samples[i];
      const rms = Math.sqrt(energy / samples.length);
      const durationMs = 1000 * samples.length / this.context.sampleRate;
      this.speechMs = rms > 0.035 ? Math.min(500, this.speechMs + durationMs) : Math.max(0, this.speechMs - durationMs * 2);
      if (this.speechMs > 100) this.lastSpeechAt = performance.now();
      // El AudioContext suele aceptar 16 kHz; si no, se remuestrea antes de enviar PCM mono.
      const ratio = this.context.sampleRate / TARGET_RATE;
      const out = new Int16Array(Math.ceil(samples.length / ratio));
      let used = 0;
      for (let position = 0; position < samples.length; position += ratio) {
        const value = Math.max(-1, Math.min(1, samples[Math.floor(position)]));
        out[used++] = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
      }
      if (this.socket.bufferedAmount < SOCKET_LIMIT) this.socket.send(out.subarray(0, used).buffer);
    },
    onMessage(event, generation) {
      if (generation !== this.generation) return;
      let payload;
      try { payload = JSON.parse(event.data); } catch { return; }
      if (payload.error_code) { this.fail('Soniox rechazó la sesión de voz. Actívala de nuevo.'); return; }
      const tokens = Array.isArray(payload.tokens) ? payload.tokens : [];
      let provisional = '';
      let ended = false;
      for (const token of tokens) {
        if (token.text === '<end>' || token.text === '<fin>') { ended = true; continue; }
        if (typeof token.text !== 'string') continue;
        if (token.is_final) this.finalText += token.text;
        else provisional += token.text;
      }
      const heard = (this.finalText + provisional).trim();
      if (heard) {
        this.setStatus('Escuchando: ' + heard.slice(0, 110));
        // Solo se interrumpe tras evidencia acústica reciente Y palabras reconocidas.
        // Así la música o un golpe no detienen el avatar.
        if (this.speaking && !this.interrupted && performance.now() - this.voiceStartAt > 350 &&
            performance.now() - this.lastSpeechAt < 1000 && /[a-záéíóúñ]{2,}/i.test(heard)) {
          this.interrupted = true;
          this.send('OnWebVoiceInterrupt', '');
          this.setStatus('Interrupción detectada · te escucho');
        }
      }
      if (ended) {
        const phrase = this.finalText.trim();
        this.finalText = '';
        if (phrase) this.handlePhrase(phrase);
        this.interrupted = false;
      }
      if (payload.finished) this.fail('La sesión de voz terminó. Actívala de nuevo.');
    },
    /**
     * Frase final. Los números y «repetir» van directos a Unity; una respuesta con palabras propias se interpreta
     * con Clef en el servidor (`/api/voice/interpret`), que confirma antes de decidir si no está seguro.
     */
    handlePhrase(phrase) {
      const text = normalize(phrase);
      if (this.pendingOption != null) {
        const option = this.pendingOption;
        this.pendingOption = null;
        if (/^(si|vale|correcto|exacto|eso|confirmo|claro)\b/.test(text)) { this.choose(option, 'Confirmado'); return; }
        if (/^no\b/.test(text)) { this.setStatus('De acuerdo. Dime qué harías o di el número de la opción.'); return; }
      }
      // Solo las órdenes cortas («la dos», «repetir») van directas: en «primero quitaría los datos…»
      // «primero» no es la opción 1, así que las frases largas siempre se interpretan.
      const command = COMMAND_WORDS.test(text) && text.split(' ').length <= 4;
      if (command || !this.canDecide || this.optionCount === 0) {
        this.send('OnWebVoiceTranscript', phrase);
        this.setStatus('He oído: ' + phrase.slice(0, 110));
        return;
      }
      return this.interpret(phrase);
    },
    async interpret(phrase) {
      const generation = this.generation;
      this.setStatus('Interpretando: «' + phrase.slice(0, 90) + '»…');
      let result = null;
      try {
        const response = await fetch('/api/voice/interpret', {
          method: 'POST', credentials: 'same-origin', cache: 'no-store',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sessionId: new URL(location.href).searchParams.get('sesion'), phrase })
        });
        result = response.ok ? await response.json() : null;
      } catch { result = null; }
      if (generation !== this.generation || !this.canDecide) return;
      if (!result || result.kind === 'unclear' || !(result.option >= 0 && result.option < this.optionCount)) {
        this.setStatus('No lo he entendido. Dilo de otra forma, di el número de la opción o elige con el ratón.');
      } else if (result.kind === 'decide') {
        this.choose(result.option, 'Entendido');
      } else {
        this.pendingOption = result.option;
        this.setStatus('¿Te refieres a la opción ' + (result.option + 1) + '? Di «sí» o «no».');
      }
    },
    choose(option, prefix) {
      this.send('OnWebVoiceTranscript', OPTION_WORDS[option]);
      this.setStatus(prefix + ': opción ' + (option + 1) + ' (interpretado automáticamente).');
    },
    fail(message) { this.stop(); this.setStatus(message); },
    stop() {
      ++this.generation;
      this.active = false;
      this.starting = false;
      this.finalText = '';
      this.interrupted = false;
      this.pendingOption = null;
      this.send('OnWebVoiceState', '0');
      if (this.processor) { this.processor.port.onmessage = null; this.processor.disconnect(); this.processor = null; }
      if (this.source) { this.source.disconnect(); this.source = null; }
      if (this.sink) { this.sink.disconnect(); this.sink = null; }
      if (this.context) { this.context.close().catch(() => {}); this.context = null; }
      if (this.stream) { this.stream.getTracks().forEach(track => track.stop()); this.stream = null; }
      if (this.socket) { this.socket.onclose = null; this.socket.onerror = null; this.socket.close(); this.socket = null; }
      if (this.button) {
        this.button.disabled = false;
        this.button.classList.remove('activo');
        this.button.textContent = '🎙 Activar voz';
      }
    }
  };
  window.axyroVoice = voice;
})();
