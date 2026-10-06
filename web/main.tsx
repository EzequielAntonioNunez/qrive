import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultScenario, meterLabels, type SessionState, type PerformanceReport, type SimEvent, type MeterName } from '../shared/simulation';
import { brand } from './brand';
import './style.css';
import { installStandaloneApi } from './standalone';

const standalone = import.meta.env.VITE_STANDALONE === '1';
if (standalone) installStandaloneApi();

type Role = 'instructor' | 'participant';
type Identity = { id: string; name: string; email: string; role: Role; tenantId: string };
type SessionSummary = { id: string; status: string; createdAt: string; scenarioId: string };
/** Entrada del debriefing. `rationale` y `takeaway` son opcionales: los informes antiguos no los traen. */
type TimelineEntry = Omit<PerformanceReport['timeline'][number], 'rationale' | 'takeaway'> & { rationale?: string | null; takeaway?: string | null };
/** Resultado individual de un participante (modo individual). Todo opcional salvo el userId para no depender del motor. */
type ParticipantResult = {
  userId: string; name?: string; score?: number; objectivesMet?: number; objectivesTotal?: number;
  correctDecisionsPct?: number | null; criticalDecisions?: number; decisions?: number; meters?: Partial<Record<MeterName, number>>;
};
/**
 * Informe tal como lo recibe la consola. Se tipa aparte del motor para tolerar versiones distintas:
 * `participants` puede ser un número (informe de la clase) o la lista de resultados por participante.
 */
type Report = Omit<PerformanceReport, 'timeline' | 'participants' | 'participantReports'> & {
  timeline: TimelineEntry[];
  participants?: number | ParticipantResult[];
  participantReports?: ParticipantResult[];
};
type SessionPayload = { state: SessionState; report: Report; clients?: { unity?: string } };
type ScenarioSummary = { id: string; version: number; title: string; summary: string; phases: number; catalog: boolean };
type Member = { id: string; email: string; name: string; role: Role };
type CodeSummary = { id: string; userId: string; createdAt: string; uses: number; lastUsedAt: string | null };
type CodeUse = { codeId: string; userId: string; name: string | null; at: string; outcome: 'accepted' | 'revoked' };

/** Efectos de un incidente sobre el indicador de riesgo que puede elegir el docente. */
const INCIDENT_DELTAS = [-10, -5, 5, 10, 15] as const;

