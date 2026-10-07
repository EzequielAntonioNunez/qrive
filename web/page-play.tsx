/**
 * /jugar/:sessionId: la sesión en el móvil del participante (invitado o miembro). En directo por WebSocket con
 * consulta de respaldo; solo recibe su vista filtrada (participantView/participantReport), nunca datos de otros.
 * Estados: bienvenida → situación (escuchar a VictorIA, elegir, confirmar) → resultado → espera → resumen final.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { meterLabels, type Choice, type MeterName, type Meters, type Phase, type SessionState } from '../shared/simulation';
import { brand } from './brand';
import { commandId, guestApi, haptic, meId, meName, type GuestError, type GuestMe } from './guest';
import { useLiveSession, type LiveMode } from './live';
import { navigate } from './router';
import { errorText, formatClock, optionLetter, signed, type SessionPayload, type TimelineEntry } from './types';
import { useMobileVoice } from './voice-mobile';
import './play.css';

const METER_ORDER: MeterName[] = ['relationship', 'margin', 'risk'];
/** Valoración de la decisión (no de la persona), con un tono amable para el móvil. */
function decisionTone(quality: string | null | undefined): { label: string; tone: string } | null {
  if (quality === 'best') return { label: 'Buena práctica', tone: 'best' };
  if (quality === 'acceptable') return { label: 'Aceptable, con matices', tone: 'ok' };
  if (quality === 'poor') return { label: 'Decisión arriesgada', tone: 'poor' };
  return null;
}
/** Para «riesgo», bajar es bueno. */
function meterGood(meter: MeterName, delta: number): boolean { return meter === 'risk' ? delta < 0 : delta > 0; }

/** Solo suena una voz a la vez: la situación o la reacción a la decisión. */
let speakingAudio: HTMLAudioElement | null = null;
let speakingSince = 0;
function playExclusive(element: HTMLAudioElement): Promise<void> {
  if (speakingAudio && speakingAudio !== element) speakingAudio.pause();
  speakingAudio = element;
  speakingSince = performance.now();
  return element.play();
}
/** Milisegundos que lleva sonando VictorIA, o null si no suena (para la interrupción por voz). */
function speakingForMs(): number | null {
  const element = speakingAudio;
  return element && !element.paused && !element.ended ? performance.now() - speakingSince : null;
}
/** La persona habla por encima de VictorIA: se corta el audio al momento. */
function stopSpeaking() { speakingAudio?.pause(); }
/** Respuesta hablada de VictorIA a una opción, generada offline con la misma voz (scripts/tts/generate_reactions.mjs). */
function reactionUrl(phaseId: string, optionId: string): string {
  return `/voz/reacciones/${encodeURIComponent(phaseId)}__${encodeURIComponent(optionId)}.mp3`;
}

export function PlayPage({ sessionId }: { sessionId: string }) {
  const [me, setMe] = useState<GuestMe | null>(null);
  const [authError, setAuthError] = useState<'expired' | 'network' | null>(null);
  const [gone, setGone] = useState(false);
  const [started, setStarted] = useState(() => { try { return sessionStorage.getItem(`ufv-play-${sessionId}`) === '1'; } catch { return false; } });

  useEffect(() => { document.title = `Sesión en directo · ${brand.product} · ${brand.shortName}`; }, []);
  const loadMe = useCallback(() => {
    guestApi<GuestMe>('/me').then(result => { setMe(result); setAuthError(null); })
      .catch(cause => setAuthError((cause as GuestError).status === 401 || (cause as GuestError).status === 403 ? 'expired' : 'network'));
  }, []);
  useEffect(() => { loadMe(); }, [loadMe]);
  useEffect(() => { if (authError !== 'network') return; const timer = window.setInterval(loadMe, 4000); return () => window.clearInterval(timer); }, [authError, loadMe]);

  const userId = meId(me);
  const fetchSession = useCallback((id: string) => guestApi<SessionPayload>(`/sessions/${encodeURIComponent(id)}`), []);
  const onError = useCallback((cause: unknown) => { const status = (cause as GuestError).status; if (status === 401) setAuthError('expired'); else if (status === 404 || status === 403) setGone(true); }, []);
  const live = useLiveSession<SessionPayload>(userId && !gone ? sessionId : null, { fetchSession, socket: me?.flags?.realtime_websocket !== false, onError, onGone: () => setGone(true) });

  if (authError === 'expired') return <Shell><Notice title="La sesión ha terminado" text="Tu acceso de invitado ha caducado. ¡Gracias por participar! Si hay una sesión nueva, únete con el código que aparece en la pantalla del aula." action={<button className="play-primary" onClick={() => navigate('/unirse')}>Unirme con un código</button>}/></Shell>;
  if (gone) return <Shell><Notice title="Esta sesión ya no está disponible" text="Puede que el docente la haya cerrado o eliminado. Si hay una sesión nueva, únete con su código." action={<button className="play-primary" onClick={() => navigate('/unirse')}>Unirme a otra sesión</button>}/></Shell>;
  if (!me || !live.data || !userId) return <Shell mode={live.mode}><div className="play-loading" aria-busy="true"><span className="play-spinner" aria-hidden="true"/><p role="status">{authError === 'network' ? 'Sin conexión. Reintentando…' : 'Conectando con la sesión…'}</p></div></Shell>;

  const begin = () => { setStarted(true); try { sessionStorage.setItem(`ufv-play-${sessionId}`, '1'); } catch { /* sin almacenamiento */ } };
  return <PlayView payload={live.data} userId={userId} alias={meName(me)} mode={live.mode} sessionId={sessionId} started={started} onStart={begin} onReplace={live.replace} onAuthLost={() => setAuthError('expired')}/>;
}

