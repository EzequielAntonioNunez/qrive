import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultScenario, meterLabels, type MeterName, type Phase, type SessionState, type SimEvent } from '../shared/simulation';
import { brand } from './brand';
import './style.css';
import './polish.css';
import { installStandaloneApi } from './standalone';
import { useLiveSession } from './live';
import { ProjectorView } from './projector';
import { ImpactReport } from './report';
import { classReport, share, simulatedIds, tallyFor, withoutParticipants, type Tally } from './stats';
import {
  METERS, actorLabel, errorText, eventLabel, formatClock, optionLetter, pct, plural, qualityLabel, roleLabel, shortDate, signed, statusLabel,
  type CodeSummary, type CodeUse, type Identity, type Member, type ParticipantResult, type Person, type Report, type Role, type ScenarioSummary,
  type SessionPayload, type SessionSummary, type TimelineEntry
} from './types';
import { Bar, CopyButton, CountUp, LiveBadge, Sk, Timer, ToastProvider, useToast } from './ui';

const standalone = import.meta.env.VITE_STANDALONE === '1';
if (standalone) installStandaloneApi();

type View = 'console' | 'directo' | 'informe';
type ApiError = Error & { status?: number };

/** Efectos de un incidente sobre el indicador de riesgo que puede elegir el docente. */
const INCIDENT_DELTAS = [-10, -5, 5, 10, 15] as const;
/** Tamaño de la clase simulada para demostraciones. */
const DEMO_CLASS_SIZE = 20;

function initialParam(name: string): string | null {
  try { return new URLSearchParams(window.location.search).get(name); } catch { return null; }
}

