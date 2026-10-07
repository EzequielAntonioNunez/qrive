/**
 * Modo proyector: panel a pantalla completa para el aula. Muestra solo datos agregados (nunca nombres).
 * Mientras la situación está abierta no se muestra ninguna valoración; al cerrarse (avance, tiempo agotado,
 * fin de la sesión o «Mostrar respuesta») se revela la mejor opción y la idea clave, si el escenario las define.
 * Al revelarla, VictorIA comenta el resultado de la clase con una frase de plantilla (projector-voice.ts): en voz
 * (Soniox) si está disponible y activada («Voz de VictorIA», tecla V) y siempre como subtítulo. «Comparar con la media»
 * muestra la clase frente a la media de la organización (GET /api/sessions/:id/benchmark); solo datos de grupo.
 * El docente que conduce la sesión tiene en la barra superior «Pausar»/«Reanudar» y «Finalizar» (con confirmación).
 */
import React, { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../shared/simulation';
import { brand } from './brand';
import type { LiveMode } from './live';
import { share, simulatedIds, tallyFor } from './stats';
import type { LiveTally } from './types';
import { optionLetter, plural } from './types';
import { Bar, CountUp, LiveBadge, ProgressRing, Timer } from './ui';
import type { Api } from './app-context';
import { JoinShare } from './share-qr';
import './projector-extras.css';
import type { TtsGrant } from './tts-stream';
import { benchmarkComment, benchmarkSentence, revealComment, useProjectorVoice, type BenchmarkView, type ProjectorVoice } from './projector-voice';

type Props = {
  state: SessionState; liveTally?: LiveTally; remainingMs: number | null; phaseExpired: boolean; mode: LiveMode; standalone: boolean;
  canControl: boolean; busy: boolean; exclude?: Set<string>;
  onClose: () => void; onCommand: (type: 'advance' | 'complete' | 'pause' | 'resume') => void;
  /** Finalizar con confirmación (misma lógica y textos que la consola: «¿Finalizar la sesión antes de tiempo?»). */
  onFinish?: () => void;
  /** Con la API, se muestra el panel «Únete» (QR + código) mientras no hay votos, o con la tecla Q. */
  api?: Api;
};

/** Teclas rápidas del proyector: no actúan mientras se escribe ni con un diálogo de confirmación abierto. */
function ignoreKey(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return event.ctrlKey || event.metaKey || event.altKey || !!target?.closest?.('input,textarea,select,.modal') || !!document.querySelector('.modal-backdrop');
}

export function ProjectorView({ state, liveTally, remainingMs, phaseExpired, mode, standalone, canControl, busy, exclude, onClose, onCommand, onFinish, api }: Props) {
  const [joinPanel, setJoinPanel] = useState<'auto' | 'shown' | 'hidden'>('auto');
  const phases = state.scenario.phases;
  const current = state.phaseIndex;
  const [shown, setShown] = useState(current);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const previous = useRef(current);
  const closeRef = useRef<HTMLButtonElement>(null);
  // Voz de VictorIA: el docente con la API real y servicio de voz (GET /api/voice/config), con o sin el modo IA en
  // vivo; si no, solo subtítulo.
  const [ttsReady, setTtsReady] = useState(false);
  useEffect(() => {
    if (!api || standalone || !canControl) return;
    let alive = true;
    api<{ enabled?: boolean }>('/voice/config').then(config => { if (alive && config?.enabled) setTtsReady(true); }).catch(() => undefined);
    return () => { alive = false; };
  }, [api, standalone, canControl]);
  const voice = useProjectorVoice(api && ttsReady
    ? () => api<TtsGrant>('/voice/tts-key', { method: 'POST', body: '{}' }) : null);
  const voiceRef = useRef<ProjectorVoice>(voice);
  voiceRef.current = voice;
  const [benchOpen, setBenchOpen] = useState(false);
  const benchOpenRef = useRef(benchOpen);
  benchOpenRef.current = benchOpen;

  // Al avanzar la sesión, se queda en la situación que acaba de cerrarse para comentar el resultado.
  useEffect(() => {
    if (current > previous.current) setShown(previous.current);
    else if (current < shown) setShown(current);
    previous.current = current;
  }, [current]);

  const closeHandler = useRef(onClose);
  closeHandler.current = onClose;
  useEffect(() => {
    closeRef.current?.focus();
    // En pantalla completa, Esc la cierra el navegador; un segundo Esc cierra el panel.
    // Esc corta antes la voz/subtítulo de VictorIA y la comparación; después cierra el panel.
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || document.querySelector('.modal-backdrop')) return;
      const current = voiceRef.current;
      if (current.speaking || current.caption) { current.dismiss(); return; }
      if (benchOpenRef.current) { setBenchOpen(false); return; }
      if (!document.fullscreenElement) closeHandler.current();
    };
    window.addEventListener('keydown', onKey);
    document.body.classList.add('no-scroll');
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.classList.remove('no-scroll');
    };
  }, []);

  const index = Math.min(shown, phases.length - 1);
  const phase = phases[index];
  const isCurrent = index === current;
  const closed = !isCurrent || state.status === 'complete' || phaseExpired;
  const hasAnswer = phase.options.some(option => option.quality === 'best');
  const reveal = (closed || revealed.has(phase.id)) && hasAnswer;
  const tally = tallyFor(state, phase, isCurrent ? liveTally : undefined, exclude);
  const votes = tally.counts.reduce((sum, value) => sum + value, 0);
  const allDecided = tally.total > 0 && tally.decided >= tally.total;
  const last = current === phases.length - 1;
  const showJoin = !!api && state.status !== 'complete' && (joinPanel === 'shown' || (joinPanel === 'auto' && isCurrent && votes === 0 && (current === 0 || tally.total === 0)));
  const showJoinRef = useRef(showJoin);
  showJoinRef.current = showJoin;
  // Q muestra u oculta el panel «Únete» (salvo si se está escribiendo en un campo).
  useEffect(() => {
    if (!api) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'q' || ignoreKey(event)) return;
      setJoinPanel(showJoinRef.current ? 'hidden' : 'shown');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [api]);

  // V activa o desactiva la voz de VictorIA (salvo si se está escribiendo en un campo).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'v' || ignoreKey(event)) return;
      if (voiceRef.current.available) voiceRef.current.toggle();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Cambiar de situación corta la voz y retira el subtítulo.
  const firstPhase = useRef<string | null>(phase.id);
  useEffect(() => {
    if (firstPhase.current === phase.id) return;
    firstPhase.current = null;
    voiceRef.current.dismiss();
  }, [phase.id]);

  // Comentario al revelar: solo si esta vista vio la situación abierta (no al repasar situaciones antiguas) y una vez.
  const seenOpen = useRef(new Set<string>());
  const spoken = useRef(new Set<string>());
  useEffect(() => {
    if (!reveal) { if (isCurrent && state.status !== 'complete') seenOpen.current.add(phase.id); return; }
    if (!seenOpen.current.has(phase.id) || spoken.current.has(phase.id)) return;
    spoken.current.add(phase.id);
    const text = revealComment(phase, tally.counts, index);
    if (text) voiceRef.current.say(text, 'reveal');
  }, [phase.id, reveal]);

  // Al finalizar la sesión con el proyector abierto, se abre la comparación (VictorIA la comenta después).
  const previousStatus = useRef(state.status);
  useEffect(() => {
    const finished = state.status === 'complete' && previousStatus.current !== 'complete' && api && canControl;
    previousStatus.current = state.status;
    if (!finished) return;
    // Primero el comentario de la última situación: se espera a que VictorIA termine (o ~7 s de lectura si solo hay subtítulo).
    const started = Date.now();
    const timer = window.setInterval(() => {
      const current = voiceRef.current;
      const elapsed = Date.now() - started;
      const reading = current.available && current.enabled ? 1500 : 7000;
      if (elapsed < reading || (current.speaking && elapsed < 30000)) return;
      window.clearInterval(timer);
      setBenchOpen(true);
    }, 400);
    return () => window.clearInterval(timer);
  }, [state.status]);
  const hasDecisions = state.decisions.some(decision => !exclude?.has(decision.userId));
  /** Con confirmación si la página la ofrece; si no (uso aislado), el comando directo. */
  const finish = () => { if (onFinish) onFinish(); else onCommand('complete'); };

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* el navegador no lo permite: el panel sigue ocupando la ventana */ }
  }

  // El primer gesto del docente dentro del proyector desbloquea el audio (AudioContext dentro del gesto).
  return <div className="projector" role="dialog" aria-modal="true" aria-labelledby="pj-title" onPointerDownCapture={voice.unlock} onKeyDownCapture={voice.unlock}>
    <header className="pj-top">
      <div className="pj-brand"><img src={brand.logoOnDark} alt={brand.organization} height="40"/><span>{state.scenario.title}</span></div>
      <div className="pj-tools">
        <LiveBadge mode={mode} standalone={standalone}/>
        {api && state.status !== 'complete' && <button type="button" className="pj-ghost pj-join-toggle" aria-pressed={showJoin} onClick={() => setJoinPanel(showJoin ? 'hidden' : 'shown')}>{showJoin ? 'Ocultar QR' : 'Únete (QR)'}<kbd>Q</kbd></button>}
        {voice.available && <button type="button" className={`pj-ghost pj-voice-toggle ${voice.enabled ? 'on' : ''}`} aria-pressed={voice.enabled} title="VictorIA comenta en voz alta los resultados al mostrar la respuesta" onClick={voice.toggle}><i aria-hidden="true"/>Voz de VictorIA<kbd>V</kbd></button>}
        {canControl && state.status === 'active' && <button type="button" className="pj-ghost pj-control" disabled={busy} onClick={() => onCommand('pause')}>Pausar</button>}
        {canControl && state.status === 'paused' && <button type="button" className="pj-ghost pj-control" disabled={busy} onClick={() => onCommand('resume')}>Reanudar</button>}
        {canControl && state.status !== 'complete' && <button type="button" className="pj-ghost pj-control" disabled={busy} onClick={() => { voice.unlock(); finish(); }}>Finalizar</button>}
        <button type="button" className="pj-ghost" onClick={toggleFullscreen}>Pantalla completa</button>
        <button type="button" className="pj-ghost" ref={closeRef} onClick={onClose}>Salir <kbd>Esc</kbd></button>
      </div>
    </header>

    <div className="pj-body">
      <section className="pj-main" key={phase.id}>
        {showJoin && api && <div className="pj-join"><JoinShare api={api} sessionId={state.id} variant="projector" canRegenerate={canControl} onHide={() => setJoinPanel('hidden')}/></div>}
        <span className="pj-eyebrow">Situación {index + 1} de {phases.length}{closed ? ' · cerrada' : state.status === 'paused' ? ' · en pausa' : ''}</span>
        <h1 id="pj-title" className="pj-title">{phase.title}</h1>
        {/* Al revelar, el comentario de VictorIA ocupa el lugar del enunciado (no tapa opciones ni idea clave). */}
        {voice.caption && !benchOpen ? <VoiceCaption voice={voice}/> : <p className="pj-brief">{phase.briefing}</p>}
        <ol className={`pj-options ${reveal ? 'revealed' : ''}`}>
          {phase.options.map((option, i) => {
            const count = tally.counts[i] ?? 0;
            const percent = share(count, votes);
            const best = reveal && option.quality === 'best';
            return <li key={option.id} className={`pj-option ${reveal ? best ? 'best' : 'dim' : ''}`} style={{ '--i': i } as React.CSSProperties}>
              <span className="pj-letter" aria-hidden="true">{optionLetter(i)}</span>
              <div className="pj-option-body">
                <div className="pj-option-head">
                  <span className="pj-label">{option.label}{best && <em className="pj-best-tag">Mejor opción</em>}</span>
                  <span className="pj-count"><strong><CountUp value={percent} suffix=" %"/></strong><small>{plural(count, 'voto', 'votos')}</small></span>
                </div>
                <Bar value={percent} tone={best ? 'best' : reveal ? 'muted' : 'sky'}/>
              </div>
            </li>;
          })}
        </ol>
        {reveal && phase.takeaway && <aside className="pj-takeaway"><span>Idea clave</span><p>{phase.takeaway}</p></aside>}
        {!isCurrent && state.status !== 'complete' && <div className="pj-next-note">La clase ya está en la situación {current + 1}.{!canControl && <button type="button" onClick={() => setShown(current)}>Ver situación {current + 1} →</button>}</div>}
      </section>

      <aside className="pj-side">
        <ProgressRing value={tally.decided} total={tally.total} size={208} stroke={14} label={`${tally.decided} de ${tally.total} participantes han decidido`}/>
        <p className="pj-side-caption">{tally.total === 0 ? 'Esperando participantes' : allDecided ? 'Toda la clase ha decidido' : 'han decidido'}</p>
        <div className="pj-timer"><span>Tiempo</span>{isCurrent ? <Timer remainingMs={remainingMs} expired={phaseExpired} paused={state.status === 'paused'} limitSec={phase.timeLimitSec} complete={state.status === 'complete'}/> : <span className="timer idle">Cerrada</span>}</div>
        {canControl && <div className="pj-controls">
          {isCurrent && !reveal && hasAnswer && votes > 0 && <button type="button" className="pj-ghost" onClick={() => { voice.unlock(); setRevealed(current => new Set(current).add(phase.id)); }}>Mostrar respuesta</button>}
          {!isCurrent && <button type="button" className="pj-primary" onClick={() => setShown(current)}>Ver situación {current + 1} →</button>}
          {isCurrent && state.status === 'active' && !last && <button type="button" className="pj-primary" disabled={busy || votes === 0} onClick={() => { voice.unlock(); onCommand('advance'); }}>Siguiente situación →</button>}
          {isCurrent && state.status === 'active' && last && <button type="button" className="pj-primary" disabled={busy || votes === 0} onClick={() => { voice.unlock(); finish(); }}>Finalizar sesión</button>}
          {state.status === 'paused' && <button type="button" className="pj-primary" disabled={busy} onClick={() => onCommand('resume')}>Reanudar</button>}
          {isCurrent && state.status === 'active' && votes === 0 && <small>Podrás avanzar cuando haya al menos una decisión.</small>}
          {api && hasDecisions && <button type="button" className={state.status === 'complete' ? 'pj-primary' : 'pj-ghost'} aria-pressed={benchOpen} onClick={() => { voice.unlock(); setBenchOpen(open => !open); }}>{benchOpen ? 'Ocultar comparación' : 'Comparar con la media'}</button>}
        </div>}
      </aside>
    </div>

    {benchOpen && api && <BenchmarkCard api={api} state={state} exclude={exclude} voice={voice} onClose={() => setBenchOpen(false)}/>}

    <footer className="pj-steps" aria-label="Progreso de la sesión">
      {phases.map((item, i) => {
        const status = i < current || (state.status === 'complete' && i === current) ? 'done' : i === current ? 'current' : 'next';
        return <button type="button" key={item.id} className={`pj-step ${status} ${i === index ? 'shown' : ''}`} disabled={i > current} onClick={() => setShown(i)} aria-current={i === index ? 'step' : undefined}>
          <span>{i + 1}</span>{item.title}
        </button>;
      })}
    </footer>
    <p className="sr-only" aria-live="polite">{tally.decided} de {tally.total} participantes han decidido.{reveal ? ' Respuesta mostrada.' : ''}</p>
  </div>;
}