function Shell({ children, mode, alias, title }: { children: React.ReactNode; mode?: LiveMode; alias?: string; title?: string }) {
  return <div className="play-root">
    <header className="play-top">
      <img src={brand.logoOnDark} alt={brand.organization} height="26"/>
      <span className={`play-top-product ${alias ? 'with-alias' : ''}`}>{title ?? brand.product}</span>
      <span className="play-top-end">{mode && <LiveDot mode={mode}/>}{alias && <span className="play-alias" title="Tu alias">{alias}</span>}</span>
    </header>
    <main className="play-main" id="contenido">{children}</main>
  </div>;
}

function LiveDot({ mode }: { mode: LiveMode }) {
  const label = mode === 'live' ? 'En directo' : mode === 'reconnecting' ? 'Reconectando…' : mode === 'polling' ? 'En directo' : 'Sin conexión';
  return <span className={`play-live ${mode}`} role="status" aria-live="polite"><span className="dot" aria-hidden="true"/>{label}</span>;
}

function Notice({ title, text, action }: { title: string; text: string; action?: React.ReactNode }) {
  return <section className="play-card play-notice enter"><h1>{title}</h1><p>{text}</p>{action}</section>;
}

type ViewProps = { payload: SessionPayload; userId: string; alias: string; mode: LiveMode; sessionId: string; started: boolean; onStart: () => void; onReplace: (next: SessionPayload) => void; onAuthLost: () => void };

