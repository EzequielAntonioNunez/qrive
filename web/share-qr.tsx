/**
 * «Únete desde el móvil»: QR, código de seis cifras y dirección corta para entrar como invitado con un alias.
 * El código lo emite el servidor (`GET /api/sessions/:id/pin`, solo docente); «Regenerar» invalida el anterior.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { Api } from './app-context';
import { qrMatrix, qrPath } from './qr';
import { errorText } from './types';
import './play.css';

export type JoinPin = { pin: string; joinUrl: string };

/** Código y enlace de unión de una sesión. `null` mientras carga; `error` si el servidor no lo ofrece. */
export function useJoinPin(api: Api, sessionId: string, enabled = true) {
  const [pin, setPin] = useState<JoinPin | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setError('');
    api<JoinPin>(`/sessions/${encodeURIComponent(sessionId)}/pin`)
      .then(result => { if (alive) setPin(withLocalUrl(result)); })
      .catch(cause => { if (!alive) return; if ((cause as { status?: number }).status === 409) setClosed(true); else setError(errorText(cause)); });
    return () => { alive = false; };
  }, [api, sessionId, enabled]);
  const regenerate = useCallback(async () => {
    setBusy(true); setError('');
    try { setPin(withLocalUrl(await api<JoinPin>(`/sessions/${encodeURIComponent(sessionId)}/pin`, { method: 'POST', body: '{}' }))); }
    catch (cause) { if ((cause as { status?: number }).status === 409) setClosed(true); else setError(errorText(cause)); }
    finally { setBusy(false); }
  }, [api, sessionId]);
  return { pin, error, busy, regenerate, closed };
}

/** El enlace se construye con el origen de la página (en local, el Worker responde con su propio puerto). */
function withLocalUrl(result: JoinPin): JoinPin { return { ...result, joinUrl: `${window.location.origin}/unirse/${result.pin}` }; }

/** «483920» → «483 920», más fácil de leer en voz alta y desde el fondo del aula. */
export function spacedPin(pin: string): string { return pin.length === 6 ? `${pin.slice(0, 3)} ${pin.slice(3)}` : pin; }

export function QrCode({ text, size = 240, label, className = '' }: { text: string; size?: number; label: string; className?: string }) {
  const { path, box } = useMemo(() => { const matrix = qrMatrix(text); return { path: qrPath(matrix, 4), box: matrix.size + 8 }; }, [text]);
  return <svg className={`qr-svg ${className}`} width={size} height={size} viewBox={`0 0 ${box} ${box}`} role="img" aria-label={label} shapeRendering="crispEdges">
    <rect width={box} height={box} fill="#fff"/>
    <path d={path} fill="#001A33"/>
  </svg>;
}

type Variant = 'projector' | 'card' | 'compact';

/**
 * Bloque de unión. `projector`: grande y oscuro para el aula; `card`: tarjeta en el detalle o el asistente;
 * `compact`: QR pequeño junto al resto de acciones.
 */
export function JoinShare({ api, sessionId, variant = 'card', canRegenerate = true, onHide }: { api: Api; sessionId: string; variant?: Variant; canRegenerate?: boolean; onHide?: () => void }) {
  const { pin, error, busy, regenerate, closed } = useJoinPin(api, sessionId);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);
  if (closed) return null;
  const qrSize = variant === 'projector' ? 300 : variant === 'card' ? 200 : 132;
  return <section className={`join-share join-share-${variant}`} aria-label="Unirse desde el móvil">
    <div className="join-share-qr">
      {pin ? <QrCode text={pin.joinUrl} size={qrSize} label={`Código QR para unirse a la sesión con el código ${spacedPin(pin.pin)}`}/>
        : <div className="qr-placeholder" style={{ width: qrSize, height: qrSize }} aria-busy={!error}>{error ? 'QR no disponible' : ''}</div>}
    </div>
    <div className="join-share-text">
      <span className="join-share-eyebrow">Únete desde el móvil</span>
      {/* Sin dirección visible: el dominio provisional no es de la UFV. El QR lleva el enlace y el docente puede copiarlo. */}
      <p className="join-share-step">Escanea el QR con la cámara del móvil e introduce un alias.</p>
      <div className="join-share-pin" aria-label={pin ? `Código ${pin.pin.split('').join(' ')}` : 'Cargando el código'}>
        {pin ? spacedPin(pin.pin).split('').map((digit, i) => digit === ' ' ? <span key={i} className="pin-gap"/> : <span key={i} className="pin-digit">{digit}</span>) : <span className="pin-loading">······</span>}
      </div>
      <p className="join-share-hint">Solo hace falta un alias: no se pide correo ni contraseña.</p>
      {error && <p className="join-share-error" role="alert">No se ha podido obtener el código: {error}</p>}
      <div className="join-share-actions">
        {canRegenerate && (confirming
          ? <><span className="join-share-confirm">¿Invalidar el código actual?</span><button type="button" className="join-share-btn danger" disabled={busy} onClick={() => { setConfirming(false); void regenerate(); }}>Sí, regenerar</button><button type="button" className="join-share-btn" onClick={() => setConfirming(false)}>Cancelar</button></>
          : <button type="button" className="join-share-btn" disabled={busy || (!pin && !error)} onClick={() => setConfirming(true)}>{busy ? 'Generando…' : 'Regenerar código'}</button>)}
        {pin && variant !== 'projector' && <button type="button" className="join-share-btn" onClick={() => { void navigator.clipboard?.writeText(pin.joinUrl).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1800); }).catch(() => undefined); }}>{copied ? '✓ Enlace copiado' : 'Copiar enlace de unión'}</button>}
        {onHide && <button type="button" className="join-share-btn" onClick={onHide}>Ocultar <kbd>Q</kbd></button>}
      </div>
    </div>
  </section>;
}
