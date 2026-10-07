/**
 * Modo IA en vivo · demo: reproductor inmersivo a pantalla completa. VictorIA narra cada situación generada a
 * partir de los documentos del docente (voz en tiempo real), escucha la respuesta hablada (micrófono abierto, se
 * la puede interrumpir) y reacciona. Bucle: next → narrar → escuchar → answer → reacción → next…
 * Transparencia (AI Act): distintivo permanente de contenido generado con IA y fuentes citadas por situación.
 * La valoración es de la decisión, nunca de la persona; no se infieren emociones.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { aiSimulatorUrl, useApp, type ApiError } from './app-context';
import type { AiSituation, AiSource, AiSummary, AnswerResponse, NextResponse, RunResponse, AiRun } from './ai-live-types';
import { brand } from './brand';
import { Icon } from './kit';
import { navigate } from './router';
import { isBargeIn, LiveListener, looksLikeEcho, type ListenerState } from './stt-stream';
import { AdaptiveSpeaker, type Speaker, type TtsGrant } from './tts-stream';
import { errorText, optionLetter, qualityLabel } from './types';
import { normalizeSpeech, shortOption, type VoiceConfig } from './voice-mobile';
import './ai-live.css';

type Phase = 'loading' | 'intro' | 'generating' | 'speaking' | 'listening' | 'thinking' | 'confirm' | 'reaction' | 'summary' | 'error';
type View = {
  phase: Phase;
  run: AiRun | null;
  situation: AiSituation | null;
  chosen: { index: number; quality?: string } | null;
  pending: number | null;
  extraSources: AiSource[];
  summary: AiSummary | null;
  error: string;
  heard: string;
  notice: string;
  mic: ListenerState;
  micMessage: string;
};

const FILLERS_FIRST = ['Estoy leyendo tus documentos para preparar la primera situación. Un momento.'];
const FILLERS = ['Dame un momento, estoy preparando la siguiente situación.', 'Vamos con la siguiente. Un segundo.', 'Estoy preparando otra situación a partir de tus documentos.'];
const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

export function AiLivePage({ runId }: { runId: string }) {
  const app = useApp();
  const api = app.api;
  const [view, setViewState] = useState<View>({ phase: 'loading', run: null, situation: null, chosen: null, pending: null, extraSources: [], summary: null, error: '', heard: '', notice: '', mic: 'off', micMessage: '' });
  const S = useRef<View & { turn: number; spoken: string; voice: VoiceConfig | null; started: boolean }>({ ...view, turn: 0, spoken: '', voice: null, started: false });
  const setView = useCallback((patch: Partial<View>) => { Object.assign(S.current, patch); setViewState(current => ({ ...current, ...patch })); }, []);
  const [voice, setVoice] = useState<VoiceConfig | null>(null);
  const [caption, setCaption] = useState<{ text: string; words: number; key: number }>({ text: '', words: 0, key: 0 });
  const [typed, setTyped] = useState('');
  const [openSource, setOpenSource] = useState<string | null>(null);
  const speaker = useRef<Speaker | null>(null);
  const listener = useRef<LiveListener | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLDivElement>(null);

  /* ---------- Carga inicial ---------- */
  useEffect(() => {
    document.title = `VictorIA en vivo · ${brand.product} · ${brand.shortName}`;
    let alive = true;
    api<RunResponse>(`/ai-runs/${encodeURIComponent(runId)}`).then(result => {
      if (!alive) return;
      if (result.summary || result.run?.status === 'complete') setView({ run: result.run, summary: result.summary ?? null, phase: result.summary ? 'summary' : 'intro' });
      else setView({ run: result.run, situation: result.current ?? null, phase: 'intro' });
    }).catch(cause => { if (alive) setView({ phase: 'error', error: (cause as ApiError).status === 404 ? 'No encontramos esta simulación.' : errorText(cause) }); });
    api<VoiceConfig>('/voice/config').then(config => { if (alive && config?.enabled && config.websocketUrl) { setVoice(config); S.current.voice = config; } }).catch(() => undefined);
    return () => { alive = false; };
  }, [api, runId, setView]);

  // Limpieza: corta voz y micrófono al salir.
  useEffect(() => () => { S.current.turn++; speaker.current?.dispose(); listener.current?.stop(); if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined); }, []);

  /* ---------- Voz de VictorIA ---------- */
  const say = useCallback(async (text: string) => {
    if (!speaker.current || !text) return 'done' as const;
    S.current.spoken = text;
    listener.current?.reset();
    setCaption(current => ({ text, words: 0, key: current.key + 1 }));
    return speaker.current.speak(text);
  }, []);

  const goNext = useCallback(async () => {
    const turn = ++S.current.turn;
    const first = !S.current.situation;
    setOpenSource(null);
    setView({ phase: 'generating', chosen: null, pending: null, extraSources: [], heard: '', error: '' });
    speaker.current?.stop();
    let filler: Promise<unknown> | null = null;
    const timer = window.setTimeout(() => {
      if (S.current.turn !== turn || S.current.phase !== 'generating') return;
      const list = first ? FILLERS_FIRST : FILLERS;
      filler = say(list[Math.floor(Math.random() * list.length)]);
    }, 1500);
    let result: NextResponse;
    try { result = await api<NextResponse>(`/ai-runs/${encodeURIComponent(runId)}/next`, { method: 'POST', body: '{}' }); }
    catch (cause) { window.clearTimeout(timer); if (S.current.turn === turn) { speaker.current?.stop(); setView({ phase: 'error', error: errorText(cause) }); } return; }
    window.clearTimeout(timer);
    if (S.current.turn !== turn) return;
    if (filler) await filler;
    if (S.current.turn !== turn) return;
    if (result.done) {
      setView({ phase: 'summary', summary: result.summary, situation: null });
      await say(result.summary.spoken);
      return;
    }
    setView({ phase: 'speaking', situation: result.situation, run: S.current.run ? { ...S.current.run, index: result.situation.index } : S.current.run });
    await say(result.situation.narration);
    if (S.current.turn === turn && S.current.phase === 'speaking') setView({ phase: 'listening' });
  }, [api, runId, say, setView]);

  /** Habla y, si nadie la interrumpe con otra acción, vuelve a escuchar. */
  const speakThenListen = useCallback(async (text: string, during: Phase = 'speaking') => {
    const turn = ++S.current.turn;
    setView({ phase: during });
    await say(text);
    if (S.current.turn === turn && S.current.phase === during) setView({ phase: during === 'confirm' ? 'confirm' : 'listening' });
  }, [say, setView]);

  const submit = useCallback(async (body: { phrase?: string; optionIndex?: number }) => {
    const situation = S.current.situation;
    if (!situation) return;
    const turn = ++S.current.turn;
    speaker.current?.stop();
    setView({ phase: 'thinking' });
    let result: AnswerResponse;
    try { result = await api<AnswerResponse>(`/ai-runs/${encodeURIComponent(runId)}/answer`, { method: 'POST', body: JSON.stringify(body) }); }
    catch (cause) {
      if (S.current.turn !== turn) return;
      setView({ notice: errorText(cause) });
      void speakThenListen('Perdona, he tenido un problema al procesarlo. ¿Puedes repetirlo?');
      return;
    }
    if (S.current.turn !== turn) return;
    switch (result.kind) {
      case 'decision': {
        const option = situation.options[result.optionIndex];
        setView({ phase: 'reaction', pending: null, chosen: { index: result.optionIndex, quality: result.reaction?.quality ?? option?.quality }, extraSources: result.reaction?.sources ?? [] });
        await say(result.reaction?.spoken ?? '');
        if (S.current.turn !== turn) return;
        await sleep(reducedMotion() ? 300 : 900);
        if (S.current.turn === turn) void goNext();
        return;
      }
      case 'confirm':
        setView({ pending: result.optionIndex });
        void speakThenListen(result.prompt, 'confirm');
        return;
      case 'answer':
        setView({ extraSources: result.sources ?? [] });
        void speakThenListen(result.spoken);
        return;
      case 'repeat':
        void speakThenListen(situation.narration);
        return;
      case 'next':
        void goNext();
        return;
      default:
        void speakThenListen(result.spoken || 'No te he entendido bien. Dime qué harías con tus palabras o di la letra de la opción.');
    }
  }, [api, runId, goNext, say, setView, speakThenListen]);

  const answerConfirm = useCallback((yes: boolean) => {
    const pending = S.current.pending;
    if (pending == null) return;
    if (yes) void submit({ optionIndex: pending });
    else { setView({ pending: null }); void speakThenListen('De acuerdo. ¿Qué harías tú?'); }
  }, [submit, setView, speakThenListen]);

  /** Frase completa del usuario (voz o texto escrito). */
  const handlePhrase = useCallback((phrase: string) => {
    const phase = S.current.phase;
    if (!S.current.situation || ['loading', 'intro', 'generating', 'thinking', 'summary', 'error', 'reaction'].includes(phase)) return;
    speaker.current?.stop();
    const text = normalizeSpeech(phrase);
    if (S.current.pending != null) {
      if (/^(si|vale|correcto|exacto|eso|confirmo|claro|efectivamente)\b/.test(text)) { answerConfirm(true); return; }
      if (/^no\b/.test(text)) { answerConfirm(false); return; }
    }
    const direct = shortOption(phrase, S.current.situation.options.length);
    if (direct !== null) { void submit({ optionIndex: direct }); return; }
    void submit({ phrase });
  }, [answerConfirm, submit]);

  const choose = useCallback((index: number) => {
    if (!S.current.situation || !['speaking', 'listening', 'confirm'].includes(S.current.phase)) return;
    void submit({ optionIndex: index });
  }, [submit]);

  /* ---------- Micrófono ---------- */
  const startMic = useCallback(async () => {
    if (listener.current?.running) return;
    listener.current = new LiveListener(
      () => api<{ apiKey?: string; websocketUrl?: string }>('/voice/temporary-key', { method: 'POST', body: JSON.stringify({ aiRunId: runId }) }),
      {
        onState: (mic, message) => setView({ mic, micMessage: message ?? '' }),
        onPartial: text => {
          // Interrupción: si la persona habla por encima de VictorIA (y no es eco), se corta la voz al momento.
          if (speaker.current?.speaking() && isBargeIn(text, S.current.spoken)) {
            if (['speaking', 'listening', 'confirm'].includes(S.current.phase) || (S.current.phase === 'reaction')) speaker.current.stop();
          }
          if (!speaker.current?.speaking()) setView({ heard: text });
        },
        onFinal: phrase => {
          if (speaker.current?.speaking() && looksLikeEcho(phrase, S.current.spoken)) return;
          setView({ heard: phrase });
          handlePhrase(phrase);
        }
      });
    await listener.current.start();
  }, [api, runId, handlePhrase, setView]);

  /* ---------- Inicio (gesto del usuario: desbloquea el audio) ---------- */
  const begin = useCallback(async (withMic: boolean) => {
    if (S.current.started) return;
    S.current.started = true;
    const grant = app.standalone ? null : () => api<TtsGrant>('/voice/tts-key', { method: 'POST', body: '{}' });
    speaker.current = new AdaptiveSpeaker(grant, message => setView({ notice: message }));
    // Pantalla completa sin esperar: en algunos contextos (iframes, vistas previas) la promesa no se resuelve nunca.
    try { if (!document.fullscreenElement && root.current?.requestFullscreen) void root.current.requestFullscreen().catch(() => undefined); } catch { /* sin pantalla completa */ }
    const unlocking = speaker.current.unlock();
    if (withMic && S.current.voice) void startMic();
    await Promise.race([unlocking, sleep(1500)]);
    const situation = S.current.situation;
    if (situation) {
      const turn = ++S.current.turn;
      setView({ phase: 'speaking' });
      await say(situation.narration);
      if (S.current.turn === turn && S.current.phase === 'speaking') setView({ phase: 'listening' });
    } else void goNext();
  }, [api, app.standalone, goNext, say, setView, startMic]);

  const exit = useCallback(() => {
    S.current.turn++;
    speaker.current?.stop();
    listener.current?.stop();
    const collection = S.current.run?.collectionId;
    navigate(collection ? `/escenarios/ia?coleccion=${encodeURIComponent(collection)}` : '/escenarios/ia');
  }, []);

  /** «Convertir en escenario para clase»: abre el editor del borrador (la consola, fuera de la pantalla completa). */
  const convert = useCallback(() => {
    S.current.turn++;
    speaker.current?.stop();
    listener.current?.stop();
    navigate(`/escenarios/borrador/${encodeURIComponent(runId)}`);
  }, [runId]);

  const restart = useCallback(async (focus: string) => {
    const collectionId = S.current.run?.collectionId;
    if (!collectionId) return;
    try {
      const result = await api<{ run: AiRun }>('/ai-runs', { method: 'POST', body: JSON.stringify({ collectionId, situations: S.current.run?.situationsTotal, focus: focus.trim() || undefined }) });
      S.current.turn++; speaker.current?.dispose(); listener.current?.stop();
      navigate(`/ia/${encodeURIComponent(result.run.id)}`);
    } catch (cause) { setView({ notice: errorText(cause) }); }
  }, [api, setView]);

  /* ---------- Teclado ---------- */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA');
      if (event.key === 'Escape') { if (typing) { (target as HTMLElement).blur(); return; } if (openSource) { setOpenSource(null); return; } event.preventDefault(); exit(); return; }
      if (typing || event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const count = S.current.situation?.options.length ?? 0;
      const index = '1234'.indexOf(key) >= 0 ? '1234'.indexOf(key) : 'abcd'.indexOf(key);
      if (index >= 0 && index < count && ['speaking', 'listening', 'confirm'].includes(S.current.phase) && !(target?.tagName === 'BUTTON' && key === ' ')) { event.preventDefault(); choose(index); return; }
      if (S.current.phase === 'confirm' && (key === 's' || key === 'n')) { event.preventDefault(); answerConfirm(key === 's'); return; }
      if (key === 'r' && S.current.situation && ['listening', 'speaking'].includes(S.current.phase)) { event.preventDefault(); void speakThenListen(S.current.situation.narration); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [choose, answerConfirm, exit, openSource, speakThenListen]);

  /* ---------- Presencia animada y subtítulos (un solo bucle rAF) ---------- */
  useEffect(() => {
    let frame = 0;
    let smooth = 0;
    let lastKey = '';
    const still = reducedMotion();
    const start = performance.now();
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const spk = speaker.current;
      const speaking = !!spk?.speaking();
      const phase = S.current.phase;
      const listening = !speaking && (phase === 'listening' || phase === 'confirm') && listener.current?.running;
      const raw = speaking ? spk!.level() : listening ? listener.current!.level() * 0.8 : 0;
      smooth += (raw - smooth) * (raw > smooth ? 0.35 : 0.08);
      // Subtítulos: frase en curso y palabras ya dichas.
      const progress = spk?.progress();
      if (progress) {
        const words = progress.text.split(/\s+/).length;
        const shown = Math.min(words, Math.max(1, Math.ceil(progress.fraction * words + 0.6)));
        const key = `${progress.segment}|${shown}|${progress.text.length}`;
        if (key !== lastKey) { lastKey = key; setCaption(current => current.text === progress.text && current.words === shown ? current : { text: progress.text, words: shown, key: current.key }); }
      }
      const node = canvas.current;
      if (!node) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      const size = node.clientWidth;
      if (node.width !== Math.round(size * ratio) || node.height !== node.width) { node.width = Math.round(size * ratio); node.height = Math.round(size * ratio); }
      const ctx = node.getContext('2d');
      if (!ctx) return;
      const t = still ? 0 : (performance.now() - start) / 1000;
      const w = node.width; const c = w / 2;
      ctx.clearRect(0, 0, w, w);
      const thinking = phase === 'generating' || phase === 'thinking';
      const breathe = still ? 0 : Math.sin(t * 1.1) * 0.015;
      const base = w * 0.27 * (1 + breathe + smooth * 0.1);
      // Halo
      const halo = ctx.createRadialGradient(c, c, base * 0.4, c, c, base * (1.7 + smooth * 0.1));
      halo.addColorStop(0, listening ? 'rgba(255,93,116,0.28)' : 'rgba(100,158,255,0.34)');
      halo.addColorStop(1, 'rgba(0,26,51,0)');
      ctx.fillStyle = halo; ctx.fillRect(0, 0, w, w);
      // Capas de la forma viva
      const layers = [
        { amp: 0.05 + smooth * 0.2, speed: 0.9, alpha: 0.35, color: listening ? [255, 93, 116] : [100, 158, 255], scale: 1.12 },
        { amp: 0.035 + smooth * 0.14, speed: 1.3, alpha: 0.55, color: [120, 175, 255], scale: 1.0 },
        { amp: 0.02 + smooth * 0.08, speed: 1.8, alpha: 0.95, color: [232, 241, 255], scale: 0.78 }
      ];
      layers.forEach((layer, n) => {
        ctx.beginPath();
        const steps = 120;
        for (let i = 0; i <= steps; i++) {
          const a = (i / steps) * Math.PI * 2;
          const wobble = Math.sin(a * 3 + t * layer.speed + n) * 0.5 + Math.sin(a * 5 - t * layer.speed * 1.4 + n * 2) * 0.3 + Math.sin(a * 7 + t * layer.speed * 2.1) * 0.2;
          const r = base * layer.scale * (1 + wobble * layer.amp + (thinking ? Math.sin(a * 2 - t * 3) * 0.025 : 0));
          const x = c + Math.cos(a) * r; const y = c + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const g = ctx.createRadialGradient(c - base * 0.3, c - base * 0.35, base * 0.1, c, c, base * layer.scale * 1.15);
        const [r, gC, b] = layer.color;
        g.addColorStop(0, `rgba(${r},${gC},${b},${layer.alpha})`);
        g.addColorStop(1, `rgba(${Math.round(r * 0.3)},${Math.round(gC * 0.4)},${Math.round(b * 0.6)},${layer.alpha * 0.25})`);
        ctx.fillStyle = g; ctx.fill();
      });
      // Arco giratorio mientras piensa
      if (thinking) {
        ctx.lineWidth = w * 0.006; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(232,241,255,0.8)';
        ctx.beginPath(); const from = t * 2.4; ctx.arc(c, c, base * 1.32, from, from + Math.PI * 0.55); ctx.stroke();
      }
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  /* ---------- Pintado ---------- */
  const { phase, situation, chosen, pending, summary, run } = view;
  const total = run?.situationsTotal ?? 0;
  const number = situation ? Math.min(total || situation.index + 1, situation.index + 1) : 0;
  const sources = [...(situation?.sources ?? []), ...view.extraSources.filter(extra => !(situation?.sources ?? []).some(item => item.id === extra.id))];
  const speakingNow = !!speaker.current?.speaking();
  const status = phase === 'generating' ? `VictorIA está preparando la ${situation ? 'siguiente' : 'primera'} situación…`
    : phase === 'thinking' ? 'VictorIA está pensando…'
    : phase === 'confirm' ? 'Di «sí» o «no», o usa los botones.'
    : phase === 'listening' ? (view.mic === 'on' ? 'Te escucho. Explica qué harías o di la letra de una opción.' : 'Elige una opción o escribe tu respuesta.')
    : phase === 'reaction' ? 'Consecuencia de tu decisión'
    : phase === 'speaking' ? (view.mic === 'on' ? 'Puedes interrumpirla hablando.' : '')
    : '';
  const decided = phase === 'reaction' && chosen != null;
  const captionWords = caption.text ? caption.text.split(/\s+/) : [];

  return <div ref={root} className={`ai-live phase-${phase} ${speakingNow ? 'is-speaking' : ''}`} role="application" aria-roledescription="Simulación con VictorIA">
    <div className="ai-bg" aria-hidden="true"/>
    <header className="ai-top">
      <img src={brand.logoOnDark} alt={brand.organization} height="26"/>
      <div className="ai-top-mid">{situation && total > 0 && <span className="ai-progress" aria-label={`Situación ${number} de ${total}`}>Situación {number} de {total}<span className="ai-dots" aria-hidden="true">{Array.from({ length: total }, (_, i) => <i key={i} className={i < number - 1 ? 'done' : i === number - 1 ? 'now' : ''}/>)}</span></span>}</div>
      <div className="ai-top-right">
        <span className={`ai-mic mic-${view.mic}`} title={view.micMessage || undefined}><Icon name="mic" size={16}/><span>{view.mic === 'on' ? 'Micrófono activo' : view.mic === 'starting' ? 'Activando…' : view.mic === 'error' ? 'Sin micrófono' : 'Micrófono apagado'}</span></span>
        {S.current.started && view.mic !== 'on' && view.mic !== 'starting' && voice && <button className="ai-btn ai-ghost ai-sm" onClick={() => void startMic()}>Activar voz</button>}
        <button className="ai-btn ai-ghost ai-sm" onClick={exit} aria-keyshortcuts="Escape"><Icon name="close" size={16}/>Salir</button>
      </div>
    </header>

    <main className="ai-stage">
      <div className="ai-presence">
        <canvas ref={canvas} className="ai-orb" aria-hidden="true"/>
        <span className="ai-name">VictorIA</span>
      </div>

      {phase === 'loading' && <p className="ai-status" role="status">Cargando la simulación…</p>}

      {phase === 'intro' && <section className="ai-intro" aria-labelledby="ai-intro-title">
        <span className="ai-eyebrow">Modo IA en vivo · demo</span>
        <h1 id="ai-intro-title">Conversa con VictorIA</h1>
        <p>VictorIA te planteará {total ? `${total} situaciones` : 'varias situaciones'} generadas a partir de tus documentos. Responde con tu voz, como en una conversación; también puedes tocar las opciones o usar las teclas 1 a 4.</p>
        {voice && voice.region !== 'eu' && <p className="ai-transfer" role="note"><Icon name="mic" size={16}/>Al activar la voz, el audio del micrófono se transcribe con Soniox en EE. UU. (transferencia internacional). No se graba ni se guarda. No digas datos personales.</p>}
        <div className="ai-intro-actions">
          {voice ? <><button className="ai-btn ai-primary ai-lg" onClick={() => void begin(true)} autoFocus><Icon name="mic" size={18}/>Empezar con voz</button><button className="ai-btn ai-ghost" onClick={() => void begin(false)}>Empezar sin micrófono</button></>
          : <button className="ai-btn ai-primary ai-lg" onClick={() => void begin(false)} autoFocus><Icon name="play" size={18}/>Empezar</button>}
        </div>
        {!voice && <small className="ai-fine-dark">Reconocimiento de voz no disponible aquí: responde tocando o escribiendo.</small>}
        {!app.standalone && <a className="ai-btn ai-ghost ai-sm" href={aiSimulatorUrl(runId, app.demo)}><Icon name="external" size={16}/>Abrir en 3D con VictorIA</a>}
      </section>}

      {phase === 'error' && <section className="ai-intro" role="alert"><h1>Algo no ha ido bien</h1><p>{view.error}</p><div className="ai-intro-actions">{S.current.started && <button className="ai-btn ai-primary" onClick={() => void goNext()}>Reintentar</button>}<button className="ai-btn ai-ghost" onClick={exit}>Volver</button></div></section>}

      {phase === 'generating' && !situation && <p className="ai-status ai-preparing"><span className="ai-shimmer">VictorIA está preparando la primera situación…</span>{speakingNow && caption.text && <span className="ai-filler">{caption.text}</span>}</p>}

      {phase === 'summary' && summary && <Summary summary={summary} onBack={exit} onRestart={restart} onConvert={convert}/>}

      {situation && phase !== 'summary' && phase !== 'intro' && phase !== 'error' && <section className={`ai-situation ${phase === 'generating' ? 'leaving' : ''}`} aria-labelledby="ai-sit-title" key={situation.id}>
        <h1 id="ai-sit-title" className="ai-title">{situation.title}</h1>
        <p className="sr-only">{situation.narration}</p>
        <div className="ai-caption" aria-hidden="true">
          {caption.text && speakingNow ? <p key={caption.key}>{captionWords.map((word, i) => <span key={i} className={i < caption.words ? 'on' : ''}>{word} </span>)}</p>
          : view.heard && (phase === 'listening' || phase === 'thinking' || phase === 'confirm') ? <p className="you">«{view.heard}»</p>
          : <p className="dim">{phase === 'reaction' && chosen ? situation.options[chosen.index]?.consequence ?? '' : ''}</p>}
        </div>
        <ol className={`ai-options ${decided ? 'decided' : ''}`} aria-label="Opciones">
          {situation.options.map((option, i) => {
            const isChosen = chosen?.index === i; const isPending = pending === i;
            return <li key={i}>
              <button className={`ai-card ${isChosen ? 'chosen' : ''} ${isPending ? 'pending' : ''} ${decided && !isChosen ? 'muted' : ''}`} onClick={() => choose(i)} disabled={!['speaking', 'listening', 'confirm'].includes(phase)} aria-keyshortcuts={`${i + 1} ${optionLetter(i)}`} aria-pressed={isChosen || undefined}>
                <span className="ai-letter" aria-hidden="true">{optionLetter(i)}</span>
                <span className="ai-card-text"><span className="sr-only">Opción {optionLetter(i)}: </span>{option.label}
                  {decided && option.quality && <span className={`ai-quality q-${option.quality}`}>{qualityLabel(option.quality)}</span>}
                  {decided && isChosen && option.consequence && <span className="ai-consequence">{option.consequence}</span>}
                </span>
              </button>
            </li>;
          })}
        </ol>
        {phase === 'confirm' && pending != null && <div className="ai-confirm" role="group" aria-label="Confirmar opción"><span>¿Opción {optionLetter(pending)}?</span><button className="ai-btn ai-primary" onClick={() => answerConfirm(true)}>Sí</button><button className="ai-btn ai-ghost" onClick={() => answerConfirm(false)}>No</button></div>}
        {sources.length > 0 && <div className="ai-sources">{sources.map(source => <span key={source.id} className="ai-source-wrap">
          <button className="ai-source" aria-expanded={openSource === source.id} aria-describedby={`src-${source.id}`} onClick={() => setOpenSource(current => current === source.id ? null : source.id)}><Icon name="doc" size={14}/>Fuente: {source.document}</button>
          <span className={`ai-excerpt ${openSource === source.id ? 'open' : ''}`} role="tooltip" id={`src-${source.id}`}>«{source.excerpt}»</span>
        </span>)}</div>}
      </section>}

      {phase === 'generating' && situation && <p className="ai-status ai-preparing"><span className="ai-shimmer">VictorIA está preparando la siguiente situación…</span>{speakingNow && caption.text && <span className="ai-filler">{caption.text}</span>}</p>}
    </main>

    <footer className="ai-bottom">
      <p className="ai-badge"><Icon name="sparkles" size={14}/>Generado con IA a partir de tus documentos · puede contener errores</p>
      {situation && ['listening', 'speaking', 'confirm'].includes(phase) && <form className="ai-type" onSubmit={event => { event.preventDefault(); const value = typed.trim(); if (!value) return; setTyped(''); setView({ heard: value }); handlePhrase(value); }}>
        <label className="sr-only" htmlFor="ai-typed">Escribe tu respuesta</label>
        <input id="ai-typed" value={typed} maxLength={300} placeholder={view.mic === 'on' ? 'O escribe tu respuesta…' : 'Escribe qué harías…'} onChange={event => setTyped(event.target.value)} autoComplete="off"/>
        <button className="ai-btn ai-ghost ai-sm" disabled={!typed.trim()}>Enviar</button>
      </form>}
      <p className="ai-live-status" role="status" aria-live="polite">{status}{view.notice ? ` · ${view.notice}` : ''}{view.micMessage && view.mic === 'error' ? ` · ${view.micMessage}` : ''}</p>
    </footer>
  </div>;
}

function Summary({ summary, onBack, onRestart, onConvert }: { summary: AiSummary; onBack: () => void; onRestart: (focus: string) => void; onConvert: () => void }) {
  const [focus, setFocus] = useState('');
  const [busy, setBusy] = useState(false);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <section className="ai-summary" aria-labelledby="ai-sum-title">
    <span className="ai-eyebrow">Fin de la simulación</span>
    <h1 id="ai-sum-title" tabIndex={-1} ref={heading}>Resumen</h1>
    <div className="ai-score"><strong>{summary.optimalCount}</strong><span>de {summary.total} decisiones óptimas</span></div>
    <p className="ai-sum-text">{summary.spoken}</p>
    {summary.takeaways?.length > 0 && <><h2>Ideas clave</h2><ul className="ai-takeaways">{summary.takeaways.map((item, i) => <li key={i}><Icon name="check" size={16}/>{item}</li>)}</ul></>}
    <div className="ai-convert">
      <button className="ai-btn ai-primary ai-lg" onClick={onConvert}><Icon name="scenarios" size={18}/>Convertir en escenario para clase</button>
      <small>Revisa y edita estas situaciones antes de publicarlas. Después podrás usarlas en sesiones con QR o PIN, proyector e informe.</small>
    </div>
    <form className="ai-restart" onSubmit={event => { event.preventDefault(); setBusy(true); onRestart(focus); }}>
      <label htmlFor="ai-focus">Otro enfoque (opcional)</label>
      <div><input id="ai-focus" value={focus} maxLength={200} placeholder="Ej.: más centrado en la evaluación" onChange={event => setFocus(event.target.value)}/>
        <button className="ai-btn ai-ghost" disabled={busy}><Icon name="sparkles" size={16}/>{busy ? 'Preparando…' : 'Repetir con otro enfoque'}</button></div>
    </form>
    <button className="ai-btn ai-ghost" onClick={onBack}><Icon name="back" size={16}/>Volver</button>
  </section>;
}