function PlayView({ payload, userId, alias, mode, sessionId, started, onStart, onReplace, onAuthLost }: ViewProps) {
  const { state } = payload;
  const scenario = state.scenario;
  const phase = scenario.phases[Math.min(state.phaseIndex, scenario.phases.length - 1)];
  const joined = state.participants.some(person => person.userId === userId);
  const decision = state.decisions.find(item => item.userId === userId && item.phaseId === phase.id);
  const remaining = useRemaining(state);
  const expired = remaining !== null && remaining <= 0 && !!state.phaseDeadline;
  // Tras agotarse el tiempo se puede decidir igualmente (el motor lo admite, igual que el 3D y la consola).
  const canDecide = state.status === 'active' && joined && !decision;
  const [selected, setSelected] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const joinTried = useRef(false);

  // Si la identidad aún no está en la sesión (p. ej., un miembro que abre el enlace), se une una vez.
  useEffect(() => {
    if (joined || joinTried.current || state.status === 'complete') return;
    joinTried.current = true;
    guestApi<SessionPayload>(`/sessions/${encodeURIComponent(sessionId)}/commands`, { method: 'POST', body: JSON.stringify({ id: commandId(), type: 'join' }) }).then(onReplace).catch(() => undefined);
  }, [joined, sessionId, state.status, onReplace]);
  useEffect(() => { setSelected(null); setError(''); }, [phase.id]);

  // Un único elemento de audio para la reacción de VictorIA: se reutiliza al repetirla desde la tarjeta de resultado.
  const reaction = useRef<HTMLAudioElement | null>(null);
  const reactionFor = useCallback((phaseId: string, optionId: string) => {
    const src = reactionUrl(phaseId, optionId);
    let element = reaction.current;
    if (!element) { element = new Audio(); element.preload = 'none'; reaction.current = element; }
    if (element.dataset.src !== src) { element.pause(); element.src = src; element.dataset.src = src; }
    return element;
  }, []);
  // Si el docente pasa a la siguiente situación (o se sale de la vista), la reacción en curso se corta.
  useEffect(() => () => { reaction.current?.pause(); }, [phase.id]);

  const decide = useCallback(async (index: number) => {
    const option = phase.options[index];
    if (!option || busy) return;
    setBusy(true); setError('');
    haptic([18, 40, 18]);
    // La reacción empieza dentro del gesto de confirmar (iOS no deja reproducir audio después de una espera de red).
    // Si falta el audio o el navegador lo bloquea, no pasa nada: queda el texto y el botón para escucharla.
    const reply = reactionFor(phase.id, option.id);
    reply.currentTime = 0;
    playExclusive(reply).catch(() => undefined);
    try {
      const next = await guestApi<SessionPayload>(`/sessions/${encodeURIComponent(sessionId)}/commands`, { method: 'POST', body: JSON.stringify({ id: commandId(), type: 'decide', optionId: option.id }) });
      onReplace(next);
    } catch (cause) {
      reply.pause();
      if ((cause as GuestError).status === 401) onAuthLost();
      else setError(errorText(cause));
    } finally { setBusy(false); }
  }, [phase, busy, sessionId, onReplace, onAuthLost, reactionFor]);

  const voice = useMobileVoice({ sessionId, optionCount: phase.options.length, canDecide, onChoose: index => { setSelected(index); void decide(index); }, speakingForMs, onBargeIn: stopSpeaking });

  const meters = state.participantMeters[userId] ?? state.meters;
  const labels = meterLabels(scenario);

  if (state.status === 'complete') return <Shell mode={mode} alias={alias} title={scenario.title}><Finished payload={payload} userId={userId} alias={alias}/></Shell>;
  if (!started) return <Shell mode={mode} alias={alias} title={scenario.title}><Welcome state={state} alias={alias} onStart={onStart} sessionId={sessionId}/></Shell>;

  const chosen = decision ? phase.options.find(option => option.id === decision.optionId) : undefined;
  return <Shell mode={mode} alias={alias} title={scenario.title}>
    <MeterStrip meters={meters} initial={scenario.initialMeters} labels={labels}/>
    <div className="play-progress" aria-label={`Situación ${state.phaseIndex + 1} de ${scenario.phases.length}`}>
      {scenario.phases.map((item, i) => <span key={item.id} className={i < state.phaseIndex ? 'done' : i === state.phaseIndex ? 'current' : ''}/>)}
    </div>
    {state.status === 'paused' && <div className="play-banner paused" role="status"><span className="pause-icon" aria-hidden="true"/>Sesión en pausa. Espera a que el docente la reanude.</div>}

    <section className="play-card play-situation enter" key={phase.id} aria-labelledby="situacion">
      <div className="play-situation-head">
        <span className="play-eyebrow">Situación {state.phaseIndex + 1} de {scenario.phases.length}</span>
        {remaining !== null && !decision && <PlayTimer remaining={remaining} paused={state.status === 'paused'} limitSec={phase.timeLimitSec}/>}
      </div>
      <h1 id="situacion" className="play-title">{phase.title}</h1>
      <p className="play-brief">{phase.briefing}</p>
      <CharacterLine phase={phase} name={scenario.character.name}/>
    </section>

    {chosen ? <Result phase={phase} option={chosen} index={phase.options.indexOf(chosen)} labels={labels} last={state.phaseIndex === scenario.phases.length - 1}
        name={scenario.character.name} reactionFor={reactionFor}/>
      : <section className="play-options" aria-label="Opciones">
        <h2 className="play-options-title">¿Qué harías?</h2>
        {expired && state.status === 'active' && <p className="play-banner expired" role="status">Se acabó el tiempo de esta situación: puedes decidir igualmente.</p>}
        <ol className="play-option-list">
          {phase.options.map((option, i) => <li key={option.id} style={{ '--i': i } as React.CSSProperties}>
            <button type="button" className={`play-option ${selected === i ? 'selected' : ''}`} aria-pressed={selected === i} disabled={!canDecide || busy}
              onClick={() => { haptic(10); setSelected(current => current === i ? null : i); }}>
              <span className="play-letter" aria-hidden="true">{optionLetter(i)}</span>
              <span className="play-option-label"><span className="sr-only">Opción {optionLetter(i)}: </span>{option.label}</span>
            </button>
          </li>)}
        </ol>
        {error && <p className="play-error" role="alert">{error}</p>}
        {voice.available && canDecide && <VoicePanel voice={voice} optionCount={phase.options.length}/>}
        <div className={`play-confirm ${selected !== null ? 'show' : ''}`}>
          <button type="button" className="play-primary" disabled={selected === null || !canDecide || busy} onClick={() => selected !== null && void decide(selected)}>
            {busy ? 'Enviando…' : selected === null ? 'Elige una opción' : `Confirmar opción ${optionLetter(selected)}`}
          </button>
        </div>
      </section>}
    <Open3D sessionId={sessionId}/>
    <AiNote state={state}/>
  </Shell>;
}

