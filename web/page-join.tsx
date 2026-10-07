/**
 * /unirse y /unirse/:pin: unión pública a una sesión con el código de seis cifras y un alias. No pide correo ni
 * contraseña; el servidor crea una identidad de invitado (cookie) y la une a la sesión.
 */
import React, { useEffect, useRef, useState } from 'react';
import { brand } from './brand';
import { guestApi, meId, rememberAlias, rememberedAlias, type GuestError, type GuestMe, type JoinInfo, type JoinResult } from './guest';
import { navigate } from './router';
import { errorText } from './types';
import './play.css';

const DIGITS = 6;

export function JoinPage({ pin: initialPin }: { pin: string | null }) {
  const [digits, setDigits] = useState<string[]>(() => (initialPin ?? '').padEnd(DIGITS, ' ').slice(0, DIGITS).split('').map(d => d.trim()));
  const [info, setInfo] = useState<JoinInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [pinError, setPinError] = useState('');
  const [alias, setAlias] = useState(rememberedAlias);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [resume, setResume] = useState<{ sessionId: string; name: string } | null>(null);
  const inputs = useRef<(HTMLInputElement | null)[]>([]);
  const aliasRef = useRef<HTMLInputElement>(null);
  const pin = digits.join('');
  const complete = /^\d{6}$/.test(pin);

  useEffect(() => { document.title = `Unirse · ${brand.product} · ${brand.shortName}`; }, []);
  // Si este móvil ya está dentro de una sesión como invitado, se ofrece volver a ella.
  useEffect(() => {
    guestApi<GuestMe>('/me').then(me => { if (me.guest && me.sessionId && meId(me)) setResume({ sessionId: me.sessionId, name: me.name ?? '' }); }).catch(() => undefined);
  }, []);
  useEffect(() => { if (!initialPin) inputs.current[0]?.focus(); }, [initialPin]);

  // Con las seis cifras, se comprueba el código y se muestra el título de la sesión.
  useEffect(() => {
    setInfo(null); setPinError('');
    if (!complete) return;
    let alive = true;
    setChecking(true);
    guestApi<JoinInfo>(`/join/${pin}`)
      .then(result => {
        if (!alive) return;
        if (result.status === 'complete') { setPinError('Esta sesión ya ha terminado. Pide el código de la sesión actual.'); return; }
        setInfo(result);
        if (window.location.pathname !== `/unirse/${pin}`) navigate(`/unirse/${pin}`, { replace: true });
        window.setTimeout(() => aliasRef.current?.focus(), 60);
      })
      .catch(cause => { if (alive) setPinError((cause as GuestError).status === 404 ? 'Ese código no corresponde a ninguna sesión abierta. Revísalo en la pantalla del aula.' : (cause as GuestError).status === 429 ? errorText(cause) : `No se ha podido comprobar el código: ${errorText(cause)}`); })
      .finally(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [pin, complete]);

  function setDigit(index: number, raw: string) {
    const clean = raw.replace(/\D/g, '');
    if (clean.length > 1) { fill(index, clean); return; }
    setDigits(current => { const next = [...current]; next[index] = clean; return next; });
    if (clean && index < DIGITS - 1) inputs.current[index + 1]?.focus();
  }
  function fill(from: number, text: string) {
    const clean = text.replace(/\D/g, '').slice(0, DIGITS - from);
    setDigits(current => { const next = [...current]; clean.split('').forEach((d, i) => { next[from + i] = d; }); return next; });
    inputs.current[Math.min(DIGITS - 1, from + clean.length)]?.focus();
  }
  function onKey(index: number, event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) { event.preventDefault(); setDigits(current => { const next = [...current]; next[index - 1] = ''; return next; }); inputs.current[index - 1]?.focus(); }
    else if (event.key === 'ArrowLeft' && index > 0) inputs.current[index - 1]?.focus();
    else if (event.key === 'ArrowRight' && index < DIGITS - 1) inputs.current[index + 1]?.focus();
  }

  const aliasClean = alias.trim().replace(/\s+/g, ' ');
  const aliasValid = aliasClean.length >= 2 && aliasClean.length <= 30;
  async function join(event: React.FormEvent) {
    event.preventDefault();
    if (!complete || !aliasValid || joining) return;
    setJoining(true); setJoinError('');
    try {
      const result = await guestApi<JoinResult>('/join', { method: 'POST', body: JSON.stringify({ pin, alias: aliasClean }) });
      rememberAlias(aliasClean);
      navigate(`/jugar/${encodeURIComponent(result.sessionId)}`);
    } catch (cause) {
      const status = (cause as GuestError).status;
      setJoinError(status === 404 ? 'El código ya no es válido. Revísalo en la pantalla del aula.' : errorText(cause) || 'Demasiados intentos. Espera unos minutos.');
    } finally { setJoining(false); }
  }

  return <div className="play-root join-root">
    <header className="play-top"><img src={brand.logoOnDark} alt={brand.organization} height="28"/><span className="play-top-product">{brand.product}</span></header>
    <main className="join-main">
      <div className="join-card enter">
        <span className="play-eyebrow">Únete a la sesión</span>
        <h1 className="join-title">{info ? (info.sessionName || info.scenarioTitle) : 'Introduce el código'}</h1>
        {info ? <p className="join-lead">{info.sessionName ? <>{info.scenarioTitle}. </> : null}Elige cómo quieres aparecer. En la pantalla del aula solo se ven los totales de la clase, nunca tu alias junto a tus respuestas.</p>
          : <p className="join-lead">Escribe el código de seis cifras que aparece en la pantalla del aula.</p>}

        {resume && !info && <button type="button" className="join-resume" onClick={() => navigate(`/jugar/${encodeURIComponent(resume.sessionId)}`)}>Volver a tu sesión{resume.name ? ` como «${resume.name}»` : ''} →</button>}

        <div className={`pin-inputs ${pinError ? 'invalid' : ''} ${info ? 'valid' : ''}`} role="group" aria-label="Código de la sesión" onPaste={event => { event.preventDefault(); fill(0, event.clipboardData.getData('text')); }}>
          {digits.map((digit, i) => <input key={i} ref={element => { inputs.current[i] = element; }} className="pin-input" value={digit} inputMode="numeric" pattern="[0-9]*" maxLength={i === 0 ? DIGITS : 1}
            autoComplete={i === 0 ? 'one-time-code' : 'off'} aria-label={`Cifra ${i + 1} de ${DIGITS}`} aria-invalid={!!pinError}
            onChange={event => setDigit(i, event.target.value)} onKeyDown={event => onKey(i, event)} onFocus={event => event.currentTarget.select()}/>)}
        </div>
        <p className="join-status" role="status" aria-live="polite">{checking ? 'Comprobando el código…' : info ? '✓ Código correcto' : ''}</p>
        {pinError && <p className="play-error" role="alert">{pinError}</p>}

        {info && <form className="join-form" onSubmit={join}>
          <label className="join-label" htmlFor="alias">Tu alias</label>
          <input id="alias" ref={aliasRef} className="join-alias" value={alias} maxLength={30} autoComplete="nickname" autoCapitalize="words" enterKeyHint="go" placeholder="Por ejemplo, Marta o Mesa 3"
            onChange={event => setAlias(event.target.value)} aria-describedby="alias-hint"/>
          <small id="alias-hint" className="join-hint">Entre 2 y 30 caracteres. No uses datos personales que no quieras compartir.</small>
          {joinError && <p className="play-error" role="alert">{joinError}</p>}
          <button className="play-primary" disabled={!aliasValid || joining}>{joining ? 'Entrando…' : 'Entrar'}</button>
        </form>}
      </div>
      <p className="join-foot">{brand.organization} · Simulación formativa. Se valoran las decisiones, nunca a las personas.</p>
    </main>
  </div>;
}
