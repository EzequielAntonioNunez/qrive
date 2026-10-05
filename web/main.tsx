import React, { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { SessionState, PerformanceReport, SimEvent } from '../shared/simulation';
import './style.css';

type Identity = { id: string; name: string; role: 'instructor' | 'participant'; tenantId: string };
type SessionSummary = { id: string; status: string; createdAt: string; scenarioId: string };
type SessionPayload = { state: SessionState; report: PerformanceReport };

function App() {
  const [demoUser, setDemoUser] = useState<'instructor' | 'participant'>('instructor');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [demo, setDemo] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [payload, setPayload] = useState<SessionPayload | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [incident, setIncident] = useState('');

  const api = useCallback(async <T,>(path: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api${path}`, { ...init, headers: { 'content-type': 'application/json', 'x-demo-user': demoUser, ...init?.headers } });
    const body = await response.json() as T & { error?: string };
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);
    return body;
  }, [demoUser]);

  const refresh = useCallback(async () => {
    try {
      const [who, listing] = await Promise.all([api<{ identity: Identity; demo: boolean }>('/me'), api<{ sessions: SessionSummary[] }>('/sessions')]);
      setIdentity(who.identity);
      setDemo(who.demo);
      setSessions(listing.sessions);
      if (selected) setPayload(await api<SessionPayload>(`/sessions/${selected}`));
    } catch (cause) { setError(String(cause)); }
  }, [api, selected]);

  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 2500); return () => window.clearInterval(timer); }, [refresh]);
  useEffect(() => { setPayload(null); setError(''); }, [demoUser, selected]);

  async function create() {
    setBusy(true); setError('');
    try {
      const result = await api<SessionPayload>('/sessions', { method: 'POST' });
      setSelected(result.state.id);
      setPayload(result);
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
  const canControl = identity?.role === 'instructor' && identity.id === state?.instructorId;

  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">A</span><div><strong>AXYRO</strong><small>SIM LAB</small></div></div>
      <div className="sidebar-section"><span className="eyebrow">ESCENARIO ACTIVO</span><h2>Negociación con proveedor</h2><p>Una decisión cada vez. Consecuencias medibles y un debriefing claro.</p></div>
      {demo && <div className="role-switch"><span className="eyebrow">MODO LOCAL</span><div className="switch-row"><button className={demoUser === 'instructor' ? 'selected' : ''} onClick={() => setDemoUser('instructor')}>Instructor</button><button className={demoUser === 'participant' ? 'selected' : ''} onClick={() => setDemoUser('participant')}>Participante</button></div></div>}
      <div className="sidebar-section sessions"><div className="section-heading"><span className="eyebrow">SESIONES</span>{identity?.role === 'instructor' && <button className="text-button" onClick={create} disabled={busy}>+ Nueva</button>}</div>
        {sessions.length === 0 && <p>Aún no hay sesiones. Crea la primera para empezar.</p>}
        {sessions.map(item => <button key={item.id} className={`session-link ${selected === item.id ? 'active' : ''}`} onClick={() => setSelected(item.id)}><span className="session-dot"/><span><strong>{new Date(item.createdAt).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</strong><small>{item.status === 'complete' ? 'Finalizada' : item.status === 'paused' ? 'Pausada' : 'En curso'}</small></span></button>)}
      </div><div className="sidebar-footer">{identity ? `${identity.name} · ${identity.role}` : 'Conectando…'}</div>
    </aside>
    <main className="main">
      <header className="topbar"><div><span className="eyebrow">AXYRO SIM / DECISION · V0.1</span><h1>Centro de simulación</h1></div><span className="environment">{demo ? 'ENTORNO LOCAL' : 'ENTORNO CLOUD'}</span></header>
      {error && <div className="error" role="alert">{error}</div>}
      {!state ? <div className="empty"><div className="empty-icon">◈</div><h2>Una negociación, muchas consecuencias</h2><p>Selecciona una sesión o crea una nueva para explorar el escenario de proveedor estratégico.</p>{identity?.role === 'instructor' && <button className="primary" onClick={create} disabled={busy}>Crear sesión</button>}</div> : <>
        <div className="overview"><div><span className="eyebrow">SESIÓN {state.id.slice(0, 8).toUpperCase()}</span><h2>{state.scenario.title}</h2><p>{state.scenario.summary}</p></div><span className={`status ${state.status}`}>{state.status === 'complete' ? 'Finalizada' : state.status === 'paused' ? 'Pausada' : 'En curso'}</span></div>
        <div className="grid"><section className="panel scene"><div className="panel-top"><span className="eyebrow">FASE {state.phaseIndex + 1} DE {state.scenario.phases.length}</span><span className="phase-line"><i style={{ width: `${((state.phaseIndex + 1) / state.scenario.phases.length) * 100}%` }}/></span></div><h3>{phase?.title}</h3><p className="briefing">{phase?.briefing}</p>
          {identity?.role === 'participant' && state.status !== 'complete' && !hasJoined && <button className="primary" onClick={() => command('join')} disabled={busy}>Unirme a la sesión</button>}
          {identity?.role === 'participant' && hasJoined && !hasDecided && state.status === 'active' && <div className="options">{phase?.options.map(option => <button key={option.id} onClick={() => command('decide', { optionId: option.id })} disabled={busy}><strong>{option.label}</strong><span>Elegir opción →</span></button>)}</div>}
          {identity?.role === 'participant' && hasDecided && <div className="notice">Decisión registrada. Espera a que el instructor avance.</div>}
          {canControl && <div className="controls"><span className="eyebrow">CONTROL DEL INSTRUCTOR</span><p>{state.participants.length} participante(s) · {phaseDecisions} decisión(es) en esta fase</p><div className="button-row">{state.status === 'paused' ? <button onClick={() => command('resume')} disabled={busy}>Reanudar</button> : state.status === 'active' && <button onClick={() => command('pause')} disabled={busy}>Pausar</button>}{state.status === 'active' && state.phaseIndex < state.scenario.phases.length - 1 && <button className="primary" onClick={() => command('advance')} disabled={busy || phaseDecisions === 0}>Siguiente fase →</button>}{state.phaseIndex === state.scenario.phases.length - 1 && <button className="primary" onClick={() => command('complete')} disabled={busy || phaseDecisions === 0}>Finalizar sesión</button>}</div>{state.status !== 'complete' && <div className="incident"><input value={incident} onChange={event => setIncident(event.target.value)} maxLength={200} placeholder="Introducir incidente para el debriefing"/><button onClick={() => command('incident', { note: incident, riskDelta: 5 })} disabled={busy || !incident.trim()}>Lanzar</button></div>}</div>}
          {state.status === 'complete' && <div className="notice success">Simulación finalizada. Revisa el informe de desempeño.</div>}
        </section><aside className="right-column"><section className="panel metrics"><span className="eyebrow">ESTADO DE LA NEGOCIACIÓN</span><Meter label="Relación" value={state.meters.relationship}/><Meter label="Margen" value={state.meters.margin}/><Meter label="Riesgo" value={state.meters.risk} danger/></section><section className="panel report"><span className="eyebrow">PERFORMANCE REPORT</span><div className="score">{payload?.report.score}<small>/100</small></div><div className="report-grid"><div><strong>{payload?.report.decisions}</strong><span>Decisiones</span></div><div><strong>{payload?.report.objectivesMet}/{payload?.report.objectivesTotal}</strong><span>Objetivos</span></div><div><strong>{((payload?.report.avgReactionMs ?? 0) / 1000).toFixed(1)}s</strong><span>Tiempo medio</span></div><div><strong>{payload?.report.participants}</strong><span>Participantes</span></div></div><p>Puntuación basada en relación, margen y riesgo observables.</p></section></aside></div>
        <section className="panel timeline"><div className="section-heading"><span className="eyebrow">CRONOLOGÍA DE EVENTOS</span><span>{state.events.length} eventos</span></div><div className="events">{[...state.events].reverse().map((event: SimEvent) => <div className="event" key={event.seq}><span className="event-seq">{String(event.seq).padStart(2, '0')}</span><div><strong>{eventLabel(event.type)}</strong><small>{new Date(event.at).toLocaleTimeString('es-ES')} · {event.actorId}</small></div><span>{typeof event.detail.optionId === 'string' ? event.detail.optionId : ''}</span></div>)}</div></section>
      </>}
    </main>
  </div>;
}

function Meter({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) { return <div className="meter"><div><span>{label}</span><strong>{value}</strong></div><div className="track"><span className={danger ? 'danger' : ''} style={{ width: `${value}%` }}/></div></div>; }
function eventLabel(type: string): string { return ({ session_started: 'Sesión iniciada', participant_joined: 'Participante unido', decision: 'Decisión tomada', phase_advanced: 'Fase avanzada', paused: 'Sesión pausada', resumed: 'Sesión reanudada', incident: 'Incidente', completed: 'Sesión finalizada' } as Record<string, string>)[type] ?? type; }

createRoot(document.getElementById('root')!).render(<React.StrictMode><App/></React.StrictMode>);