/** Aviso de transparencia (AI Act): discreto pero siempre visible en la partida. */
function AiNote({ state }: { state: SessionState }) {
  const name = state.scenario.character?.name || 'VictorIA';
  return <p className="play-ai-note" role="note">{state.scenario.origin?.kind === 'ai'
    ? `Escenario redactado con IA a partir de documentos y revisado por un docente. ${name} es un personaje virtual.`
    : `${name} es un personaje virtual: su imagen y su voz son sintéticas.`}</p>;
}

function useRemaining(state: SessionState): number | null {
  const [now, setNow] = useState(Date.now());
  const running = state.status === 'active' && !!state.phaseDeadline;
  useEffect(() => { if (!running) return; const timer = window.setInterval(() => setNow(Date.now()), 250); return () => window.clearInterval(timer); }, [running, state.phaseDeadline]);
  if (state.status === 'paused' && state.phaseRemainingMs != null) return state.phaseRemainingMs;
  if (!state.phaseDeadline) return null;
  return Math.max(0, Date.parse(state.phaseDeadline) - now);
}

function PlayTimer({ remaining, paused, limitSec }: { remaining: number; paused: boolean; limitSec?: number }) {
  const low = remaining <= 15000;
  const ratio = limitSec ? Math.max(0, Math.min(1, remaining / (limitSec * 1000))) : null;
  return <span className={`play-timer ${low ? 'low' : ''} ${paused ? 'paused' : ''}`} role="timer" aria-label={`Tiempo restante ${formatClock(remaining)}`}>
    {ratio !== null && <svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeOpacity=".25" strokeWidth="3"/><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="3" strokeDasharray={`${ratio * 50.27} 50.27`} transform="rotate(-90 10 10)" strokeLinecap="round"/></svg>}
    {formatClock(remaining)}
  </span>;
}

/** Frase de VictorIA con su locución (/voz/<idFase>.wav). Si el audio no existe, solo se muestra el texto. */
function CharacterLine({ phase, name }: { phase: Phase; name: string }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    setMissing(false); setPlaying(false);
    const element = new Audio();
    element.preload = 'none';
    element.src = `/voz/${encodeURIComponent(phase.id)}.wav`;
    element.onended = () => setPlaying(false);
    element.onpause = () => setPlaying(false);
    element.onplaying = () => setPlaying(true);
    element.onerror = () => { setMissing(true); setPlaying(false); };
    audio.current = element;
    // Los escenarios creados con IA no tienen locución: se comprueba antes de ofrecer «Escuchar». Un fichero que
    // no existe devuelve la página de la consola (respaldo SPA), así que se exige un tipo de audio.
    let alive = true;
    fetch(element.src, { method: 'HEAD' })
      .then(response => { if (alive && (!response.ok || !(response.headers.get('content-type') ?? '').startsWith('audio/'))) setMissing(true); })
      .catch(() => undefined);
    return () => { alive = false; element.pause(); element.onended = element.onpause = element.onplaying = element.onerror = null; element.src = ''; audio.current = null; };
  }, [phase.id]);
  if (!phase.characterLine) return null;
  const toggle = () => {
    const element = audio.current;
    if (!element) return;
    if (playing) { element.pause(); element.currentTime = 0; return; }
    playExclusive(element).catch(() => setMissing(true));
  };
  return <figure className="play-line">
    <figcaption><span className="play-avatar" aria-hidden="true">{name.slice(0, 1)}</span>{name}</figcaption>
    <blockquote>{phase.characterLine}</blockquote>
    {!missing && <button type="button" className={`play-listen ${playing ? 'playing' : ''}`} onClick={toggle} aria-pressed={playing}>
      {playing ? <><span className="eq" aria-hidden="true"><i/><i/><i/></span>Detener</> : <><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>Escuchar a {name}</>}
    </button>}
  </figure>;
}