/** Subtítulo de VictorIA: insignia, onda animada mientras habla, texto y nota de transparencia. */
function VoiceCaption({ voice }: { voice: ProjectorVoice }) {
  const caption = voice.caption!;
  const wave = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!voice.speaking) { wave.current?.style.setProperty('--lv', '0'); return; }
    let frame = 0;
    const tick = () => { wave.current?.style.setProperty('--lv', voice.level().toFixed(2)); frame = requestAnimationFrame(tick); };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [voice.speaking, voice.level]);
  return <aside className={`pj-caption ${voice.speaking ? 'speaking' : ''}`} key={caption.id} aria-live="polite">
    <div className="pj-caption-head">
      <span className="pj-caption-badge">VictorIA</span>
      <span className="pj-wave" ref={wave} aria-hidden="true">{[0, 1, 2, 3, 4].map(i => <i key={i} style={{ '--w': i } as React.CSSProperties}/>)}</span>
      <button type="button" className="pj-caption-close" onClick={voice.dismiss} aria-label="Cerrar comentario de VictorIA">×</button>
    </div>
    <p>{caption.text}</p>
    <small>{caption.kind === 'benchmark' ? 'Comentario automático generado a partir de los datos agregados' : 'Comentario automático generado a partir de los votos'}</small>
  </aside>;
}

