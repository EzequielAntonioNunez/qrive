/**
 * Modo proyector: panel a pantalla completa para el aula. Muestra solo datos agregados (nunca nombres).
 * Mientras la situación está abierta no se muestra ninguna valoración; al cerrarse (avance, tiempo agotado,
 * fin de la sesión o «Mostrar respuesta») se revela la mejor opción y la idea clave, si el escenario las define.
 */
import React, { useEffect, useRef, useState } from 'react';
import type { SessionState } from '../shared/simulation';
import { brand } from './brand';
import type { LiveMode } from './live';
import { share, tallyFor } from './stats';
import type { LiveTally } from './types';
import { optionLetter, plural } from './types';
import { Bar, CountUp, LiveBadge, ProgressRing, Timer } from './ui';

type Props = {
  state: SessionState; liveTally?: LiveTally; remainingMs: number | null; phaseExpired: boolean; mode: LiveMode; standalone: boolean;
  canControl: boolean; busy: boolean; exclude?: Set<string>;
  onClose: () => void; onCommand: (type: 'advance' | 'complete' | 'pause' | 'resume') => void;
};

export function ProjectorView({ state, liveTally, remainingMs, phaseExpired, mode, standalone, canControl, busy, exclude, onClose, onCommand }: Props) {
  const phases = state.scenario.phases;
  const current = state.phaseIndex;
  const [shown, setShown] = useState(current);
  const [revealed, setRevealed] = useState<Set<string>>(() => new Set());
  const previous = useRef(current);
  const closeRef = useRef<HTMLButtonElement>(null);

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
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && !document.fullscreenElement) closeHandler.current(); };
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

  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch { /* el navegador no lo permite: el panel sigue ocupando la ventana */ }
  }

  return <div className="projector" role="dialog" aria-modal="true" aria-labelledby="pj-title">
    <header className="pj-top">
      <div className="pj-brand"><img src={brand.logoOnDark} alt={brand.organization} height="40"/><span>{state.scenario.title}</span></div>
      <div className="pj-tools">
        <LiveBadge mode={mode} standalone={standalone}/>
        <button type="button" className="pj-ghost" onClick={toggleFullscreen}>Pantalla completa</button>
        <button type="button" className="pj-ghost" ref={closeRef} onClick={onClose}>Salir <kbd>Esc</kbd></button>
      </div>
    </header>

    <div className="pj-body">
      <section className="pj-main" key={phase.id}>
        <span className="pj-eyebrow">Situación {index + 1} de {phases.length}{closed ? ' · cerrada' : state.status === 'paused' ? ' · en pausa' : ''}</span>
        <h1 id="pj-title" className="pj-title">{phase.title}</h1>
        <p className="pj-brief">{phase.briefing}</p>
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
        {!isCurrent && state.status !== 'complete' && <div className="pj-next-note">La clase ya está en la situación {current + 1}.<button type="button" onClick={() => setShown(current)}>Ver situación {current + 1} →</button></div>}
      </section>

      <aside className="pj-side">
        <ProgressRing value={tally.decided} total={tally.total} size={208} stroke={14} label={`${tally.decided} de ${tally.total} participantes han decidido`}/>
        <p className="pj-side-caption">{tally.total === 0 ? 'Esperando participantes' : allDecided ? 'Toda la clase ha decidido' : 'han decidido'}</p>
        <div className="pj-timer"><span>Tiempo</span>{isCurrent ? <Timer remainingMs={remainingMs} expired={phaseExpired} paused={state.status === 'paused'} limitSec={phase.timeLimitSec} complete={state.status === 'complete'}/> : <span className="timer idle">Cerrada</span>}</div>
        {canControl && <div className="pj-controls">
          {isCurrent && !reveal && hasAnswer && votes > 0 && <button type="button" className="pj-ghost" onClick={() => setRevealed(current => new Set(current).add(phase.id))}>Mostrar respuesta</button>}
          {!isCurrent && <button type="button" className="pj-primary" onClick={() => setShown(current)}>Ver situación {current + 1} →</button>}
          {isCurrent && state.status === 'active' && !last && <button type="button" className="pj-primary" disabled={busy || votes === 0} onClick={() => onCommand('advance')}>Siguiente situación →</button>}
          {isCurrent && state.status === 'active' && last && <button type="button" className="pj-primary" disabled={busy || votes === 0} onClick={() => onCommand('complete')}>Finalizar sesión</button>}
          {state.status === 'paused' && <button type="button" className="pj-primary" disabled={busy} onClick={() => onCommand('resume')}>Reanudar</button>}
          {isCurrent && state.status === 'active' && votes === 0 && <small>Podrás avanzar cuando haya al menos una decisión.</small>}
        </div>}
      </aside>
    </div>

    <footer className="pj-steps" aria-label="Progreso de la sesión">
      {phases.map((item, i) => {
        const status = state.status === 'complete' || i < current ? 'done' : i === current ? 'current' : 'next';
        return <button type="button" key={item.id} className={`pj-step ${status} ${i === index ? 'shown' : ''}`} disabled={i > current} onClick={() => setShown(i)} aria-current={i === index ? 'step' : undefined}>
          <span>{i + 1}</span>{item.title}
        </button>;
      })}
    </footer>
    <p className="sr-only" aria-live="polite">{tally.decided} de {tally.total} participantes han decidido.{reveal ? ' Respuesta mostrada.' : ''}</p>
  </div>;
}