function MeterStrip({ meters, initial, labels }: { meters: Meters; initial: Meters; labels: Record<MeterName, string> }) {
  return <div className="play-meters" aria-label="Tus indicadores">
    {METER_ORDER.map(meter => {
      const delta = meters[meter] - initial[meter];
      return <div key={meter} className={`play-meter ${meter}`}>
        <span className="play-meter-head"><span>{labels[meter]}</span><strong className="tabular">{meters[meter]}</strong></span>
        <span className="play-meter-bar" aria-hidden="true"><span style={{ width: `${meters[meter]}%` }}/></span>
        {delta !== 0 && <small className={meterGood(meter, delta) ? 'up' : 'down'}>{signed(delta)}</small>}
      </div>;
    })}
  </div>;
}

/** Botón para volver a escuchar la reacción de VictorIA a la decisión. Si el audio no existe, no se muestra. */
function ReactionReplay({ phaseId, optionId, name, reactionFor }: { phaseId: string; optionId: string; name: string; reactionFor: ReactionFor }) {
  const [playing, setPlaying] = useState(false);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    const element = reactionFor(phaseId, optionId);
    setMissing(!!element.error);
    setPlaying(!element.paused && !element.ended);
    const on = () => setPlaying(true);
    const off = () => setPlaying(false);
    const fail = () => { setPlaying(false); setMissing(true); };
    element.addEventListener('playing', on);
    element.addEventListener('pause', off);
    element.addEventListener('ended', off);
    element.addEventListener('error', fail);
    return () => {
      element.removeEventListener('playing', on);
      element.removeEventListener('pause', off);
      element.removeEventListener('ended', off);
      element.removeEventListener('error', fail);
    };
  }, [phaseId, optionId, reactionFor]);
  if (missing) return null;
  const toggle = () => {
    const element = reactionFor(phaseId, optionId);
    if (playing) { element.pause(); element.currentTime = 0; return; }
    element.currentTime = 0;
    playExclusive(element).catch(() => setMissing(true));
  };
  return <div><button type="button" className={`play-listen ${playing ? 'playing' : ''}`} onClick={toggle} aria-pressed={playing}>
    {playing ? <><span className="eq" aria-hidden="true"><i/><i/><i/></span>Detener</> : <><svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor"/></svg>Escuchar a {name}</>}
  </button></div>;
}

type ReactionFor = (phaseId: string, optionId: string) => HTMLAudioElement;