function App() {
  const [demoUser, setDemoUser] = useState<Role>('instructor');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [demo, setDemo] = useState(false);
  const [timersOn, setTimersOn] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [payload, setPayload] = useState<SessionPayload | null>(null);
  const [error, setError] = useState('');
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [incident, setIncident] = useState('');
  const [incidentDelta, setIncidentDelta] = useState<number>(5);
  const [members, setMembers] = useState<Member[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenarioId, setScenarioId] = useState(defaultScenario.id);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [meter, setMeter] = useState<MeterName>('relationship');
  const [meterValue, setMeterValue] = useState(50);
  const [copied, setCopied] = useState(false);
  const [authRequired, setAuthRequired] = useState<boolean | null>(standalone ? false : null);
  const [loginEmail, setLoginEmail] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [loginError, setLoginError] = useState('');
  const [memberRole, setMemberRole] = useState<Role>('participant');
  const [codes, setCodes] = useState<CodeSummary[]>([]);
  const [codeUses, setCodeUses] = useState<CodeUse[]>([]);
  const [issued, setIssued] = useState<{ code: string; name: string } | null>(null);
  const [canAssignInstructor, setCanAssignInstructor] = useState(false);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-demo-user': demoUser, ...init?.headers } });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw Object.assign(new Error(body.error ?? `HTTP ${response.status}`), { status: response.status });
    return body;
  }, [demoUser]);

  const refresh = useCallback(async () => {
    try {
      const [who, listing] = await Promise.all([api<{ identity: Identity; demo: boolean; flags?: { phase_timers?: boolean }; permissions?: { assignInstructor?: boolean } }>('/me'), api<{ sessions: SessionSummary[] }>('/sessions')]);
      setIdentity(who.identity);
      setCanAssignInstructor(who.permissions?.assignInstructor === true);
      setAuthRequired(false);
      setDemo(who.demo);
      setTimersOn(who.flags?.phase_timers !== false);
      setSessions(listing.sessions);
      if (selected) setPayload(await api<SessionPayload>(`/sessions/${selected}`));
      setLoadError('');
    } catch (cause) {
      if ((cause as { status?: number }).status === 401 && !standalone) { setAuthRequired(true); setIdentity(null); setLoadError(''); }
      else setLoadError(String(cause));
    }
  }, [api, selected]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 2500); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { setPayload(null); setError(''); setConfirmDelete(false); setCopied(false); }, [demoUser, selected]);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(tick); }, []);
  useEffect(() => {
    if (!identity) return;
    void api<{ scenarios: ScenarioSummary[] }>('/scenarios').then(result => setScenarios(result.scenarios)).catch(cause => setError(String(cause)));
  }, [api, identity?.id]);
  useEffect(() => {
    if (identity?.role !== 'instructor') { setMembers([]); return; }
    void api<{ members: Member[] }>('/memberships').then(result => setMembers(result.members)).catch(cause => setError(String(cause)));
    if (!standalone) void loadCodeAudit();
  }, [api, identity?.role]);

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
    } catch (cause) { setLoginError(String(cause).replace(/^Error: /, '')); }
    finally { setBusy(false); }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST', body: '{}' });
    setIdentity(null); setAuthRequired(true); setSelected(null); setIssued(null);
  }

  async function generateCode(member: Member) {
    setBusy(true); setError('');
    try {
      const result = await api<{ code: string }>(`/access-codes/${member.id}`, { method: 'POST', body: '{}' });
      setIssued({ code: result.code, name: member.name });
      await loadCodeAudit();
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }

  async function revokeCode(member: Member) {
    setBusy(true); setError('');
    try {
      await api(`/access-codes/${member.id}`, { method: 'DELETE' });
      setIssued(null); await loadCodeAudit();
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api<{ member: Member }>('/memberships', {
        method: 'POST', body: JSON.stringify({ name: memberName, email: memberEmail, role: memberRole })
      });
      setMembers(current => [...current.filter(person => person.id !== result.member.id), result.member].sort((a, b) => a.name.localeCompare(b.name)));
      setMemberName(''); setMemberEmail('');
      setMemberRole('participant');
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }

  async function create() {
    setBusy(true); setError('');
    try {
      const result = await api<SessionPayload>('/sessions', { method: 'POST', body: JSON.stringify({ scenarioId }) });
      setSelected(result.state.id);
      setPayload(result);
      await refresh();
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }

  async function exportSession() {
    if (!selected || !payload) return;
    try {
      const data = await api<unknown>(`/sessions/${selected}/export`);
      download(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }), `${exportBaseName(payload.state)}.json`);
    } catch (cause) { setError(String(cause)); }
  }

  async function deleteSession() {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      await api(`/sessions/${selected}`, { method: 'DELETE' });
      setSelected(null); setPayload(null); setConfirmDelete(false);
      await refresh();
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }

  async function command(type: string, extra: Record<string, unknown> = {}) {
    if (!selected) return;
    setBusy(true); setError('');
    try {
      const result = await api<SessionPayload>(`/sessions/${selected}/commands`, { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), type, ...extra }) });
      setPayload(result);
      setIncident('');
      await refresh();
    } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }

  const state = payload?.state;
  const report = payload?.report;
  const phase = state?.scenario.phases[state.phaseIndex];
  const hasJoined = state?.participants.some(person => person.userId === identity?.id);
  const hasDecided = state?.decisions.some(decision => decision.userId === identity?.id && decision.phaseId === phase?.id);
  const phaseDecisions = state?.decisions.filter(decision => decision.phaseId === phase?.id).length ?? 0;
  const remainingMs = state?.phaseDeadline ? Math.max(0, Date.parse(state.phaseDeadline) - now) : state?.phaseRemainingMs ?? null;
  const phaseExpired = !!phase && !!state?.events.some(event => event.type === 'timer_expired' && event.detail.phaseId === phase.id);
  const unitySeen = payload?.clients?.unity ? Date.parse(payload.clients.unity) : null;
  const unityOnline = unitySeen !== null && now - unitySeen < 6000;
  const lastDecision = state ? [...state.decisions].reverse()[0] : undefined;
  const lastChoice = lastDecision ? state?.scenario.phases.find(item => item.id === lastDecision.phaseId)?.options.find(option => option.id === lastDecision.optionId) : undefined;
  const canControl = identity?.role === 'instructor' && identity.id === state?.instructorId;
  const simulatorLink = state ? simulatorUrl(state.id, demo) : '';
  const labels = state ? meterLabels(state.scenario) : null;
  const selectedScenario = scenarios.find(item => item.id === scenarioId);
  const characterName = state?.scenario.character?.name || 'VictorIA';
  const participantResults = report ? participantResultsOf(report) : [];
  const debriefGroups = report ? groupByPhase(report.timeline) : [];
  const participantName = (userId: string) => state?.participants.find(person => person.userId === userId)?.name ?? 'Participante';

  async function copySimulatorLink() {
    try { await navigator.clipboard.writeText(simulatorLink); setCopied(true); window.setTimeout(() => setCopied(false), 2500); }
    catch { setError('No se ha podido copiar el enlace. Selecciónalo y cópialo a mano.'); }
  }

  if (authRequired === null) return <div className="auth-screen"><div className="auth-card"><img src={brand.logoOnDark} alt={brand.organization}/><p>Preparando tu acceso…</p></div></div>;
  if (authRequired) return <div className="auth-screen"><div className="auth-card"><img src={brand.logoOnDark} alt={brand.organization}/><span className="eyebrow">CENTRO DE SIMULACIÓN</span><h1>Accede con tu código</h1><p>Introduce tu correo y el código personal de seis cifras que te ha entregado tu docente.</p><form onSubmit={login}><label>Correo electrónico<input type="email" autoComplete="username" value={loginEmail} onChange={event => setLoginEmail(event.target.value)} required/></label><label>Código de acceso<input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={loginCode} onChange={event => setLoginCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required/></label>{loginError && <p className="error" role="alert">{loginError}</p>}<button className="primary" disabled={busy || loginCode.length !== 6}>{busy ? 'Entrando…' : 'Entrar'}</button></form><small>El código es personal. Si no lo tienes, pídelo a tu docente.</small></div></div>;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><img src={brand.logoOnDark} alt={brand.organization} height="34"/><small>{brand.product}</small></div>
      <button className={`sidebar-home ${!selected ? 'active' : ''}`} onClick={() => setSelected(null)}>Vista general</button>
      {demo && <div className="role-switch"><span className="eyebrow">{standalone ? 'VER COMO' : 'MODO LOCAL'}</span><div className="switch-row"><button className={demoUser === 'instructor' ? 'selected' : ''} onClick={() => setDemoUser('instructor')}>Docente</button><button className={demoUser === 'participant' ? 'selected' : ''} onClick={() => setDemoUser('participant')}>Participante</button></div></div>}
      <div className="sidebar-section sessions"><div className="section-heading"><span className="eyebrow">SESIONES RECIENTES</span>{identity?.role === 'instructor' && <button className="text-button" onClick={() => setSelected(null)}>+ Nueva</button>}</div>
        {sessions.length === 0 && <p>Tu primera sesión aparecerá aquí.</p>}
        {sessions.map(item => <button key={item.id} className={`session-link ${selected === item.id ? 'active' : ''}`} onClick={() => setSelected(item.id)} title={`Sesión ${item.id}`}><strong>{scenarios.find(scenario => scenario.id === item.scenarioId)?.title ?? 'Simulación'}</strong><small>{new Date(item.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {statusLabel(item.status)}</small></button>)}
      </div><div className="sidebar-footer">{identity ? `${identity.name} · ${roleLabel(identity.role)}` : 'Conectando…'}{!demo && <button className="text-button" onClick={logout}>Salir</button>}</div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">{brand.organization.toUpperCase()}</span><h1>Centro de simulación</h1></div>{(standalone || demo) && <div className="topbar-actions"><span className="environment">{standalone ? 'DEMO EN NAVEGADOR' : 'ENTORNO LOCAL'}</span></div>}</header>
      {(error || loadError) && <div className="error" role="alert">{error || loadError}</div>}
      {!state || !report ? identity?.role === 'instructor' ? <div className="home">
        <section className="home-create"><span className="eyebrow">NUEVA SESIÓN</span><h2>Prepara una simulación para tu grupo</h2><p>Elige una situación, crea la sesión y comparte el enlace. Podrás seguir las decisiones y revisar el informe desde aquí.</p>
          {scenarios.length > 1 && <label className="home-picker"><span>Escenario</span><select value={scenarioId} onChange={event => setScenarioId(event.target.value)}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
          <div className="home-preview"><span className="eyebrow">{selectedScenario?.phases ?? defaultScenario.phases.length} FASES · VERSIÓN {selectedScenario?.version ?? defaultScenario.version}</span><h3>{selectedScenario?.title ?? defaultScenario.title}</h3><p>{selectedScenario?.summary ?? defaultScenario.summary}</p></div>
          <button className="primary" onClick={create} disabled={busy || scenarios.length === 0}>{busy ? 'Creando…' : 'Crear sesión y obtener enlace'} <span aria-hidden="true">→</span></button>
        </section>
        <aside className="home-steps"><span className="eyebrow">CÓMO FUNCIONA</span><h3>De la situación al debate</h3><ol><li><span>01</span><div><strong>Crea la sesión</strong><p>El escenario queda listo para tu grupo.</p></div></li><li><span>02</span><div><strong>Comparte el enlace</strong><p>Cada participante entra desde su navegador.</p></div></li><li><span>03</span><div><strong>Revisa las decisiones</strong><p>Sigue la actividad y comenta el informe final.</p></div></li></ol></aside>
        {!demo && <section className="access-management"><div className="section-heading"><div><span className="eyebrow">ACCESOS</span><h3>Personas y códigos</h3></div><span>Cada código pertenece a una sola persona y se muestra una vez.</span></div><div className="access-grid"><div><form className="member-form" onSubmit={addMember}><input aria-label="Nombre" placeholder="Nombre" value={memberName} onChange={event => setMemberName(event.target.value)} maxLength={100} required/><input aria-label="Correo" type="email" placeholder="Correo" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} maxLength={254} required/>{canAssignInstructor && <select aria-label="Rol" value={memberRole} onChange={event => setMemberRole(event.target.value as Role)}><option value="participant">Participante</option><option value="instructor">Docente</option></select>}<button disabled={busy}>Añadir persona</button></form><div className="access-list">{members.map(member => { const active = codes.find(item => item.userId === member.id); const canManage = member.role === 'participant' || canAssignInstructor; return <div className="access-person" key={member.id}><div><strong>{member.name}</strong><small>{member.email} · {roleLabel(member.role)} · {active ? `${active.uses} accesos` : 'Sin código'}</small></div>{canManage && <div><button onClick={() => generateCode(member)} disabled={busy}>{active ? 'Cambiar código' : 'Crear código'}</button>{active && member.id !== identity?.id && <button onClick={() => revokeCode(member)} disabled={busy}>Revocar</button>}</div>}</div>; })}</div>{issued && <div className="issued-code" role="status"><span>Código de {issued.name}</span><strong>{issued.code}</strong><p>Cópialo ahora y entrégalo de forma privada. No volverá a mostrarse.</p><button onClick={() => navigator.clipboard.writeText(issued.code)}>Copiar código</button><button onClick={() => setIssued(null)}>Cerrar</button></div>}</div><div className="access-audit"><strong>Últimos usos</strong>{codeUses.length ? <ul>{codeUses.slice(0, 10).map((entry, index) => <li key={`${entry.codeId}-${entry.at}-${index}`}><span>{entry.name ?? 'Usuario eliminado'} · {entry.outcome === 'accepted' ? 'Acceso' : 'Código revocado'}</span><time>{new Date(entry.at).toLocaleString('es-ES')}</time></li>)}</ul> : <p>Todavía no se ha utilizado ningún código.</p>}</div></div></section>}
      </div> : <div className="home home-participant"><section className="home-create"><span className="eyebrow">TU SIMULACIÓN</span><h2>Entra desde el enlace de tu docente</h2><p>Abre el enlace que te hayan compartido para ver la situación y elegir cómo actuar. Tus sesiones también aparecerán en la barra lateral.</p></section></div> : <>
        <div className="overview"><div><span className="eyebrow">SESIÓN {state.id.slice(0, 8).toUpperCase()}</span><h2>{state.scenario.title}</h2><p>{state.scenario.summary}</p></div><span className={`status ${state.status}`}>{statusLabel(state.status)}</span></div>
        <p className="ai-notice" role="note"><span aria-hidden="true">i</span><span><strong>{characterName} es un personaje virtual.</strong> Su imagen y su voz son sintéticas. Las frases están grabadas de antemano a partir de un guion: no es una IA que converse. El simulador no infiere emociones ni estados psicológicos; las valoraciones se refieren a las decisiones, no a las personas.</span></p>
        <div className="grid"><section className="panel scene"><div className="panel-top"><span className="eyebrow">FASE {state.phaseIndex + 1} DE {state.scenario.phases.length}</span><span className="phase-line"><i style={{ width: `${((state.phaseIndex + 1) / state.scenario.phases.length) * 100}%` }}/></span>{timersOn && state.status !== 'complete' && <Timer remainingMs={remainingMs} expired={phaseExpired} paused={state.status === 'paused'} limitSec={phase?.timeLimitSec}/>}</div><h3>{phase?.title}</h3><p className="briefing">{phase?.briefing}</p>
          <div className="experience">
            <div className="experience-head"><span className="eyebrow">EXPERIENCIA DEL PARTICIPANTE</span>{identity?.role === 'instructor' && !standalone && <span className={`presence ${unityOnline ? 'online' : ''}`}><i/>{unityOnline ? 'Actividad en el simulador' : 'Sin actividad reciente'}</span>}</div>
            {phase?.characterLine && <blockquote><strong>{characterName}</strong>«{phase.characterLine}»</blockquote>}
            {identity?.role === 'instructor' && !standalone && state.status !== 'complete' && <div className="simulator-link"><span className="eyebrow">ENLACE PARA PARTICIPANTES</span><div><input readOnly aria-label="Enlace del simulador" value={simulatorLink} onFocus={event => event.currentTarget.select()}/><button onClick={copySimulatorLink}>{copied ? 'Copiado' : 'Copiar enlace'}</button><a className="primary" href={simulatorLink} target="_blank" rel="noopener">Abrir simulador</a></div><small>Se abre en el navegador, sin instalar nada. Cada participante entra con su correo y código personal.</small></div>}
            {lastChoice && <p className="consequence"><span>Última decisión</span>{lastChoice.label} <em>→ {lastChoice.consequence}</em></p>}
          </div>
          {identity?.role === 'participant' && state.status !== 'complete' && !hasJoined && <button className="primary" onClick={() => command('join')} disabled={busy}>Unirme a la sesión</button>}
          {identity?.role === 'participant' && hasJoined && !hasDecided && state.status === 'active' && <div className="options">{phase?.options.map(option => <button key={option.id} onClick={() => command('decide', { optionId: option.id })} disabled={busy}><strong>{option.label}</strong><span>Elegir opción →</span></button>)}</div>}
          {identity?.role === 'participant' && hasDecided && <div className="notice">Decisión registrada. Espera a que el docente avance.</div>}
          {canControl && state.status !== 'complete' && <div className="controls"><span className="eyebrow">CONTROL DEL DOCENTE</span><p>{state.participants.length} participante(s) · {phaseDecisions} decisión(es) en esta fase</p><div className="button-row">{state.status === 'paused' ? <button onClick={() => command('resume')} disabled={busy}>Reanudar</button> : state.status === 'active' && <button onClick={() => command('pause')} disabled={busy}>Pausar</button>}{state.status === 'active' && state.phaseIndex < state.scenario.phases.length - 1 && <button className="primary" onClick={() => command('advance')} disabled={busy || phaseDecisions === 0}>Siguiente fase →</button>}{state.phaseIndex === state.scenario.phases.length - 1 && <button className="primary" onClick={() => command('complete')} disabled={busy || phaseDecisions === 0}>Finalizar sesión</button>}</div>
            <div className="incident"><input value={incident} onChange={event => setIncident(event.target.value)} maxLength={200} aria-label="Texto del incidente" aria-describedby="incident-hint" placeholder="Describe un incidente para la sesión"/><select value={incidentDelta} onChange={event => setIncidentDelta(Number(event.target.value))} aria-label={`Efecto en ${labels?.risk ?? 'Riesgo'}`} title={`Efecto en ${labels?.risk ?? 'Riesgo'}`}>{INCIDENT_DELTAS.map(delta => <option key={delta} value={delta}>{labels?.risk ?? 'Riesgo'} {signed(delta)}</option>)}</select><button onClick={() => command('incident', { note: incident.trim(), riskDelta: incidentDelta })} disabled={busy || !incident.trim()}>Lanzar</button></div>
            <small className="field-hint" id="incident-hint">No incluyas nombres ni datos personales.</small></div>}
          {state.status === 'complete' && <div className="notice success">Simulación finalizada. Revisa el informe de resultados.</div>}
        </section><aside className="right-column"><section className="panel metrics"><span className="eyebrow">INDICADORES</span><Meter label={labels!.relationship} value={state.meters.relationship}/><Meter label={labels!.margin} value={state.meters.margin}/><Meter label={labels!.risk} value={state.meters.risk} danger/>{canControl && state.status !== 'complete' && <div className="meter-control"><label htmlFor="meter-select">Ajustar indicador</label><div><select id="meter-select" value={meter} onChange={event => { const next = event.target.value as MeterName; setMeter(next); setMeterValue(state.meters[next]); }}>{(['relationship', 'margin', 'risk'] as const).map(name => <option key={name} value={name}>{labels![name]}</option>)}</select><input type="number" min="0" max="100" step="1" aria-label="Nuevo valor" value={meterValue} onChange={event => setMeterValue(Number(event.target.value))}/><button onClick={() => command('set-meter', { meter, value: meterValue })} disabled={busy || !Number.isInteger(meterValue) || meterValue < 0 || meterValue > 100 || meterValue === state.meters[meter]}>Aplicar</button></div></div>}</section>
          <section className="panel report"><span className="eyebrow">INFORME DE RESULTADOS</span><div className="score">{report.score}<small>/100</small></div><div className="report-grid"><div><strong>{pct(report.correctDecisionsPct)}</strong><span>Decisiones correctas</span></div><div><strong>{pct(report.reactionPct)}</strong><span>Tiempo de reacción</span></div><div><strong>{pct(report.objectivesPct)}</strong><span>Objetivos ({report.objectivesMet}/{report.objectivesTotal})</span></div><div><strong>{report.criticalDecisions ?? 0}</strong><span>Decisiones críticas</span></div><div><strong>{report.decisions}</strong><span>Decisiones · {((report.avgReactionMs ?? 0) / 1000).toLocaleString('es-ES', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s de media</span></div><div><strong>{report.timeouts ?? 0}</strong><span>Tiempos agotados</span></div></div>
            {identity?.role === 'instructor' && participantResults.length > 0 && <div className="participant-results"><h4>Resultados por participante</h4><div className="table-scroll"><table><thead><tr><th scope="col">Participante</th><th scope="col">Puntuación</th><th scope="col">Objetivos</th><th scope="col">Correctas</th><th scope="col">Críticas</th><th scope="col">Decisiones</th></tr></thead><tbody>{participantResults.map(row => <tr key={row.userId}><th scope="row">{row.name || participantName(row.userId)}{row.meters && labels && <small>{(['relationship', 'margin', 'risk'] as const).filter(name => typeof row.meters?.[name] === 'number').map(name => <span key={name}>{labels[name]} {row.meters![name]}</span>)}</small>}</th><td>{row.score ?? '—'}</td><td>{row.objectivesMet ?? '—'}/{row.objectivesTotal ?? report.objectivesTotal}</td><td>{pct(row.correctDecisionsPct)}</td><td>{row.criticalDecisions ?? '—'}</td><td>{row.decisions ?? '—'}</td></tr>)}</tbody></table></div></div>}
            <p>Puntuación basada en los indicadores observables del escenario. No se infieren emociones ni estados psicológicos.</p></section></aside></div>
        {identity?.role === 'instructor' && <section className="panel people"><div className="section-heading"><span className="eyebrow">PARTICIPANTES</span><span>{state.participants.length} en esta sesión</span></div><div className="people-grid"><div><h3>En la sesión</h3>{state.participants.length === 0 ? <p>Aún no se ha unido ningún participante.</p> : <ul>{state.participants.map(person => <li key={person.userId}>{person.name}</li>)}</ul>}</div><div><h3>Accesos del grupo</h3><p>Gestiona las personas y sus códigos personales desde Vista general.</p><button onClick={() => setSelected(null)}>Ir a Vista general</button></div></div></section>}
        {(identity?.role === 'instructor' || state.status === 'complete') && report.timeline.length > 0 && <section className="panel debrief"><div className="section-heading"><span className="eyebrow">DEBRIEFING</span>{identity?.role === 'instructor' && !standalone && <button className="text-button" onClick={() => downloadCsv(state, report)}>Descargar CSV</button>}</div>
          <div className="debrief-rows">{debriefGroups.map(group => <div className="debrief-group" key={group.phaseId}>
            {group.entries.map(entry => <div className="debrief-row" key={`${entry.userId}-${entry.phaseId}`}><div><span className="eyebrow">{entry.phaseTitle}</span><strong>{entry.label}</strong><p>{entry.consequence}</p>{entry.rationale && <p className="rationale"><span>Por qué</span>{entry.rationale}</p>}</div><div className="debrief-meta"><span className={`quality ${entry.quality ?? 'none'}`}>{qualityLabel(entry.quality)}</span><small>{participantName(entry.userId)} · {(entry.durationMs / 1000).toFixed(0)} s{entry.timedOut ? ' · tras agotar el tiempo' : ''}</small></div></div>)}
            {group.takeaway && <p className="takeaway"><span>Idea clave · {group.phaseTitle}</span>{group.takeaway}</p>}
          </div>)}</div></section>}
        {identity?.role === 'instructor' && !standalone && <section className="panel data-rights"><div><span className="eyebrow">DATOS DE LA SESIÓN</span><p>Exporta todo lo registrado o elimínalo de forma definitiva. La eliminación queda anotada en la auditoría.</p></div><div className="button-row">{confirmDelete ? <><button onClick={() => setConfirmDelete(false)} disabled={busy}>Cancelar</button><button className="danger-button" onClick={deleteSession} disabled={busy}>Eliminar definitivamente</button></> : <><button onClick={exportSession} disabled={busy}>Exportar JSON</button><button onClick={() => setConfirmDelete(true)} disabled={busy}>Eliminar sesión</button></>}</div></section>}
        <section className="panel timeline"><div className="section-heading"><span className="eyebrow">CRONOLOGÍA DE EVENTOS</span><span>{state.events.length} eventos</span></div><div className="events">{[...state.events].reverse().map((event: SimEvent) => <div className="event" key={event.seq}><span className="event-seq">{String(event.seq).padStart(2, '0')}</span><div><strong>{eventLabel(event.type)}</strong><small>{new Date(event.at).toLocaleTimeString('es-ES')} · {actorLabel(event.actorId, state)}</small></div><span>{typeof event.detail.optionId === 'string' ? event.detail.optionId : ''}</span></div>)}</div></section>
      </>}
    </main>
  </div>;
}

/** Enlace del simulador WebGL. En local Vite no resuelve /simulador/ a index.html, así que se enlaza el fichero. */
function simulatorUrl(sessionId: string, demo: boolean): string {
  return `${window.location.origin}/simulador/${demo ? 'index.html' : ''}?sesion=${encodeURIComponent(sessionId)}`;
}
function Meter({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) { return <div className="meter"><div><span>{label}</span><strong>{value}</strong></div><div className="track"><span className={danger ? 'danger' : ''} style={{ width: `${value}%` }}/></div></div>; }
function pct(value: number | null | undefined): string { return value == null ? '—' : `${value} %`; }
function signed(value: number): string { return value > 0 ? `+${value}` : `−${Math.abs(value)}`; }
function roleLabel(role: string): string { return role === 'instructor' ? 'Docente' : 'Participante'; }
function statusLabel(status: string): string { return status === 'complete' ? 'Finalizada' : status === 'paused' ? 'Pausada' : 'En curso'; }
function actorLabel(actorId: string, state: SessionState): string {
  if (actorId === 'system') return 'Sistema';
  if (actorId === state.instructorId) return 'Docente';
  return state.participants.find(person => person.userId === actorId)?.name ?? 'Participante';
}
function qualityLabel(value: string | null): string { return value === 'best' ? 'Mejor opción' : value === 'acceptable' ? 'Aceptable' : value === 'poor' ? 'Crítica' : 'Sin valorar'; }
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
function Timer({ remainingMs, expired, paused, limitSec }: { remainingMs: number | null; expired: boolean; paused: boolean; limitSec?: number }) {
  if (!limitSec) return null;
  if (expired) return <span className="timer expired">Tiempo agotado</span>;
  if (remainingMs == null) return <span className="timer idle">{format(limitSec * 1000)} · empieza al unirse</span>;
  return <span className={`timer ${paused ? 'idle' : remainingMs < 60000 ? 'urgent' : ''}`}>{format(remainingMs)}{paused ? ' · en pausa' : ''}</span>;
}
function format(ms: number): string { const total = Math.ceil(ms / 1000); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function eventLabel(type: string): string { return ({ session_started: 'Sesión iniciada', participant_joined: 'Participante unido', decision: 'Decisión tomada', phase_advanced: 'Fase avanzada', paused: 'Sesión pausada', resumed: 'Sesión reanudada', incident: 'Incidente', meter_changed: 'Indicador ajustado', timer_expired: 'Tiempo de fase agotado', completed: 'Sesión finalizada' } as Record<string, string>)[type] ?? 'Evento'; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
