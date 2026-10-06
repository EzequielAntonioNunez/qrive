import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { defaultScenario, meterLabels, type SessionState, type PerformanceReport, type SimEvent, type MeterName } from '../shared/simulation';
import { brand } from './brand';
import './style.css';
import { installStandaloneApi } from './standalone';

const standalone = import.meta.env.VITE_STANDALONE === '1';
if (standalone) installStandaloneApi();

type Identity = { id: string; name: string; role: 'instructor' | 'participant'; tenantId: string };
type SessionSummary = { id: string; status: string; createdAt: string; scenarioId: string };
type SessionPayload = { state: SessionState; report: PerformanceReport; clients?: { unity?: string } };
type ScenarioSummary = { id: string; version: number; title: string; summary: string; phases: number; catalog: boolean };
type Member = { id: string; email: string; name: string; role: 'instructor' | 'participant' };

function App() {
  const [demoUser, setDemoUser] = useState<'instructor' | 'participant'>('instructor');
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
  const [members, setMembers] = useState<Member[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([]);
  const [scenarioId, setScenarioId] = useState(defaultScenario.id);
  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [meter, setMeter] = useState<MeterName>('relationship');
  const [meterValue, setMeterValue] = useState(50);

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-demo-user': demoUser, ...init?.headers } });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }, [demoUser]);

  const refresh = useCallback(async () => {
    try {
      const [who, listing] = await Promise.all([api<{ identity: Identity; demo: boolean; flags?: { phase_timers?: boolean } }>('/me'), api<{ sessions: SessionSummary[] }>('/sessions')]);
      setIdentity(who.identity);
      setDemo(who.demo);
      setTimersOn(who.flags?.phase_timers !== false);
      setSessions(listing.sessions);
      if (selected) setPayload(await api<SessionPayload>(`/sessions/${selected}`));
      setLoadError('');
    } catch (cause) { setLoadError(String(cause)); }
  }, [api, selected]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 2500); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { setPayload(null); setError(''); setConfirmDelete(false); }, [demoUser, selected]);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(tick); }, []);
  useEffect(() => {
    if (!identity) return;
    void api<{ scenarios: ScenarioSummary[] }>('/scenarios').then(result => setScenarios(result.scenarios)).catch(cause => setError(String(cause)));
  }, [api, identity?.id]);
  useEffect(() => {
    if (identity?.role !== 'instructor') { setMembers([]); return; }
    void api<{ members: Member[] }>('/memberships').then(result => setMembers(result.members)).catch(cause => setError(String(cause)));
  }, [api, identity?.role]);

  async function addMember(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const result = await api<{ member: Member }>('/memberships', {
        method: 'POST', body: JSON.stringify({ name: memberName, email: memberEmail, role: 'participant' })
      });
      setMembers(current => [...current.filter(person => person.id !== result.member.id), result.member].sort((a, b) => a.name.localeCompare(b.name)));
      setMemberName(''); setMemberEmail('');
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
    if (!selected) return;
    try {
      const data = await api<unknown>(`/sessions/${selected}/export`);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      link.download = `axyro-${selected.slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
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

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><img src={brand.logoOnDark} alt={brand.organization} height="34"/><small>{brand.product}</small></div>
      <div className="sidebar-section"><span className="eyebrow">{state ? 'ESCENARIO DE LA SESIÓN' : 'ESCENARIO'}</span><h2>{state?.scenario.title ?? scenarios.find(item => item.id === scenarioId)?.title ?? 'Cargando…'}</h2><p>{state ? `Versión ${state.scenario.version} · ${state.scenario.phases.length} fases` : scenarios.find(item => item.id === scenarioId)?.summary}</p>
        {identity?.role === 'instructor' && scenarios.length > 1 && <label className="scenario-picker"><span>Escenario para nuevas sesiones</span><select value={scenarioId} onChange={event => setScenarioId(event.target.value)}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.title} · v{item.version}</option>)}</select></label>}</div>
      {demo && <div className="role-switch"><span className="eyebrow">{standalone ? 'VER COMO' : 'MODO LOCAL'}</span><div className="switch-row"><button className={demoUser === 'instructor' ? 'selected' : ''} onClick={() => setDemoUser('instructor')}>Instructor</button><button className={demoUser === 'participant' ? 'selected' : ''} onClick={() => setDemoUser('participant')}>Participante</button></div></div>}
      <div className="sidebar-section sessions"><div className="section-heading"><span className="eyebrow">SESIONES</span>{identity?.role === 'instructor' && <button className="text-button" onClick={create} disabled={busy}>+ Nueva</button>}</div>
        {sessions.length === 0 && <p>Aún no hay sesiones. Crea la primera para empezar.</p>}
        {sessions.map(item => <button key={item.id} className={`session-link ${selected === item.id ? 'active' : ''}`} onClick={() => setSelected(item.id)}><span className="session-dot"/><span><strong>{new Date(item.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong><small>{item.status === 'complete' ? 'Finalizada' : item.status === 'paused' ? 'Pausada' : 'En curso'} · {item.id.slice(0, 6)}</small></span></button>)}
      </div><div className="sidebar-footer">{identity ? `${identity.name} · ${identity.role}` : 'Conectando…'}</div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">{brand.organization.toUpperCase()}</span><h1>Centro de simulación</h1></div><div className="topbar-actions"><span className="environment">{standalone ? 'DEMO EN NAVEGADOR' : demo ? 'ENTORNO LOCAL' : 'ENTORNO CLOUD'}</span></div></header>
      {(error || loadError) && <div className="error" role="alert">{error || loadError}</div>}
      {!state ? <div className="empty"><div className="empty-icon">◈</div><h2>Una negociación, muchas consecuencias</h2><p>Selecciona una sesión o crea una nueva para explorar el escenario de proveedor estratégico.</p>{identity?.role === 'instructor' && <button className="primary" onClick={create} disabled={busy}>Crear sesión</button>}</div> : <>
        <div className="overview"><div><span className="eyebrow">SESIÓN {state.id.slice(0, 8).toUpperCase()}</span><h2>{state.scenario.title}</h2><p>{state.scenario.summary}</p></div><span className={`status ${state.status}`}>{state.status === 'complete' ? 'Finalizada' : state.status === 'paused' ? 'Pausada' : 'En curso'}</span></div>
        <div className="grid"><section className="panel scene"><div className="panel-top"><span className="eyebrow">FASE {state.phaseIndex + 1} DE {state.scenario.phases.length}</span><span className="phase-line"><i style={{ width: `${((state.phaseIndex + 1) / state.scenario.phases.length) * 100}%` }}/></span>{timersOn && state.status !== 'complete' && <Timer remainingMs={remainingMs} expired={phaseExpired} paused={state.status === 'paused'} limitSec={phase?.timeLimitSec}/>}</div><h3>{phase?.title}</h3><p className="briefing">{phase?.briefing}</p>
          <div className="experience">
            <div className="experience-head"><span className="eyebrow">EXPERIENCIA DEL PARTICIPANTE</span>{identity?.role === 'instructor' && !standalone && <span className={`presence ${unityOnline ? 'online' : ''}`}><i/>{unityOnline ? 'Unity conectado' : 'Unity sin conexión'}</span>}</div>
            {phase?.characterLine && <blockquote><strong>{state.scenario.character?.name ?? 'Personaje'}</strong>«{phase.characterLine}»</blockquote>}
            {lastChoice && <p className="consequence"><span>Última decisión</span>{lastChoice.label} <em>→ {lastChoice.consequence}</em></p>}
          </div>
          {identity?.role === 'participant' && state.status !== 'complete' && !hasJoined && <button className="primary" onClick={() => command('join')} disabled={busy}>Unirme a la sesión</button>}
          {identity?.role === 'participant' && hasJoined && !hasDecided && state.status === 'active' && <div className="options">{phase?.options.map(option => <button key={option.id} onClick={() => command('decide', { optionId: option.id })} disabled={busy}><strong>{option.label}</strong><span>Elegir opción →</span></button>)}</div>}
          {identity?.role === 'participant' && hasDecided && <div className="notice">Decisión registrada. Espera a que el instructor avance.</div>}
          {canControl && state.status !== 'complete' && <div className="controls"><span className="eyebrow">CONTROL DEL INSTRUCTOR</span><p>{state.participants.length} participante(s) · {phaseDecisions} decisión(es) en esta fase</p><div className="button-row">{state.status === 'paused' ? <button onClick={() => command('resume')} disabled={busy}>Reanudar</button> : state.status === 'active' && <button onClick={() => command('pause')} disabled={busy}>Pausar</button>}{state.status === 'active' && state.phaseIndex < state.scenario.phases.length - 1 && <button className="primary" onClick={() => command('advance')} disabled={busy || phaseDecisions === 0}>Siguiente fase →</button>}{state.phaseIndex === state.scenario.phases.length - 1 && <button className="primary" onClick={() => command('complete')} disabled={busy || phaseDecisions === 0}>Finalizar sesión</button>}</div><div className="incident"><input value={incident} onChange={event => setIncident(event.target.value)} maxLength={200} placeholder="Introducir incidente para el debriefing"/><button onClick={() => command('incident', { note: incident, riskDelta: 5 })} disabled={busy || !incident.trim()}>Lanzar</button></div></div>}
          {state.status === 'complete' && <div className="notice success">Simulación finalizada. Revisa el informe de desempeño.</div>}
        </section><aside className="right-column"><section className="panel metrics"><span className="eyebrow">INDICADORES</span><Meter label={meterLabels(state.scenario).relationship} value={state.meters.relationship}/><Meter label={meterLabels(state.scenario).margin} value={state.meters.margin}/><Meter label={meterLabels(state.scenario).risk} value={state.meters.risk} danger/>{canControl && state.status !== 'complete' && <div className="meter-control"><label htmlFor="meter-select">Ajustar indicador</label><div><select id="meter-select" value={meter} onChange={event => { const next = event.target.value as MeterName; setMeter(next); setMeterValue(state.meters[next]); }}>{(['relationship', 'margin', 'risk'] as const).map(name => <option key={name} value={name}>{meterLabels(state.scenario)[name]}</option>)}</select><input type="number" min="0" max="100" step="1" aria-label="Nuevo valor" value={meterValue} onChange={event => setMeterValue(Number(event.target.value))}/><button onClick={() => command('set-meter', { meter, value: meterValue })} disabled={busy || !Number.isInteger(meterValue) || meterValue < 0 || meterValue > 100 || meterValue === state.meters[meter]}>Aplicar</button></div></div>}</section><section className="panel report"><span className="eyebrow">PERFORMANCE REPORT</span><div className="score">{payload?.report.score}<small>/100</small></div><div className="report-grid"><div><strong>{pct(payload?.report.correctDecisionsPct)}</strong><span>Decisiones correctas</span></div><div><strong>{pct(payload?.report.reactionPct)}</strong><span>Tiempo de reacción</span></div><div><strong>{pct(payload?.report.objectivesPct)}</strong><span>Objetivos ({payload?.report.objectivesMet}/{payload?.report.objectivesTotal})</span></div><div><strong>{payload?.report.criticalDecisions ?? 0}</strong><span>Decisiones críticas</span></div><div><strong>{payload?.report.decisions}</strong><span>Decisiones · {((payload?.report.avgReactionMs ?? 0) / 1000).toFixed(1)}s media</span></div><div><strong>{payload?.report.timeouts ?? 0}</strong><span>Tiempos agotados</span></div></div><p>Puntuación basada en los indicadores observables del escenario. No se infieren emociones ni estados psicológicos.</p></section></aside></div>
        {identity?.role === 'instructor' && <section className="panel people"><div className="section-heading"><span className="eyebrow">PARTICIPANTES</span><span>{state.participants.length} en esta sesión</span></div><div className="people-grid"><div><h3>En la sesión</h3>{state.participants.length === 0 ? <p>Aún no se ha unido ningún participante.</p> : <ul>{state.participants.map(person => <li key={person.userId}>{person.name}</li>)}</ul>}</div><div><h3>Miembros de la organización</h3>{members.length === 0 ? <p>No hay miembros registrados.</p> : <ul>{members.map(person => <li key={person.id}>{person.name} <small>{person.role === 'instructor' ? 'Instructor' : 'Participante'} · {person.email}</small></li>)}</ul>}<form onSubmit={addMember}><input aria-label="Nombre del participante" placeholder="Nombre" value={memberName} onChange={event => setMemberName(event.target.value)} maxLength={100} required/><input aria-label="Correo del participante" type="email" placeholder="Correo" value={memberEmail} onChange={event => setMemberEmail(event.target.value)} maxLength={254} required/><button disabled={busy}>Añadir participante</button></form>{!demo && <p>El acceso al dominio también debe estar autorizado en Cloudflare Access. Esta alta no envía una invitación.</p>}</div></div></section>}
        {(identity?.role === 'instructor' || state.status === 'complete') && payload && payload.report.timeline.length > 0 && <section className="panel debrief"><div className="section-heading"><span className="eyebrow">DEBRIEFING</span>{identity?.role === 'instructor' && !standalone && <button className="text-button" onClick={() => downloadCsv(state, payload.report)}>Descargar CSV</button>}</div>
          <div className="debrief-rows">{payload.report.timeline.map(entry => <div className="debrief-row" key={`${entry.userId}-${entry.phaseId}`}><div><span className="eyebrow">{entry.phaseTitle}</span><strong>{entry.label}</strong><p>{entry.consequence}</p></div><div className="debrief-meta"><span className={`quality ${entry.quality ?? 'none'}`}>{qualityLabel(entry.quality)}</span><small>{state.participants.find(person => person.userId === entry.userId)?.name ?? 'Participante'} · {(entry.durationMs / 1000).toFixed(0)} s{entry.timedOut ? ' · tras agotar el tiempo' : ''}</small></div></div>)}</div></section>}
        {identity?.role === 'instructor' && !standalone && <section className="panel data-rights"><div><span className="eyebrow">DATOS DE LA SESIÓN</span><p>Exporta todo lo registrado o elimínalo de forma definitiva. La eliminación queda anotada en la auditoría.</p></div><div className="button-row">{confirmDelete ? <><button onClick={() => setConfirmDelete(false)} disabled={busy}>Cancelar</button><button className="danger-button" onClick={deleteSession} disabled={busy}>Eliminar definitivamente</button></> : <><button onClick={exportSession} disabled={busy}>Exportar JSON</button><button onClick={() => setConfirmDelete(true)} disabled={busy}>Eliminar sesión</button></>}</div></section>}
        <section className="panel timeline"><div className="section-heading"><span className="eyebrow">CRONOLOGÍA DE EVENTOS</span><span>{state.events.length} eventos</span></div><div className="events">{[...state.events].reverse().map((event: SimEvent) => <div className="event" key={event.seq}><span className="event-seq">{String(event.seq).padStart(2, '0')}</span><div><strong>{eventLabel(event.type)}</strong><small>{new Date(event.at).toLocaleTimeString('es-ES')} · {event.actorId}</small></div><span>{typeof event.detail.optionId === 'string' ? event.detail.optionId : ''}</span></div>)}</div></section>
      </>}
    </main>
  </div>;
}

function Meter({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) { return <div className="meter"><div><span>{label}</span><strong>{value}</strong></div><div className="track"><span className={danger ? 'danger' : ''} style={{ width: `${value}%` }}/></div></div>; }
function pct(value: number | null | undefined): string { return value == null ? '—' : `${value} %`; }
function qualityLabel(value: string | null): string { return value === 'best' ? 'Mejor opción' : value === 'acceptable' ? 'Aceptable' : value === 'poor' ? 'Crítica' : 'Sin valorar'; }
function downloadCsv(state: SessionState, report: PerformanceReport) {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const rows = [['sesion', 'escenario', 'version', 'fase', 'participante', 'opcion', 'valoracion', 'segundos', 'tiempo_agotado', 'consecuencia'],
    ...report.timeline.map(entry => [state.id, state.scenario.id, state.scenario.version, entry.phaseTitle, state.participants.find(person => person.userId === entry.userId)?.name ?? entry.userId, entry.label, qualityLabel(entry.quality), Math.round(entry.durationMs / 1000), entry.timedOut ? 'si' : 'no', entry.consequence]),
    [], ['puntuacion', report.score], ['decisiones_correctas_pct', report.correctDecisionsPct ?? ''], ['reaccion_pct', report.reactionPct ?? ''], ['objetivos_pct', report.objectivesPct], ['decisiones_criticas', report.criticalDecisions], ['tiempos_agotados', report.timeouts]];
  const blob = new Blob(['\ufeff' + rows.map(row => row.map(quote).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `axyro-${state.id.slice(0, 8)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}
function Timer({ remainingMs, expired, paused, limitSec }: { remainingMs: number | null; expired: boolean; paused: boolean; limitSec?: number }) {
  if (!limitSec) return null;
  if (expired) return <span className="timer expired">Tiempo agotado</span>;
  if (remainingMs == null) return <span className="timer idle">{format(limitSec * 1000)} · empieza al unirse</span>;
  return <span className={`timer ${paused ? 'idle' : remainingMs < 60000 ? 'urgent' : ''}`}>{format(remainingMs)}{paused ? ' · en pausa' : ''}</span>;
}
function format(ms: number): string { const total = Math.ceil(ms / 1000); return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function eventLabel(type: string): string { return ({ session_started: 'Sesión iniciada', participant_joined: 'Participante unido', decision: 'Decisión tomada', phase_advanced: 'Fase avanzada', paused: 'Sesión pausada', resumed: 'Sesión reanudada', incident: 'Incidente', meter_changed: 'Indicador ajustado', timer_expired: 'Tiempo de fase agotado', completed: 'Sesión finalizada' } as Record<string, string>)[type] ?? type; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);