function Result({ phase, option, index, labels, last, name, reactionFor }: { phase: Phase; option: Choice; index: number; labels: Record<MeterName, string>; last: boolean; name: string; reactionFor: ReactionFor }) {
  const tone = decisionTone(option.quality);
  const effects = (option as Partial<Choice>).effects;
  const ref = useRef<HTMLElement>(null);
  // Al decidir, el resultado sube a la vista (sin animación si se ha pedido reducir el movimiento).
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    ref.current?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  }, []);
  return <>
    <section ref={ref} className="play-card play-result enter" aria-labelledby="resultado" style={{ scrollMarginTop: 64 }}>
      <span className="play-eyebrow">Tu decisión</span>
      <h2 id="resultado" className="play-result-choice"><span className="play-letter" aria-hidden="true">{optionLetter(index)}</span>{option.label}</h2>
      {tone && <span className={`play-quality ${tone.tone}`}>{tone.label}</span>}
      <ReactionReplay phaseId={phase.id} optionId={option.id} name={name} reactionFor={reactionFor}/>
      <h3>Qué ocurre</h3>
      <p>{option.consequence}</p>
      {effects && <ul className="play-effects" aria-label="Efecto en tus indicadores">{METER_ORDER.filter(meter => effects[meter]).map(meter => <li key={meter} className={meterGood(meter, effects[meter]) ? 'up' : 'down'}>{labels[meter]} <strong>{signed(effects[meter])}</strong></li>)}</ul>}
      {option.rationale && <><h3>Por qué</h3><p>{option.rationale}</p></>}
      {phase.takeaway && <aside className="play-takeaway"><span>Idea clave</span><p>{phase.takeaway}</p></aside>}
    </section>
    <section className="play-card play-wait" aria-live="polite">
      <h2>{last ? 'Espera al cierre de la sesión' : 'Espera a la siguiente situación'}</h2>
      <p>Mira la pantalla del aula: allí se ven los resultados de toda la clase.</p>
      <WaitDots/>
    </section>
  </>;
}

/**
 * «Abrir en 3D»: el simulador Unity WebGL de la misma sesión, en la misma pestaña (la cookie de invitado vale allí).
 * Solo en pantallas de ordenador o tableta (CSS): la descarga (unos 38 MB) y el 3D no están pensados para un móvil.
 */
function Open3D({ sessionId }: { sessionId: string }) {
  return <div className="play-3d">
    <a className="play-secondary" href={`/simulador/?sesion=${encodeURIComponent(sessionId)}`}>
      <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7zm0 2.3 6.7 3.7L12 11.7 5.3 8zM5 9.7l6 3.3v6.7l-6-3.3zm8 10V13l6-3.3v6.7z" fill="currentColor"/></svg>
      Abrir en 3D
    </a>
    <small>Experiencia inmersiva con VictorIA · requiere ordenador</small>
  </div>;
}

function WaitDots() { return <span className="wait-dots" aria-hidden="true"><i/><i/><i/></span>; }

function Welcome({ state, alias, onStart, sessionId }: { state: SessionState; alias: string; onStart: () => void; sessionId: string }) {
  const scenario = state.scenario;
  const name = scenario.character.name;
  return <section className="play-card play-welcome enter">
    <span className="play-avatar big" aria-hidden="true">{name.slice(0, 1)}</span>
    <span className="play-eyebrow">Ya estás dentro{alias ? `, ${alias}` : ''}</span>
    <h1 className="play-title">{scenario.title}</h1>
    <p className="play-brief">{scenario.summary}</p>
    <ul className="play-welcome-list">
      <li><strong>{scenario.phases.length} situaciones</strong> con {name}. En cada una eliges qué harías.</li>
      <li>Tus votos se suman en directo a la pantalla del aula, sin tu alias.</li>
      <li>Al decidir verás qué ocurre y por qué. Se valora la decisión, no a la persona.</li>
    </ul>
    <button type="button" className="play-primary" onClick={() => { haptic(12); onStart(); }}>{state.phaseIndex > 0 ? `Ir a la situación ${state.phaseIndex + 1}` : 'Empezar'}</button>
    <Open3D sessionId={sessionId}/>
    <AiNote state={state}/>
  </section>;
}