/** Cifras de esta sesión con el estado en vivo (lo mismo que pinta el proyector, con la misma exclusión). */
function liveSessionRate(state: SessionState, exclude?: Set<string>) {
  let best = 0, rated = 0, decisions = 0;
  for (const decision of state.decisions) {
    if (exclude?.has(decision.userId)) continue;
    decisions += 1;
    const quality = state.scenario.phases.find(phase => phase.id === decision.phaseId)?.options.find(option => option.id === decision.optionId)?.quality;
    if (!quality) continue;
    rated += 1;
    if (quality === 'best') best += 1;
  }
  return { decisions, optimalRate: rated > 0 ? Math.round((best / rated) * 1000) / 1000 : null };
}

/**
 * «Vuestra clase frente a la media». La clase se calcula con el estado en vivo (la cola puede ir unos segundos por
 * detrás); del servidor solo se usa la media de las OTRAS sesiones de la organización. Si la clase que se ve incluye
 * simulados (demo), la media también los incluye, para comparar lo mismo con lo mismo.
 */
function BenchmarkCard({ api, state, exclude, voice, onClose }: { api: Api; state: SessionState; exclude?: Set<string>; voice: ProjectorVoice; onClose: () => void }) {
  const includeSimulated = [...simulatedIds(state)].some(id => !exclude?.has(id));
  const own = liveSessionRate(state, exclude);
  const [org, setOrg] = useState<BenchmarkView['organization'] | null>(null);
  const [error, setError] = useState(false);
  const [grown, setGrown] = useState(false);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  const ownRef = useRef(own.optimalRate);
  ownRef.current = own.optimalRate;
  useEffect(() => {
    let cancelled = false;
    setError(false);
    api<BenchmarkView>(`/sessions/${encodeURIComponent(state.id)}/benchmark?includeSimulated=${includeSimulated}`)
      .then(body => {
        if (cancelled) return;
        setOrg(body.organization);
        voiceRef.current.say(benchmarkComment(ownRef.current, body.organization.optimalRate), 'benchmark', { queue: true });
      })
      .catch(() => { if (!cancelled) setError(true); });
    return () => { cancelled = true; };
  }, [state.id, includeSimulated]);
  useEffect(() => { if (!org) return; const frame = requestAnimationFrame(() => requestAnimationFrame(() => setGrown(true))); return () => cancelAnimationFrame(frame); }, [org]);
  const ownPct = own.optimalRate === null ? null : Math.round(own.optimalRate * 100);
  const orgPct = org?.optimalRate == null ? null : Math.round(org.optimalRate * 100);
  return <section className="pj-bench" role="region" aria-labelledby="pj-bench-title">
    <header>
      <span className="pj-eyebrow">Comparativa de grupo</span>
      <button type="button" className="pj-caption-close" onClick={onClose} aria-label="Cerrar comparación">×</button>
    </header>
    <h2 id="pj-bench-title">Vuestra clase frente a la media</h2>
    {error ? <p className="pj-bench-note">No se ha podido cargar la media de la organización.</p>
      : !org ? <p className="pj-bench-note">Calculando la media de la organización…</p>
      : <>
        <div className="pj-bench-row">
          <div className="pj-bench-head"><span>Vuestra clase</span><strong>{ownPct === null ? '—' : <CountUp value={ownPct} suffix=" %"/>}</strong></div>
          <Bar value={grown && ownPct !== null ? ownPct : 0} tone="best"/>
          <small>de decisiones óptimas · {plural(own.decisions, 'decisión', 'decisiones')}</small>
        </div>
        {orgPct === null
          ? <p className="pj-bench-first">Primera sesión de la organización: aún no hay media con la que comparar.</p>
          : <div className="pj-bench-row org">
            <div className="pj-bench-head"><span>Media de la organización</span><strong><CountUp value={orgPct} suffix=" %"/></strong></div>
            <Bar value={grown ? orgPct : 0} tone="muted"/>
            <small>{plural(org.sessions, 'sesión', 'sesiones')} · {plural(org.decisions, 'decisión', 'decisiones')}</small>
          </div>}
        {orgPct !== null && <p className="pj-bench-sentence">{benchmarkSentence(own.optimalRate, org.optimalRate)}</p>}
        {voice.caption?.kind === 'benchmark' && <VoiceCaption voice={voice}/>}
        <p className="pj-bench-note">Solo datos agregados de grupo{includeSimulated ? ' · incluye participantes simulados (demo)' : ''}. Se valoran las decisiones, no a las personas.</p>
      </>}
  </section>;
}