function App() {
  const toast = useToast();
  const [demoUser, setDemoUser] = useState<Role>('instructor');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [demo, setDemo] = useState(false);
  const [timersOn, setTimersOn] = useState(true);
  const [realtime, setRealtime] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(() => initialParam('sesion'));
  const [view, setView] = useState<View>(() => { const vista = initialParam('vista'); return vista === 'directo' || vista === 'informe' ? vista : 'console'; });
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [incident, setIncident] = useState('');
  const [incidentDelta, setIncidentDelta] = useState<number>(5);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | null>(null);
  const [scenarioId, setScenarioId] = useState(defaultScenario.id);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [meter, setMeter] = useState<MeterName>('relationship');
  const [meterValue, setMeterValue] = useState(50);
  const [authRequired, setAuthRequired] = useState<boolean | null>(standalone ? false : null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [memberRole, setMemberRole] = useState<Role>('participant');
  const [codes, setCodes] = useState<CodeSummary[]>([]);
  const [codeUses, setCodeUses] = useState<CodeUse[]>([]);
  const [issued, setIssued] = useState<{ code: string; name: string } | null>(null);
  const [canAssignInstructor, setCanAssignInstructor] = useState(false);
  const [excludeSimulated, setExcludeSimulated] = useState(false);
  const [demoClassBusy, setDemoClassBusy] = useState(false);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-demo-user': demoUser, ...init?.headers } });
    let body: T & { error?: string };
    try { const text = await response.text(); body = (text ? JSON.parse(text) : {}) as T & { error?: string }; }
    catch { body = {} as T & { error?: string }; }
    if (!response.ok) throw Object.assign(new Error(body.error ?? `Error ${response.status}`), { status: response.status });
    return body;
  }, [demoUser]);

  const fetchSession = useCallback((id: string) => api<SessionPayload>(`/sessions/${encodeURIComponent(id)}`), [api]);
  const onSessionError = useCallback((cause: unknown) => {
    const status = (cause as ApiError).status;
    if (status === 404 || status === 403) { setSelected(null); setView('console'); toast('La sesión ya no está disponible.', 'info'); }
    else if (status === 401 && !standalone) { setAuthRequired(true); setIdentity(null); }
    else setLoadError(`No se ha podido actualizar la sesión (${errorText(cause)}). Se reintentará automáticamente.`);
  }, [toast]);
  const closeProjector = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setView('console');
  }, []);
  const onSessionGone = useCallback(() => { setSelected(null); setView('console'); toast('Esta sesión se ha eliminado.', 'info'); }, [toast]);
  // WebSocket solo si el servidor lo anuncia (flag `realtime_websocket`). En modo local como participante se consulta
  // por HTTP: el socket no puede llevar la cabecera de identidad demo.
  const socket = realtime && !standalone && !(demo && demoUser === 'participant');
  const live = useLiveSession<SessionPayload>(selected, { fetchSession, socket, onError: onSessionError, onGone: onSessionGone });
  const payload = live.data;

  const refresh = useCallback(async () => {
    try {
      const [who, listing] = await Promise.all([api<{ identity: Identity; demo: boolean; flags?: { phase_timers?: boolean; realtime_websocket?: boolean }; permissions?: { assignInstructor?: boolean } }>('/me'), api<{ sessions: SessionSummary[] }>('/sessions')]);
      setRealtime(who.flags?.realtime_websocket === true);
      setIdentity(who.identity);
      setCanAssignInstructor(who.permissions?.assignInstructor === true);
      setAuthRequired(false);
      setDemo(who.demo);
      setTimersOn(who.flags?.phase_timers !== false);
      setSessions(listing.sessions);
      setLoadError('');
    } catch (cause) {
      if ((cause as ApiError).status === 401 && !standalone) { setAuthRequired(true); setIdentity(null); setLoadError(''); }
      else setLoadError(`No hay conexión con el servidor (${errorText(cause)}). Se reintentará automáticamente.`);
    }
  }, [api]);

  // La lista de sesiones se consulta con menos frecuencia cuando la sesión abierta llega en directo.
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), live.mode === 'live' ? 10000 : 2500); return () => window.clearInterval(timer); }, [refresh, live.mode]);
  useEffect(() => { setError(''); setConfirmDelete(false); setExcludeSimulated(false); }, [demoUser, selected]);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(tick); }, []);
  useEffect(() => {
    if (!identity) return;
    void api<{ scenarios: ScenarioSummary[] }>('/scenarios').then(result => setScenarios(result.scenarios)).catch(cause => setError(`No se han podido cargar las situaciones: ${errorText(cause)}`));
  }, [api, identity?.id]);
  useEffect(() => {
    if (identity?.role !== 'instructor') { setMembers([]); return; }
    void api<{ members: Member[] }>('/memberships').then(result => setMembers(result.members)).catch(cause => setError(`No se han podido cargar las personas: ${errorText(cause)}`));
    if (!standalone) void loadCodeAudit().catch(() => undefined);
  }, [api, identity?.role]);
  // La URL refleja la sesión y la vista para poder recargar o compartir con el propio docente.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (selected) params.set('sesion', selected); else params.delete('sesion');
    if (selected && view !== 'console') params.set('vista', view); else params.delete('vista');
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }, [selected, view]);

  async function loadCodeAudit() {
    const result = await api<{ codes: CodeSummary[]; uses: CodeUse[] }>('/access-codes');
    setCodes(result.codes); setCodeUses(result.uses);
  }

  async function login(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setLoginError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email: loginEmail, code: loginCode }) });
      setLoginCode(''); setAuthRequired(false); await refresh();
      const next = new URLSearchParams(window.location.search).get('next');
      if (next?.startsWith('/simulador/') && !next.startsWith('//')) window.location.assign(next);
    } catch (cause) {
      const status = (cause as ApiError).status;
      setLoginError(status === 429 ? 'Demasiados intentos. Espera unos minutos y vuelve a probar.' : status === 401 || status === 400 ? 'El correo o el código no son correctos. Revisa los datos o pide un código nuevo a tu docente.' : errorText(cause));
    }
    finally { setBusy(false); }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined);
    setIdentity(null); setAuthRequired(true); setSelected(null); setIssued(null);
  }

  async function generateCode(member: Member) {
    setBusy(true); setError('');
    try {
      const result = await api<{ code: string }>(`/access-codes/${member.id}`, { method: 'POST', body: '{}' });
      setIssued({ code: result.code, name: member.name });
      await loadCodeAudit();
    } catch (cause) { setError(`No se ha podido generar el código: ${errorText(cause)}`); } finally { setBusy(false); }
  }

  async function revokeCode(member: Member) {
    setBusy(true); setError('');
    try {
      await api(`/access-codes/${member.id}`, { method: 'DELETE' });
      setIssued(null); await loadCodeAudit();
      toast(`Código de ${member.name} revocado`);
    } catch (cause) { setError(`No se ha podido revocar el código: ${errorText(cause)}`); } finally { setBusy(false); }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api<{ member: Member }>('/memberships', { method: 'POST', body: JSON.stringify({ name: memberName, email: memberEmail, role: memberRole }) });
      setMembers(current => [...(current ?? []).filter(person => person.id !== result.member.id), result.member].sort((a, b) => a.name.localeCompare(b.name)));
      setMemberName(''); setMemberEmail(''); setMemberRole('participant');
      toast(`${result.member.name} añadido. Genera su código para darle acceso.`);
    } catch (cause) { setError(`No se ha podido añadir a la persona: ${errorText(cause)}`); } finally { setBusy(false); }
  }

  async function create() {
    setBusy(true); setError('');
    try {
      const result = await api<SessionPayload>('/sessions', { method: 'POST', body: JSON.stringify({ scenarioId }) });
      setSelected(result.state.id); setView('console');
      live.replace(result);
      toast('Sesión creada. Comparte el enlace con tu grupo.');
      await refresh();
    } catch (cause) { setError(`No se ha podido crear la sesión: ${errorText(cause)}`); } finally { setBusy(false); }
  }

  async function exportSession() {
    if (!selected || !payload) return;
    try {
      const data = await api<unknown>(`/sessions/${selected}/export`);
      download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${exportBaseName(payload.state)}.json`);
      toast('Exportación descargada');
    } catch (cause) { setError(`No se ha podido exportar: ${errorText(cause)}`); }
  }

  async function deleteSession() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await api(`/sessions/${selected}`, { method: 'DELETE' });
      setSelected(null); setConfirmDelete(false);
      toast('Sesión eliminada');
      await refresh();
    } catch (cause) { setError(`No se ha podido eliminar la sesión: ${errorText(cause)}`); } finally { setBusy(false); }
  }

  const commandToast: Record<string, string> = { advance: 'Nueva situación abierta', pause: 'Sesión en pausa', resume: 'Sesión reanudada', complete: 'Sesión finalizada. El informe ya está disponible.', incident: 'Incidente lanzado a la clase', 'set-meter': 'Indicador ajustado', join: 'Te has unido a la sesión', decide: 'Decisión registrada' };
  async function command(type: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const result = await api<SessionPayload>(`/sessions/${selected}/commands`, { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), type, ...extra }) });
      live.replace(result);
      if (type === 'incident') setIncident('');
      if (commandToast[type]) toast(commandToast[type]);
    } catch (cause) { setError(errorText(cause)); toast(errorText(cause), 'error'); } finally { setBusy(false); }
  }

  async function demoClass(add: boolean) {
    if (!selected) return;
    setDemoClassBusy(true);
    try {
      const result = await api<Partial<SessionPayload> & { demoClass?: { added?: number; removed?: number; total?: number } }>(`/sessions/${selected}/demo-class`, add ? { method: 'POST', body: JSON.stringify({ count: DEMO_CLASS_SIZE }) } : { method: 'DELETE' });
      if (result.state && result.report) live.replace(result as SessionPayload); else await live.reload();
      const added = result.demoClass?.added ?? DEMO_CLASS_SIZE;
      const removed = result.demoClass?.removed;
      toast(add ? `${plural(added, 'participante simulado incorporado', 'participantes simulados incorporados')}. Irán decidiendo en los próximos segundos.` : removed != null ? `${plural(removed, 'participante simulado retirado', 'participantes simulados retirados')}` : 'Participantes simulados retirados');
    } catch (cause) {
      const status = (cause as ApiError).status;
      if (status === 404 || status === 405 || status === 501) toast('«Simular clase» aún no está disponible en este servidor.', 'info');
      else toast(`No se ha podido ${add ? 'simular la clase' : 'retirar la clase simulada'}: ${errorText(cause)}`, 'error');
    } finally { setDemoClassBusy(false); }
  }

  function openProjector() {
    setView('directo');
    if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined);
  }

  const state = payload?.state;
  const serverReport = payload?.report;
  const isInstructor = identity?.role === 'instructor';
  const simIds = useMemo(() => state && isInstructor ? simulatedIds(state) : new Set<string>(), [state, isInstructor]);
  const excluded = excludeSimulated && simIds.size > 0 ? simIds : undefined;
  // Con «Excluir simulados», el informe de la clase se recalcula en el navegador con el mismo motor.
  const statsState = useMemo(() => state && excluded ? withoutParticipants(state, excluded) : state, [state, excluded]);
  const report = useMemo<Report | undefined>(() => {
    if (!statsState || !serverReport) return serverReport;
    if (excluded || (isInstructor && simIds.size > 0)) return classReport(statsState);
    return serverReport;
  }, [statsState, serverReport, excluded, isInstructor, simIds]);

  const phase = state?.scenario.phases[state.phaseIndex];
  const hasJoined = state?.participants.some(person => person.userId === identity?.id);
  const myDecision = state?.decisions.find(decision => decision.userId === identity?.id && decision.phaseId === phase?.id);
  const remainingMs = state?.phaseDeadline ? Math.max(0, Date.parse(state.phaseDeadline) - now) : state?.phaseRemainingMs ?? null;
  const phaseExpired = !!phase && !!state?.events.some(event => event.type === 'timer_expired' && event.detail.phaseId === phase.id);
  const unitySeen = payload?.clients?.unity ? Date.parse(payload.clients.unity) : null;
  const unityOnline = unitySeen !== null && now - unitySeen < 6000;
  const canControl = isInstructor && identity?.id === state?.instructorId;
  const simulatorLink = state ? simulatorUrl(state.id, demo) : '';
  const labels = state ? meterLabels(state.scenario) : null;
  const selectedScenario = scenarios?.find(item => item.id === scenarioId);
  const characterName = state?.scenario.character?.name || 'VictorIA';
  const participantResults = report ? participantResultsOf(report) : [];
  const tally: Tally = state && statsState ? tallyFor(statsState, phase, excluded ? undefined : payload?.liveTally, undefined) : { counts: [], decided: 0, total: 0 };
  const phaseVotes = state ? state.decisions.filter(decision => decision.phaseId === phase?.id).length : 0;
  const lastPhase = !!state && state.phaseIndex === state.scenario.phases.length - 1;
  const showReport = view === 'informe' && !!state && !!report && isInstructor;
  const showProjector = view === 'directo' && !!state && isInstructor;
  const simCount = simIds.size;

  // Título del documento: da nombre al PDF del informe y a la pestaña.
  useEffect(() => {
    const base = `${brand.product} · ${brand.shortName}`;
    document.title = showReport && state ? `Informe de impacto · ${state.scenario.title} · ${brand.shortName}` : state ? `${state.scenario.title} · ${base}` : base;
  }, [showReport, state?.scenario.title]);

  if (authRequired === null) return <div className="auth-screen"><div className="auth-card" aria-busy="true"><img src={brand.logoOnDark} alt={brand.organization}/><Sk w={120} h={10}/><Sk w="80%" h={34} className="sk-gap"/><Sk w="100%" h={12} className="sk-gap"/><Sk w="70%" h={12}/><p className="sr-only" role="status">Comprobando tu acceso…</p></div></div>;
  if (authRequired) return <div className="auth-screen"><div className="auth-card enter"><img src={brand.logoOnDark} alt={brand.organization}/><span className="eyebrow">{brand.product}</span><h1>Accede con tu código</h1><p>Introduce tu correo institucional y el código personal de seis cifras que te ha dado tu docente.</p><form onSubmit={login}><label>Correo electrónico<input type="email" autoComplete="username" value={loginEmail} onChange={event => setLoginEmail(event.target.value)} required/></label><label>Código de acceso<input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={loginCode} onChange={event => setLoginCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required aria-describedby="code-hint"/></label>{loginError && <p className="error" role="alert">{loginError}</p>}<button className="primary" disabled={busy || loginCode.length !== 6}>{busy ? 'Comprobando…' : 'Entrar'}</button></form><small id="code-hint">El código es personal e intransferible. Si lo has perdido, pide uno nuevo a tu docente.</small></div></div>;

  return <div className={`app ${showReport ? 'printing-report' : ''}`}>
    <aside className="sidebar">
      <div className="brand"><img src={brand.logoOnDark} alt={brand.organization} height="34"/><small>{brand.product}</small></div>
      <button className={`sidebar-home ${!selected ? 'active' : ''}`} onClick={() => { setSelected(null); setView('console'); }}>{isInstructor ? 'Inicio y accesos' : 'Inicio'}</button>
      {demo && <div className="role-switch"><span className="eyebrow">{standalone ? 'Ver como' : 'Modo local'}</span><div className="switch-row" role="group" aria-label="Ver la consola como"><button aria-pressed={demoUser === 'instructor'} className={demoUser === 'instructor' ? 'selected' : ''} onClick={() => setDemoUser('instructor')}>Docente</button><button aria-pressed={demoUser === 'participant'} className={demoUser === 'participant' ? 'selected' : ''} onClick={() => setDemoUser('participant')}>Participante</button></div></div>}
      <nav className="sidebar-section sessions" aria-label="Sesiones"><div className="section-heading"><span className="eyebrow">Sesiones</span>{isInstructor && <button className="text-button" onClick={() => { setSelected(null); setView('console'); }}>+ Nueva sesión</button>}</div>
        {sessions === null ? [0, 1, 2].map(i => <div className="session-link sk-row" key={i} aria-hidden="true"><Sk w="85%" h={12} className="sk-dark"/><Sk w="55%" h={10} className="sk-dark sk-gap-s"/></div>)
          : sessions.length === 0 ? <p className="sidebar-empty">{isInstructor ? 'Aún no hay sesiones. Crea la primera desde Inicio.' : 'Aquí aparecerán las sesiones a las que te unas.'}</p>
          : sessions.map((item, i) => <button key={item.id} className={`session-link stagger ${selected === item.id ? 'active' : ''}`} style={{ '--i': Math.min(i, 8) } as React.CSSProperties} onClick={() => { setSelected(item.id); setView('console'); }} aria-current={selected === item.id ? 'page' : undefined}><strong>{scenarios?.find(scenario => scenario.id === item.scenarioId)?.title ?? 'Simulación'}</strong><small><span className={`dot ${item.status}`} aria-hidden="true"/>{statusLabel(item.status)} · {shortDate(item.createdAt)}</small></button>)}
      </nav><div className="sidebar-footer">{identity ? <><strong>{identity.name}</strong><span>{roleLabel(identity.role)}</span></> : <Sk w={140} h={10} className="sk-dark"/>}{!demo && identity && <button className="text-button" onClick={logout}>Cerrar sesión</button>}</div>
    </aside>
    <main className="main" id="contenido">
      <header className="topbar"><div><span className="eyebrow">{brand.organization}</span><h1>{brand.product}</h1></div><div className="topbar-actions">{selected && <LiveBadge mode={live.mode} standalone={standalone}/>}{(standalone || demo) && <span className="environment">{standalone ? 'Demo en navegador' : 'Entorno local'}</span>}</div></header>
      {(error || loadError) && <div className="error" role="alert"><span>{error || loadError}</span>{error && <button className="text-button" onClick={() => setError('')}>Cerrar</button>}</div>}
      {showReport ? <ReportView state={statsState!} report={report!} results={participantResults} simulatedCount={simCount} excludeSimulated={!!excluded} onToggleSimulated={() => setExcludeSimulated(value => !value)} onBack={() => setView('console')}/>
      : !selected ? isInstructor || identity === null ? renderInstructorHome() : <div className="home home-participant enter"><section className="home-create"><span className="eyebrow">Tu simulación</span><h2>Entra desde el enlace de tu docente</h2><p>Abre el enlace que te haya compartido tu docente para ver cada situación y decidir cómo actuar. Las sesiones en las que participes aparecerán también en el menú lateral.</p></section></div>
      : !state || !report ? <SessionSkeleton instructor={isInstructor !== false}/>
      : <>
        <div className="overview enter"><div><span className="eyebrow">Sesión {state.id.slice(0, 8).toUpperCase()} · {shortDate(state.createdAt)}</span><h2>{state.scenario.title}</h2><p>{state.scenario.summary}</p></div><div className="overview-side"><span className={`status ${state.status}`}>{statusLabel(state.status)}</span>
          {isInstructor && <div className="overview-actions"><button type="button" className="primary" onClick={openProjector}>Proyectar en clase</button><button type="button" onClick={() => setView('informe')}>Informe de impacto</button></div>}</div></div>
        <p className="ai-notice" role="note"><span aria-hidden="true">i</span><span><strong>{characterName} es un personaje virtual.</strong> Su imagen y su voz son sintéticas y sus intervenciones están guionizadas: no es una IA conversacional. El simulador no infiere emociones ni estados psicológicos; las valoraciones se refieren a las decisiones, nunca a las personas.</span></p>

        {isInstructor && <>
          <KpiStrip state={state} report={report} tally={tally} remainingMs={remainingMs} phaseExpired={phaseExpired} timersOn={timersOn} simCount={excluded ? 0 : simCount}/>
          <PhaseSteps state={state}/>
          {canControl && <NextStep state={state} tally={tally} phaseVotes={phaseVotes} lastPhase={lastPhase} busy={busy} simulatorLink={standalone ? '' : simulatorLink} onCommand={command} onReport={() => setView('informe')} onProject={openProjector}/>}
        </>}

        <div className="grid">
          <section className="panel scene enter" aria-labelledby="phase-title"><div className="panel-top"><span className="eyebrow">Situación {state.phaseIndex + 1} de {state.scenario.phases.length}</span>{!isInstructor && <span className="phase-line" aria-hidden="true"><i style={{ width: `${((state.phaseIndex + 1) / state.scenario.phases.length) * 100}%` }}/></span>}{timersOn && <Timer remainingMs={remainingMs} expired={phaseExpired} paused={state.status === 'paused'} limitSec={phase?.timeLimitSec} complete={state.status === 'complete'}/>}</div>
            <h3 id="phase-title" key={phase?.id} className="enter">{phase?.title}</h3><p className="briefing">{phase?.briefing}</p>
            <div className="experience">
              <div className="experience-head"><span className="eyebrow">{characterName}</span>{isInstructor && !standalone && <span className={`presence ${unityOnline ? 'online' : ''}`}><i/>{unityOnline ? 'Simulador abierto' : 'Simulador sin actividad'}</span>}</div>
              {phase?.characterLine && <blockquote>«{phase.characterLine}»</blockquote>}
              {isInstructor && !standalone && state.status !== 'complete' && <div className="simulator-link"><span className="eyebrow">Enlace para participantes</span><div><input readOnly aria-label="Enlace del simulador" value={simulatorLink} onFocus={event => event.currentTarget.select()}/><CopyButton text={simulatorLink}/><a className="primary" href={simulatorLink} target="_blank" rel="noopener">Abrir simulador</a></div><small>Funciona en el navegador, sin instalar nada. Cada participante entra con su correo y su código personal.</small></div>}
            </div>

            {isInstructor && phase && <LiveDistribution phase={phase} tally={tally} closed={state.status === 'complete'}/>}

            {!isInstructor && state.status !== 'complete' && !hasJoined && <div className="join-box"><p>Únete para ver las opciones y decidir. Tu progreso es individual: tus compañeros no ven tus respuestas.</p><button className="primary" onClick={() => command('join')} disabled={busy}>{busy ? 'Uniéndote…' : 'Unirme a la sesión'}</button></div>}
            {!isInstructor && hasJoined && !myDecision && state.status === 'active' && <div className="options" role="group" aria-label="Opciones de esta situación">{phase?.options.map((option, i) => <button key={option.id} className="stagger" style={{ '--i': i } as React.CSSProperties} onClick={() => command('decide', { optionId: option.id })} disabled={busy}><span className="option-letter" aria-hidden="true">{optionLetter(i)}</span><strong>{option.label}</strong><span>Elegir</span></button>)}</div>}
            {!isInstructor && hasJoined && !myDecision && state.status === 'paused' && <div className="notice">La sesión está en pausa. Podrás decidir en cuanto tu docente la reanude.</div>}
            {!isInstructor && myDecision && state.status !== 'complete' && <div className="notice enter" role="status"><strong>Decisión registrada.</strong> {phase?.options.find(option => option.id === myDecision.optionId)?.consequence} La siguiente situación aparecerá aquí cuando tu docente la abra.</div>}

            {canControl && state.status !== 'complete' && <div className="controls"><span className="eyebrow">Control de la sesión</span>
              <div className="button-row">{state.status === 'paused' ? <button onClick={() => command('resume')} disabled={busy}>Reanudar</button> : <button onClick={() => command('pause')} disabled={busy}>Pausar</button>}{state.status === 'active' && !lastPhase && <button className="primary" onClick={() => command('advance')} disabled={busy || phaseVotes === 0} title={phaseVotes === 0 ? 'Necesitas al menos una decisión para avanzar.' : undefined}>Siguiente situación →</button>}{state.status === 'active' && lastPhase && <button className="primary" onClick={() => command('complete')} disabled={busy || phaseVotes === 0}>Finalizar sesión</button>}</div>
              <div className="demo-class"><div><strong>Simular clase</strong><small>Incorpora {DEMO_CLASS_SIZE} participantes simulados que deciden solos. Útil para demostraciones; se marcan como «Simulado».</small></div>{simCount > 0 ? <button onClick={() => demoClass(false)} disabled={demoClassBusy}>{demoClassBusy ? 'Retirando…' : 'Retirar simulados'}</button> : <button onClick={() => demoClass(true)} disabled={demoClassBusy}>{demoClassBusy ? 'Incorporando…' : `Simular clase (${DEMO_CLASS_SIZE})`}</button>}</div>
              <details className="advanced"><summary>Herramientas del docente</summary>
                <label className="field-label" htmlFor="incident-text">Lanzar un incidente</label>
                <div className="incident"><input id="incident-text" value={incident} onChange={event => setIncident(event.target.value)} maxLength={200} aria-describedby="incident-hint" placeholder="Ej.: Un estudiante pregunta si puede usar IA en el examen"/><select value={incidentDelta} onChange={event => setIncidentDelta(Number(event.target.value))} aria-label={`Efecto en ${labels?.risk ?? 'Riesgo'}`}>{INCIDENT_DELTAS.map(delta => <option key={delta} value={delta}>{labels?.risk ?? 'Riesgo'} {signed(delta)}</option>)}</select><button onClick={() => command('incident', { note: incident.trim(), riskDelta: incidentDelta })} disabled={busy || !incident.trim()}>Lanzar</button></div>
                <small className="field-hint" id="incident-hint">Afecta a toda la clase. No incluyas nombres ni datos personales.</small>
                <label className="field-label" htmlFor="meter-select">Ajustar un indicador de la clase</label>
                <div className="meter-control"><select id="meter-select" value={meter} onChange={event => { const next = event.target.value as MeterName; setMeter(next); setMeterValue(state.meters[next]); }}>{METERS.map(name => <option key={name} value={name}>{labels![name]}</option>)}</select><input type="number" min="0" max="100" step="1" aria-label="Nuevo valor" value={meterValue} onChange={event => setMeterValue(Number(event.target.value))}/><button onClick={() => command('set-meter', { meter, value: meterValue })} disabled={busy || !Number.isInteger(meterValue) || meterValue < 0 || meterValue > 100 || meterValue === state.meters[meter]}>Aplicar</button></div>
              </details>
            </div>}
            {state.status === 'complete' && <div className="notice success">{isInstructor ? 'Sesión finalizada. Revisa el debate por situación o descarga el informe de impacto.' : 'Sesión finalizada. Abajo tienes tus resultados y las ideas clave de cada situación.'}</div>}
          </section>

          <aside className="right-column">
            <section className="panel metrics enter"><div className="section-heading"><span className="eyebrow">{isInstructor ? 'Indicadores de la clase' : 'Tus indicadores'}</span>{isInstructor && <small className="muted">Media</small>}</div>
              {METERS.map(name => <Meter key={name} label={labels![name]} value={(report.meters ?? state.meters)[name]} initial={state.scenario.initialMeters[name]} danger={name === 'risk'}/>)}
            </section>
            <section className="panel report enter"><span className="eyebrow">{isInstructor ? 'Resultados de la clase' : 'Tus resultados'}</span><div className="score"><CountUp value={report.score}/><small>/100</small></div>
              <div className="report-grid"><div><strong>{pct(report.correctDecisionsPct)}</strong><span>Decisiones óptimas</span></div><div><strong>{report.criticalDecisions ?? 0}</strong><span>Decisiones críticas</span></div><div><strong>{report.objectivesMet}/{report.objectivesTotal}</strong><span>Objetivos alcanzados</span></div><div><strong>{report.decisions}</strong><span>Decisiones · {((report.avgReactionMs ?? 0) / 1000).toLocaleString('es-ES', { maximumFractionDigits: 0 })} s de media</span></div></div>
              <p>Puntuación de 0 a 100 calculada con los indicadores del escenario. Valora decisiones, no personas.</p>
              {isInstructor && <button type="button" className="secondary-button" onClick={() => setView('informe')}>Ver informe de impacto</button>}
            </section>
          </aside>
        </div>

        {isInstructor && <ParticipantsPanel state={state} phase={phase} results={participantResults} simCount={simCount} excludeSimulated={!!excluded} onToggle={() => setExcludeSimulated(value => !value)} onHome={() => { setSelected(null); setView('console'); }}/>}
        {(isInstructor || state.status === 'complete') && report.timeline.length > 0 && <Debrief state={state} report={report} instructor={isInstructor} onCsv={() => downloadCsv(state, report)} participantName={userId => state.participants.find(person => person.userId === userId)?.name ?? 'Participante'}/>}
        {isInstructor && !standalone && <section className="panel data-rights"><div><span className="eyebrow">Datos de la sesión</span><p>Exporta todo lo registrado o elimínalo de forma definitiva. La eliminación queda anotada en la auditoría.</p></div><div className="button-row">{confirmDelete ? <><button onClick={() => setConfirmDelete(false)} disabled={busy}>Cancelar</button><button className="danger-button" onClick={deleteSession} disabled={busy}>Sí, eliminar definitivamente</button></> : <><button onClick={exportSession} disabled={busy}>Exportar (JSON)</button><button onClick={() => setConfirmDelete(true)} disabled={busy}>Eliminar sesión</button></>}</div></section>}
        <EventsPanel state={state}/>
      </>}
    </main>
    {showProjector && <ProjectorView state={state!} liveTally={payload?.liveTally} remainingMs={remainingMs} phaseExpired={phaseExpired} mode={live.mode} standalone={standalone} canControl={!!canControl} busy={busy} exclude={excluded} onClose={closeProjector} onCommand={type => void command(type)}/>}
  </div>;

  function renderInstructorHome() {
    return <div className="home enter">
      <section className="home-create"><span className="eyebrow">Nueva sesión</span><h2>Prepara una simulación para tu grupo</h2><p>Elige la situación, crea la sesión y comparte el enlace. Seguirás las decisiones en directo y tendrás el informe al terminar.</p>
        {scenarios === null ? <div className="home-picker" aria-hidden="true"><Sk w={70} h={12}/><Sk w="100%" h={46} className="sk-gap-s"/></div>
          : scenarios.length > 1 && <label className="home-picker"><span>Situación de aprendizaje</span><select value={scenarioId} onChange={event => setScenarioId(event.target.value)}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
        <div className="home-preview">{scenarios === null ? <><Sk w={150} h={10}/><Sk w="70%" h={22} className="sk-gap"/><Sk w="100%" h={12} className="sk-gap"/><Sk w="85%" h={12} className="sk-gap-s"/></> : <><span className="eyebrow">{selectedScenario?.phases ?? defaultScenario.phases.length} situaciones · versión {selectedScenario?.version ?? defaultScenario.version}</span><h3>{selectedScenario?.title ?? defaultScenario.title}</h3><p>{selectedScenario?.summary ?? defaultScenario.summary}</p></>}</div>
        <button className="primary" onClick={create} disabled={busy || !scenarios?.length}>{busy ? 'Creando la sesión…' : 'Crear sesión'} <span aria-hidden="true">→</span></button>
      </section>
      <aside className="home-steps"><span className="eyebrow">Cómo funciona</span><h3>De la situación al debate</h3><ol><li><span>01</span><div><strong>Crea la sesión</strong><p>Elige la situación y obtén el enlace para tu grupo.</p></div></li><li><span>02</span><div><strong>Comparte el enlace</strong><p>Cada participante entra desde su navegador con su código personal.</p></div></li><li><span>03</span><div><strong>Proyecta y conduce</strong><p>Sigue las decisiones en directo y revela la mejor opción al cerrar cada situación.</p></div></li><li><span>04</span><div><strong>Cierra con el informe</strong><p>Descarga el informe de impacto en PDF para el debate y el seguimiento.</p></div></li></ol></aside>
      {!demo && <section className="access-management"><div className="section-heading"><div><span className="eyebrow">Accesos</span><h3>Personas y códigos</h3></div><span>Cada código es personal, se muestra una sola vez y puedes revocarlo cuando quieras.</span></div><div className="access-grid"><div><form className="member-form" onSubmit={addMember}><input aria-label="Nombre" placeholder="Nombre y apellidos" value={memberName} onChange={event => setMemberName(event.target.value)} maxLength={100} required/><input aria-label="Correo" type="email" placeholder="correo@ufv.es" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} maxLength={254} required/>{canAssignInstructor && <select aria-label="Rol" value={memberRole} onChange={event => setMemberRole(event.target.value as Role)}><option value="participant">Participante</option><option value="instructor">Docente</option></select>}<button disabled={busy}>Añadir persona</button></form>
        <div className="access-list">{members === null ? [0, 1, 2].map(i => <div className="access-person" key={i} aria-hidden="true"><div><Sk w={160} h={13}/><Sk w={230} h={10} className="sk-gap-s"/></div><Sk w={104} h={34}/></div>)
          : members.length === 0 ? <p className="empty-line">Aún no hay personas. Añade a tu primer participante con su nombre y correo.</p>
          : members.map(member => { const active = codes.find(item => item.userId === member.id); const canManage = member.role === 'participant' || canAssignInstructor; return <div className="access-person" key={member.id}><div><strong>{member.name}</strong><small>{member.email} · {roleLabel(member.role)} · {active ? plural(active.uses, 'acceso', 'accesos') : 'Sin código'}</small></div>{canManage && <div><button onClick={() => generateCode(member)} disabled={busy}>{active ? 'Nuevo código' : 'Generar código'}</button>{active && member.id !== identity?.id && <button onClick={() => revokeCode(member)} disabled={busy}>Revocar</button>}</div>}</div>; })}</div>
        {issued && <div className="issued-code enter" role="status"><span>Código de {issued.name}</span><strong>{issued.code}</strong><p>Entrégalo por un canal privado. Por seguridad, no volverá a mostrarse.</p><CopyButton text={issued.code} label="Copiar código" done="Código copiado"/><button onClick={() => setIssued(null)}>Hecho</button></div>}</div>
        <div className="access-audit"><strong>Últimos accesos</strong>{codeUses.length ? <ul>{codeUses.slice(0, 10).map((entry, index) => <li key={`${entry.codeId}-${entry.at}-${index}`}><span>{entry.name ?? 'Persona eliminada'} · {entry.outcome === 'accepted' ? 'Acceso correcto' : 'Código revocado'}</span><time>{new Date(entry.at).toLocaleString('es-ES')}</time></li>)}</ul> : <p>Todavía no se ha usado ningún código.</p>}</div></div></section>}
    </div>;
  }
}

/* ---------- Bloques de la vista del docente ---------- */

function KpiStrip({ state, report, tally, remainingMs, phaseExpired, timersOn, simCount }: { state: SessionState; report: Report; tally: Tally; remainingMs: number | null; phaseExpired: boolean; timersOn: boolean; simCount: number }) {
  const phase = state.scenario.phases[state.phaseIndex];
  const total = state.scenario.phases.length;
  const done = state.status === 'complete' ? total : state.phaseIndex;
  const decidedPct = share(tally.decided, tally.total);
  const complete = state.status === 'complete';
  const limit = phase?.timeLimitSec;
  const time = !timersOn || !limit ? { value: '—', sub: 'Sin límite de tiempo' }
    : phaseExpired ? { value: '00:00', sub: 'Tiempo agotado' }
    : remainingMs == null ? { value: formatClock(limit * 1000), sub: 'Empieza con el primer participante' }
    : { value: formatClock(remainingMs), sub: state.status === 'paused' ? 'En pausa' : `de ${formatClock(limit * 1000)} por situación` };
  return <section className="kpis" aria-label="Resumen en directo">
    <div className="kpi stagger" style={{ '--i': 0 } as React.CSSProperties}><span className="kpi-label">Participantes</span><strong className="kpi-value"><CountUp value={state.participants.length}/></strong><span className="kpi-sub">{state.participants.length === 0 ? 'Esperando al primero' : simCount ? `${plural(simCount, 'simulado', 'simulados')} incluidos` : 'en la sesión'}</span></div>
    {complete
      ? <div className="kpi stagger" style={{ '--i': 1 } as React.CSSProperties}><span className="kpi-label">Decisiones óptimas</span><strong className="kpi-value">{report.correctDecisionsPct == null ? '—' : <CountUp value={report.correctDecisionsPct} suffix=" %"/>}</strong><span className="kpi-sub">{plural(report.decisions, 'decisión', 'decisiones')} en total</span></div>
      : <div className="kpi stagger" style={{ '--i': 1 } as React.CSSProperties}><span className="kpi-label">Han decidido</span><strong className="kpi-value"><CountUp value={decidedPct} suffix=" %"/></strong><span className="kpi-sub">{tally.decided} de {tally.total} en la situación {state.phaseIndex + 1}</span><Bar value={decidedPct} tone="sky" label={`${decidedPct} % ha decidido`}/></div>}
    {complete
      ? <div className="kpi stagger" style={{ '--i': 2 } as React.CSSProperties}><span className="kpi-label">Puntuación de la clase</span><strong className="kpi-value"><CountUp value={report.score}/><small>/100</small></strong><span className="kpi-sub">Media de los indicadores</span></div>
      : <div className={`kpi stagger ${remainingMs != null && remainingMs < 60000 && !phaseExpired && state.status === 'active' ? 'urgent' : ''}`} style={{ '--i': 2 } as React.CSSProperties}><span className="kpi-label">Tiempo restante</span><strong className="kpi-value tabular">{time.value}</strong><span className="kpi-sub">{time.sub}</span></div>}
    <div className="kpi stagger" style={{ '--i': 3 } as React.CSSProperties}><span className="kpi-label">Progreso</span><strong className="kpi-value">{done}<small>/{total}</small></strong><span className="kpi-sub">{complete ? 'Todas las situaciones cerradas' : `situaciones cerradas`}</span><span className="segments" aria-hidden="true">{state.scenario.phases.map((item, i) => <i key={item.id} className={complete || i < state.phaseIndex ? 'done' : i === state.phaseIndex ? 'current' : ''}/>)}</span></div>
  </section>;
}

function PhaseSteps({ state }: { state: SessionState }) {
  const complete = state.status === 'complete';
  return <ol className="phase-steps" aria-label="Situaciones de la sesión">
    {state.scenario.phases.map((item, i) => {
      const status = complete || i < state.phaseIndex ? 'done' : i === state.phaseIndex ? 'current' : 'next';
      const votes = state.decisions.filter(decision => decision.phaseId === item.id).length;
      return <li key={item.id} className={`phase-step ${status}`} aria-current={status === 'current' ? 'step' : undefined}>
        <span className="phase-index" aria-hidden="true">{status === 'done' ? '✓' : i + 1}</span>
        <div><strong>{item.title}</strong><small>{status === 'done' ? `Cerrada · ${plural(votes, 'decisión', 'decisiones')}` : status === 'current' ? (state.status === 'paused' ? 'En pausa' : `En curso · ${plural(votes, 'decisión', 'decisiones')}`) : 'Pendiente'}</small></div>
      </li>;
    })}
  </ol>;
}

function NextStep({ state, tally, phaseVotes, lastPhase, busy, simulatorLink, onCommand, onReport, onProject }: { state: SessionState; tally: Tally; phaseVotes: number; lastPhase: boolean; busy: boolean; simulatorLink: string; onCommand: (type: string) => void; onReport: () => void; onProject: () => void }) {
  const pending = Math.max(0, tally.total - tally.decided);
  let text: string; let action: React.ReactNode = null;
  if (state.status === 'complete') { text = 'La sesión ha terminado. Comenta las ideas clave con el grupo y descarga el informe de impacto.'; action = <button className="primary" onClick={onReport}>Abrir informe</button>; }
  else if (state.status === 'paused') { text = 'La sesión está en pausa: los participantes no pueden decidir y el tiempo está detenido.'; action = <button className="primary" disabled={busy} onClick={() => onCommand('resume')}>Reanudar</button>; }
  else if (state.participants.length === 0) { text = 'Comparte el enlace con tu grupo. El tiempo de la primera situación empieza cuando se une el primer participante.'; action = simulatorLink ? <CopyButton text={simulatorLink} className="primary"/> : null; }
  else if (phaseVotes === 0) { text = `Esperando la primera decisión de ${plural(tally.total, 'participante', 'participantes')}. Proyecta el panel en directo para seguir la votación con la clase.`; action = <button className="primary" onClick={onProject}>Proyectar en clase</button>; }
  else if (pending > 0) { text = `Faltan ${plural(pending, 'participante', 'participantes')} por decidir. Puedes esperar o ${lastPhase ? 'finalizar la sesión' : 'abrir la siguiente situación'}: quien no decida conservará sus indicadores.`; }
  else { text = lastPhase ? 'Toda la clase ha decidido en la última situación. Finaliza la sesión para cerrar el informe.' : 'Toda la clase ha decidido. Comenta el resultado y abre la siguiente situación.'; action = <button className="primary" disabled={busy} onClick={() => onCommand(lastPhase ? 'complete' : 'advance')}>{lastPhase ? 'Finalizar sesión' : 'Siguiente situación →'}</button>; }
  return <div className="next-step enter" role="status" aria-live="polite"><span className="eyebrow">Siguiente paso</span><p>{text}</p>{action}</div>;
}

function LiveDistribution({ phase, tally, closed }: { phase: Phase; tally: Tally; closed: boolean }) {
  const votes = tally.counts.reduce((sum, value) => sum + value, 0);
  return <div className="distribution" aria-label="Decisiones de la situación actual">
    <div className="section-heading"><span className="eyebrow">{closed ? 'Decisiones de la última situación' : 'Decisiones en directo'}</span><small className="muted">{plural(votes, 'voto', 'votos')}</small></div>
    {phase.options.map((option, i) => {
      const count = tally.counts[i] ?? 0;
      const percent = share(count, votes);
      return <div className="dist-row" key={option.id}><span className="option-letter" aria-hidden="true">{optionLetter(i)}</span><div className="dist-body"><div className="dist-head"><span>{option.label}</span><strong><CountUp value={percent} suffix=" %"/> <small>({count})</small></strong></div><Bar value={percent} tone="sky"/></div></div>;
    })}
    {votes === 0 && <p className="empty-line">Todavía no hay decisiones. Las barras se llenarán a medida que decidan los participantes.</p>}
  </div>;
}

function ParticipantsPanel({ state, phase, results, simCount, excludeSimulated, onToggle, onHome }: { state: SessionState; phase?: Phase; results: ParticipantResult[]; simCount: number; excludeSimulated: boolean; onToggle: () => void; onHome: () => void }) {
  const people = state.participants as Person[];
  const decidedNow = new Set(state.decisions.filter(decision => decision.phaseId === phase?.id).map(decision => decision.userId));
  const resultOf = (userId: string) => results.find(row => row.userId === userId);
  return <section className="panel people enter"><div className="section-heading"><div><span className="eyebrow">Participantes</span><h3>{plural(people.length, 'persona en la sesión', 'personas en la sesión')}</h3></div>
    {simCount > 0 && <label className="toggle"><input type="checkbox" checked={excludeSimulated} onChange={onToggle}/><span aria-hidden="true"/>Excluir simulados de las estadísticas</label>}</div>
    {people.length === 0 ? <div className="empty-state"><p><strong>Aún no se ha unido nadie.</strong> Comparte el enlace para participantes que aparece en la situación. Las personas sin acceso se dan de alta en Inicio y accesos.</p><button onClick={onHome}>Gestionar accesos</button></div>
    : <div className="table-scroll"><table className="data-table"><thead><tr><th scope="col">Participante</th><th scope="col">Situación actual</th><th scope="col">Puntuación</th><th scope="col">Óptimas</th><th scope="col">Críticas</th><th scope="col">Decisiones</th></tr></thead>
      <tbody>{people.map((person, i) => { const row = resultOf(person.userId); const dimmed = excludeSimulated && person.simulated; return <tr key={person.userId} className={`stagger ${dimmed ? 'excluded' : ''}`} style={{ '--i': Math.min(i, 10) } as React.CSSProperties}>
        <th scope="row">{person.name}{person.simulated && <em className="tag-sim">Simulado</em>}</th>
        <td>{state.status === 'complete' ? <span className="state-pill done">Completó</span> : decidedNow.has(person.userId) ? <span className="state-pill done">Decidió</span> : <span className="state-pill">Pendiente</span>}</td>
        <td>{dimmed ? '—' : row?.score ?? '—'}</td><td>{dimmed ? '—' : pct(row?.correctDecisionsPct)}</td><td>{dimmed ? '—' : row?.criticalDecisions ?? '—'}</td><td>{dimmed ? '—' : row?.decisions ?? '—'}</td>
      </tr>; })}</tbody></table></div>}
  </section>;
}

/** Debriefing agrupado por situación. El docente ve cuántos eligieron cada opción; el participante, su propia decisión. */
function Debrief({ state, report, instructor, onCsv, participantName }: { state: SessionState; report: Report; instructor: boolean; onCsv: () => void; participantName: (userId: string) => string }) {
  const groups = groupByPhase(report.timeline);
  return <section className="panel debrief enter"><div className="section-heading"><div><span className="eyebrow">Debate</span><h3>Qué se decidió y por qué</h3></div>{instructor && !standalone && <button className="text-button" onClick={onCsv}>Descargar CSV</button>}</div>
    <div className="debrief-rows">{groups.map(group => {
      const phase = state.scenario.phases.find(item => item.id === group.phaseId);
      const byOption = new Map<string, TimelineEntry[]>();
      for (const entry of group.entries) byOption.set(entry.optionId, [...(byOption.get(entry.optionId) ?? []), entry]);
      const ordered = [...byOption.values()].sort((a, b) => b.length - a.length);
      return <div className="debrief-group" key={group.phaseId}>
        <h4>{phase ? `Situación ${state.scenario.phases.indexOf(phase) + 1} · ` : ''}{group.phaseTitle}</h4>
        {ordered.map(entries => { const entry = entries[0]; return <div className="debrief-row" key={entry.optionId}><div><strong>{entry.label}</strong><p>{entry.consequence}</p>{entry.rationale && <p className="rationale"><span>Por qué</span>{entry.rationale}</p>}</div>
          <div className="debrief-meta"><span className={`quality ${entry.quality ?? 'none'}`}>{qualityLabel(entry.quality)}</span><small>{instructor ? `${plural(entries.length, 'participante', 'participantes')} · ${share(entries.length, group.entries.length)} %` : `${participantName(entry.userId)} · ${(entry.durationMs / 1000).toFixed(0)} s${entry.timedOut ? ' · tras agotarse el tiempo' : ''}`}</small></div></div>; })}
        {group.takeaway && <p className="takeaway"><span>Idea clave</span>{group.takeaway}</p>}
      </div>;
    })}</div></section>;
}

function EventsPanel({ state }: { state: SessionState }) {
  return <section className="panel timeline enter"><div className="section-heading"><span className="eyebrow">Registro de actividad</span><small className="muted">{plural(state.events.length, 'evento', 'eventos')}</small></div><div className="events">{[...state.events].reverse().slice(0, 150).map((event: SimEvent) => <div className="event" key={event.seq}><span className="event-seq">{String(event.seq).padStart(2, '0')}</span><div><strong>{eventLabel(event.type)}</strong><small>{new Date(event.at).toLocaleTimeString('es-ES')} · {actorLabel(event.actorId, state)}</small></div><span>{event.type === 'incident' && typeof event.detail.note === 'string' ? event.detail.note : ''}</span></div>)}</div></section>;
}

function ReportView({ state, report, results, simulatedCount, excludeSimulated, onToggleSimulated, onBack }: { state: SessionState; report: Report; results: ParticipantResult[]; simulatedCount: number; excludeSimulated: boolean; onToggleSimulated: () => void; onBack: () => void }) {
  return <div className="report-view enter">
    <div className="report-toolbar"><button type="button" className="text-button" onClick={onBack}>← Volver a la sesión</button><div>{simulatedCount > 0 && <label className="toggle"><input type="checkbox" checked={excludeSimulated} onChange={onToggleSimulated}/><span aria-hidden="true"/>Excluir simulados</label>}<button type="button" className="primary" onClick={() => window.print()}>Descargar informe (PDF)</button></div></div>
    <p className="report-hint">En el diálogo de impresión elige «Guardar como PDF». El informe está maquetado para A4.</p>
    <ImpactReport state={state} report={report} results={results} simulatedCount={simulatedCount} excludeSimulated={excludeSimulated}/>
  </div>;
}

/* ---------- Esqueletos de carga: mismas cajas que el contenido final ---------- */

function SessionSkeleton({ instructor }: { instructor: boolean }) {
  return <div aria-busy="true" aria-label="Cargando la sesión">
    <p className="sr-only" role="status">Cargando la sesión…</p>
    <div className="overview"><div><Sk w={190} h={10}/><Sk w="min(520px, 80vw)" h={30} className="sk-gap"/><Sk w="min(640px, 85vw)" h={14} className="sk-gap"/></div><div className="overview-side"><Sk w={84} h={32}/>{instructor && <div className="overview-actions"><Sk w={150} h={40}/><Sk w={150} h={40}/></div>}</div></div>
    <div className="ai-notice"><Sk w={18} h={18} r={9}/><span className="sk-stack"><Sk w="95%" h={11}/><Sk w="70%" h={11}/></span></div>
    {instructor && <><section className="kpis">{[0, 1, 2, 3].map(i => <div className="kpi" key={i}><Sk w={90} h={10}/><Sk w={80} h={34} className="sk-gap"/><Sk w={130} h={10} className="sk-gap"/></div>)}</section>
      <ol className="phase-steps">{[0, 1, 2].map(i => <li className="phase-step" key={i}><Sk w={28} h={28} r={14}/><div className="sk-stack"><Sk w="80%" h={12}/><Sk w="50%" h={10}/></div></li>)}</ol></>}
    <div className="grid">
      <section className="panel scene"><div className="panel-top"><Sk w={140} h={10}/><Sk w={72} h={30}/></div><Sk w="75%" h={32} className="sk-title"/><div className="sk-stack sk-paragraph"><Sk w="100%" h={14}/><Sk w="96%" h={14}/><Sk w="60%" h={14}/></div><div className="experience"><Sk w={80} h={10} className="sk-dark"/><Sk w="90%" h={16} className="sk-dark sk-gap"/><Sk w="70%" h={16} className="sk-dark sk-gap-s"/></div>
        <div className="distribution">{[0, 1, 2].map(i => <div className="dist-row" key={i}><Sk w={26} h={26}/><div className="dist-body"><Sk w="60%" h={12}/><Sk w="100%" h={8} className="sk-gap-s"/></div></div>)}</div></section>
      <aside className="right-column"><section className="panel metrics"><Sk w={150} h={10}/>{[0, 1, 2].map(i => <div className="meter" key={i}><div><Sk w={110} h={12}/><Sk w={28} h={20}/></div><Sk w="100%" h={6} className="sk-gap-s"/></div>)}</section>
        <section className="panel report"><Sk w={150} h={10}/><Sk w={130} h={60} className="sk-score"/><div className="report-grid">{[0, 1, 2, 3].map(i => <div key={i}><Sk w={54} h={22}/><Sk w={110} h={10} className="sk-gap-s"/></div>)}</div></section></aside>
    </div>
  </div>;
}

/* ---------- Utilidades ---------- */

/** Enlace del simulador WebGL. En local Vite no resuelve /simulador/ a index.html, así que se enlaza el fichero. */
function simulatorUrl(sessionId: string, demo: boolean): string {
  return `${window.location.origin}/simulador/${demo ? 'index.html' : ''}?sesion=${encodeURIComponent(sessionId)}`;
}
function Meter({ label, value, initial, danger = false }: { label: string; value: number; initial: number; danger?: boolean }) {
  const delta = value - initial;
  const good = danger ? delta < 0 : delta > 0;
  return <div className="meter"><div><span>{label}{delta !== 0 && <em className={`delta ${good ? 'up' : 'down'}`} title={`Desde el valor inicial (${initial})`}>{signed(delta)}</em>}</span><strong><CountUp value={value}/></strong></div><Bar value={value} tone={danger ? 'danger' : 'navy'} label={`${label}: ${value} de 100`}/></div>;
}
/** Resultados por participante: acepta `participants` como lista o, en su defecto, `participantReports`. Sin datos, lista vacía. */
function participantResultsOf(report: Report): ParticipantResult[] {
  const list = Array.isArray(report.participants) ? report.participants : Array.isArray(report.participantReports) ? report.participantReports : [];
  return list.filter((row): row is ParticipantResult => !!row && typeof row.userId === 'string');
}
/** Agrupa el debriefing por fase (en orden de aparición) para mostrar la idea clave una vez por fase. */
function groupByPhase(timeline: TimelineEntry[]): { phaseId: string; phaseTitle: string; takeaway: string | null; entries: TimelineEntry[] }[] {
  const groups: { phaseId: string; phaseTitle: string; takeaway: string | null; entries: TimelineEntry[] }[] = [];
  for (const entry of timeline) {
    let group = groups.find(item => item.phaseId === entry.phaseId);
    if (!group) { group = { phaseId: entry.phaseId, phaseTitle: entry.phaseTitle, takeaway: null, entries: [] }; groups.push(group); }
    group.takeaway ??= entry.takeaway || null;
    group.entries.push(entry);
  }
  return groups;
}
/** Nombre base de las descargas: simulador-ufv-<escenario>-<fecha de la sesión>. */
function exportBaseName(state: SessionState): string {
  const scenario = state.scenario.id.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'escenario';
  const created = new Date(state.createdAt);
  const day = Number.isNaN(created.getTime()) ? new Date() : created;
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return `simulador-ufv-${scenario}-${date}`;
}
function download(blob: Blob, filename: string) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
function downloadCsv(state: SessionState, report: Report) {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const rows = [['sesion', 'escenario', 'version', 'fase', 'participante', 'opcion', 'valoracion', 'segundos', 'tiempo_agotado', 'consecuencia', 'por_que', 'idea_clave'],
    ...report.timeline.map(entry => [state.id, state.scenario.id, state.scenario.version, entry.phaseTitle, state.participants.find(person => person.userId === entry.userId)?.name ?? entry.userId, entry.label, qualityLabel(entry.quality), Math.round(entry.durationMs / 1000), entry.timedOut ? 'si' : 'no', entry.consequence, entry.rationale ?? '', entry.takeaway ?? '']),
    [], ['puntuacion', report.score], ['decisiones_correctas_pct', report.correctDecisionsPct ?? ''], ['reaccion_pct', report.reactionPct ?? ''], ['objetivos_pct', report.objectivesPct], ['decisiones_criticas', report.criticalDecisions], ['tiempos_agotados', report.timeouts]];
  download(new Blob(['﻿' + rows.map(row => row.map(quote).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${exportBaseName(state)}.csv`);
}


createRoot(document.getElementById('root')!).render(<React.StrictMode><ToastProvider><App/></ToastProvider></React.StrictMode>);
