/** Piezas de interfaz reutilizables: esqueletos, cifras animadas, barras, anillo de progreso, avisos y estado en directo. */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { LiveMode } from './live';
import { formatClock } from './types';

/** Línea o bloque de carga con el tamaño final del elemento al que sustituye (evita saltos de maquetación). */
export function Sk({ w = '100%', h = 12, r, className = '', inline = false }: { w?: number | string; h?: number | string; r?: number; className?: string; inline?: boolean }) {
  const style: React.CSSProperties = { width: w, height: h };
  if (r !== undefined) style.borderRadius = r;
  return <span className={`sk ${inline ? 'sk-inline' : ''} ${className}`} style={style} aria-hidden="true"/>;
}

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Cuenta animada hacia el nuevo valor (ease-out). Sin animación si el usuario la ha reducido. */
export function useCountUp(value: number, duration = 650): number {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const start = from.current;
    if (start === value || prefersReducedMotion()) { from.current = value; setShown(value); return; }
    let frame = 0;
    const began = performance.now();
    const step = (time: number) => {
      const t = Math.min(1, (time - began) / duration);
      const eased = 1 - (1 - t) ** 3;
      const current = start + (value - start) * eased;
      from.current = current;
      setShown(current);
      if (t < 1) frame = requestAnimationFrame(step);
      else from.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  return shown;
}

export function CountUp({ value, suffix = '', decimals = 0 }: { value: number; suffix?: string; decimals?: number }) {
  const shown = useCountUp(value);
  return <>{shown.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}{suffix}</>;
}

/** Barra horizontal con anchura animada por CSS. */
export function Bar({ value, tone = 'navy', label }: { value: number; tone?: 'navy' | 'sky' | 'danger' | 'muted' | 'best'; label?: string }) {
  const width = `${Math.max(0, Math.min(100, value))}%`;
  return <span className={`bar bar-${tone}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}><i style={{ width }}/></span>;
}

/** Anillo de progreso (decididos / total). */
export function ProgressRing({ value, total, size = 120, stroke = 10, label }: { value: number; total: number; size?: number; stroke?: number; label: string }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const ratio = total > 0 ? Math.min(1, value / total) : 0;
  return <div className="ring" role="img" aria-label={label} style={{ width: size, height: size }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle className="ring-track" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none"/>
      <circle className="ring-value" cx={size / 2} cy={size / 2} r={radius} strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - ratio)} transform={`rotate(-90 ${size / 2} ${size / 2})`}/>
    </svg>
    <span className="ring-label"><strong><CountUp value={value}/></strong><small>de {total}</small></span>
  </div>;
}

export function LiveBadge({ mode, standalone }: { mode: LiveMode; standalone?: boolean }) {
  if (mode === 'idle') return null;
  const live = mode === 'live' || standalone;
  const text = live ? 'En directo' : mode === 'reconnecting' ? 'Reconectando…' : 'Actualización automática';
  const title = live ? 'Los cambios aparecen al instante.' : mode === 'reconnecting' ? 'Se ha perdido la conexión en directo. Mientras tanto, los datos se actualizan cada pocos segundos.' : 'Los datos se actualizan cada pocos segundos.';
  return <span className={`live-badge ${live ? 'on' : mode}`} title={title}><i aria-hidden="true"/>{text}</span>;
}

export function Timer({ remainingMs, expired, paused, limitSec, complete }: { remainingMs: number | null; expired: boolean; paused: boolean; limitSec?: number; complete?: boolean }) {
  if (complete) return <span className="timer idle">Finalizada</span>;
  if (!limitSec) return <span className="timer idle">Sin límite</span>;
  if (expired) return <span className="timer expired">Tiempo agotado</span>;
  if (remainingMs == null) return <span className="timer idle" title="El tiempo empieza a contar cuando se incorpora el primer participante.">{formatClock(limitSec * 1000)}</span>;
  return <span className={`timer ${paused ? 'idle' : remainingMs < 60000 ? 'urgent' : ''}`}>{formatClock(remainingMs)}{paused ? ' · en pausa' : ''}</span>;
}

/* Avisos breves (toasts) para confirmar acciones. Región aria-live educada. */
type Toast = { id: number; text: string; tone: 'ok' | 'info' | 'error' };
const ToastContext = createContext<(text: string, tone?: Toast['tone']) => void>(() => undefined);
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((text: string, tone: Toast['tone'] = 'ok') => {
    const id = next.current++;
    setToasts(current => [...current.slice(-2), { id, text, tone }]);
    window.setTimeout(() => setToasts(current => current.filter(item => item.id !== id)), tone === 'error' ? 6000 : 3800);
  }, []);
  return <ToastContext.Provider value={push}>
    {children}
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map(toast => <div key={toast.id} className={`toast ${toast.tone}`}><span aria-hidden="true">{toast.tone === 'error' ? '!' : toast.tone === 'info' ? 'i' : '✓'}</span>{toast.text}</div>)}
    </div>
  </ToastContext.Provider>;
}

/** Botón de copiar con confirmación visual y aviso. */
export function CopyButton({ text, label = 'Copiar enlace', done = 'Enlace copiado', className = '' }: { text: string; label?: string; done?: string; className?: string }) {
  const toast = useToast();
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); toast(done); window.setTimeout(() => setCopied(false), 2200); }
    catch { toast('No se ha podido copiar. Selecciona el texto y cópialo a mano.', 'error'); }
  }
  return <button type="button" className={`copy-button ${copied ? 'copied' : ''} ${className}`} onClick={copy}>{copied ? '✓ Copiado' : label}</button>;
}