function Finished({ payload, userId, alias }: { payload: SessionPayload; userId: string; alias: string }) {
  const { state, report } = payload;
  const scenario = state.scenario;
  const labels = meterLabels(scenario);
  const timeline = (report.timeline as TimelineEntry[]).filter(entry => entry.userId === userId);
  const end = report.meters ?? state.participantMeters[userId] ?? state.meters;
  const ideas = useMemo(() => [...new Set(scenario.phases.map(phase => phase.takeaway).filter((text): text is string => !!text))], [scenario]);
  const best = timeline.filter(entry => entry.quality === 'best').length;
  return <div className="play-finished">
    <section className="play-card play-hero enter">
      <span className="play-confetti" aria-hidden="true">{Array.from({ length: 14 }, (_, i) => <i key={i} style={{ '--i': i } as React.CSSProperties}/>)}</span>
      <span className="play-eyebrow">Sesión terminada</span>
      <h1 className="play-title">¡Gracias por participar{alias ? `, ${alias}` : ''}!</h1>
      <p className="play-brief">Este es tu resumen personal. Solo lo ves tú.</p>
      <div className="play-stats">
        <div><strong className="tabular">{timeline.length}</strong><span>{timeline.length === 1 ? 'decisión' : 'decisiones'}</span></div>
        <div><strong className="tabular">{best}</strong><span>con la mejor práctica</span></div>
        <div><strong className="tabular">{report.objectivesMet}/{report.objectivesTotal}</strong><span>objetivos</span></div>
      </div>
    </section>
    <section className="play-card enter" aria-labelledby="ind">
      <h2 id="ind" className="play-h2">Tus indicadores</h2>
      <ul className="play-journey">{METER_ORDER.map(meter => { const delta = end[meter] - scenario.initialMeters[meter]; return <li key={meter}><span>{labels[meter]}</span><span className="tabular">{scenario.initialMeters[meter]} → <strong>{end[meter]}</strong></span><small className={delta === 0 ? '' : meterGood(meter, delta) ? 'up' : 'down'}>{delta === 0 ? 'sin cambios' : signed(delta)}</small></li>; })}</ul>
    </section>
    {timeline.length > 0 && <section className="play-card enter" aria-labelledby="dec">
      <h2 id="dec" className="play-h2">Tus decisiones</h2>
      <ol className="play-timeline">{timeline.map(entry => { const tone = decisionTone(entry.quality); return <li key={entry.phaseId}><span className="play-eyebrow">{entry.phaseTitle}</span><strong>{entry.label}</strong>{tone && <span className={`play-quality ${tone.tone}`}>{tone.label}</span>}{entry.rationale && <p>{entry.rationale}</p>}</li>; })}</ol>
    </section>}
    {ideas.length > 0 && <section className="play-card enter" aria-labelledby="ideas">
      <h2 id="ideas" className="play-h2">Ideas clave</h2>
      <ul className="play-ideas">{ideas.map(text => <li key={text}>{text}</li>)}</ul>
    </section>}
    <p className="join-foot">{brand.organization} · Puedes cerrar esta página.</p>
  </div>;
}

type Voice = ReturnType<typeof useMobileVoice>;
function VoicePanel({ voice, optionCount }: { voice: Voice; optionCount: number }) {
  const on = voice.phase === 'listening' || voice.phase === 'thinking' || voice.phase === 'confirm' || voice.phase === 'starting';
  return <div className={`play-voice ${voice.phase}`}>
    {voice.phase === 'notice' ? <div className="play-voice-notice" role="alertdialog" aria-label="Aviso sobre la voz">
      <p>Tu voz se transcribe en Soniox (EE. UU.) solo mientras la voz está activa; ni el simulador ni la UFV guardan el audio. Si prefieres no usarla, toca la opción en la pantalla.</p>
      <div className="play-voice-row"><button type="button" className="play-secondary" onClick={voice.accept}>🎙 Aceptar y activar</button><button type="button" className="play-text-btn" onClick={voice.stop}>Ahora no</button></div>
    </div>
      : <button type="button" className={`play-secondary play-mic ${on ? 'on' : ''}`} aria-pressed={on} disabled={voice.phase === 'starting'} onClick={() => on ? voice.stop() : void voice.start()}>
        {on ? <><span className="mic-pulse" aria-hidden="true"/>{voice.phase === 'starting' ? 'Activando…' : 'Voz activa · toca para parar'}</> : '🎙 Responder con la voz'}
      </button>}
    {voice.heard && on && <p className="play-voice-heard">«{voice.heard.slice(0, 140)}»</p>}
    {voice.status && <p className="play-voice-status" role="status">{voice.status}</p>}
    {voice.phase === 'confirm' && voice.pending !== null && voice.pending < optionCount && <div className="play-voice-row"><button type="button" className="play-primary small" onClick={() => voice.confirm(true)}>Sí, opción {optionLetter(voice.pending)}</button><button type="button" className="play-secondary small" onClick={() => voice.confirm(false)}>No</button></div>}
    <small className="play-voice-ai">Respuesta por voz opcional: un modelo de IA asigna tu frase a una opción y te pide confirmación si duda. No se guarda el audio.</small>
  </div>;
}
