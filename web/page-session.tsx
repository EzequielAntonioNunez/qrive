/**
 * Detalle de sesión. Docente: cabecera fija con nombre editable, barra de acciones según el estado y pestañas
 * (En directo, Participantes, Informe); ?vista=directo abre el modo proyector. Participante: su vista filtrada.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { meterLabels, type MeterName } from '../shared/simulation';
import { isMine, simulatorUrl, titleOf, useApp, useSessionActions, type ApiError } from './app-context';
import { brand } from './brand';
import { ActionMenu, EmptyState, Icon, PageHeader, StatusPill, type MenuItem } from './kit';
import { useLiveSession } from './live';
import { ProjectorView } from './projector';
import { JoinShare } from './share-qr';
import { Link, navigate, setQuery, useLocation } from './router';
import {
  Debrief, EventsPanel, KpiStrip, LiveDistribution, Meter, NextStep, ParticipantsTab, PhaseSteps, ReportPanel, SessionSkeleton,
  downloadCsv, participantResultsOf
} from './session-blocks';
import { sessionMenu } from './session-menu';
import { classReport, simulatedIds, tallyFor, withoutParticipants, type Tally } from './stats';
import { METERS, errorText, optionLetter, pct, plural, relativeDate, signed, type Report, type SessionPayload, type SessionSummary } from './types';
import { CountUp, LiveBadge, Timer, useToast } from './ui';

const INCIDENT_DELTAS = [-10, -5, 5, 10, 15] as const;
const DEMO_CLASS_SIZE = 20;
type Tab = 'directo' | 'participantes' | 'informe';

export function SessionPage({ id }: { id: string }) {
  const app = useApp();
  const toast = useToast();
  const actions = useSessionActions();
  const { query } = useLocation();
  const vista = query.get('vista');
  const projecting = vista === 'directo';
  const tab: Tab = vista === 'participantes' || vista === 'informe' ? vista : 'directo';
  const [gone, setGone] = useState<'deleted' | 'missing' | null>(null);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [excludeSimulated, setExcludeSimulated] = useState(false);
  const [demoClassBusy, setDemoClassBusy] = useState(false);
  const [incident, setIncident] = useState('');
  const [incidentDelta, setIncidentDelta] = useState<number>(5);
  const [meter, setMeter] = useState<MeterName>('relationship');
  const [meterValue, setMeterValue] = useState(50);

  const fetchSession = useCallback((sessionId: string) => app.api<SessionPayload>(`/sessions/${encodeURIComponent(sessionId)}`), [app.api]);
  const onError = useCallback((cause: unknown) => {
    const status = (cause as ApiError).status;
    if (status === 404 || status === 403) setGone('missing');
    else setLoadError('No se ha podido actualizar la sesión. Reintentando automáticamente…');
  }, []);
  const onGone = useCallback(() => setGone('deleted'), []);
  const socket = app.realtime && !app.standalone && !(app.demo && !app.isInstructor);
  const live = useLiveSession<SessionPayload>(gone ? null : id, { fetchSession, socket, onError, onGone });
  const payload = live.data;
  useEffect(() => { if (payload) setLoadError(''); }, [payload]);
  useEffect(() => { setGone(null); setExcludeSimulated(false); }, [id]);
  useEffect(() => { const tick = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(tick); }, []);

  const state = payload?.state;
  const serverReport = payload?.report;
  const isInstructor = app.isInstructor;
  const simIds = useMemo(() => state && isInstructor ? simulatedIds(state) : new Set<string>(), [state, isInstructor]);
  const excluded = excludeSimulated && simIds.size > 0 ? simIds : undefined;
  const statsState = useMemo(() => state && excluded ? withoutParticipants(state, excluded) : state, [state, excluded]);
  const report = useMemo<Report | undefined>(() => {
    if (!statsState || !serverReport) return serverReport;
    if (excluded || (isInstructor && simIds.size > 0)) return classReport(statsState);
    return serverReport;
  }, [statsState, serverReport, excluded, isInstructor, simIds]);

  const listed = app.sessions?.find(item => item.id === id);
  const summary: SessionSummary | null = state ? { ...listed, id, status: state.status, createdAt: state.createdAt, scenarioId: state.scenario.id, scenarioTitle: state.scenario.title, name: listed?.name ?? null, phaseIndex: state.phaseIndex, phaseCount: state.scenario.phases.length, instructorId: state.instructorId } : listed ?? null;
  const title = summary ? titleOf(summary, app.scenarios) : 'Sesión';

  useEffect(() => { if (gone) document.title = `Sesión no disponible · ${brand.product} · ${brand.shortName}`; }, [gone]);
  useEffect(() => {
    if (!state) return;
    document.title = tab === 'informe' ? `Informe de impacto · ${title} · ${brand.shortName}` : `${title} · ${brand.product} · ${brand.shortName}`;
  }, [title, tab, !!state]);

  if (gone) return <div className="page"><PageHeader title={gone === 'deleted' ? 'Esta sesión se ha eliminado' : 'Sesión no disponible'} crumbs={[{ label: app.isInstructor ? 'Sesiones' : 'Mis sesiones', to: app.isInstructor ? '/sesiones' : '/' }, { label: 'Sesión' }]}/>
    <div className="card"><EmptyState icon="sessions" title={gone === 'deleted' ? 'Ya no existe' : 'No encontramos esta sesión'} action={<button className="btn btn-primary" onClick={() => navigate(app.isInstructor ? '/sesiones' : '/')}><Icon name="back" size={16}/>{app.isInstructor ? 'Volver a sesiones' : 'Volver a mis sesiones'}</button>}>
      {gone === 'deleted' ? 'Quien la creó la ha eliminado junto con sus decisiones y su informe.' : 'Puede que se haya eliminado o que el enlace no sea correcto.'}</EmptyState></div></div>;
  if (!state || !report || !summary) return <div className="page">{loadError && <div className="error" role="alert">{loadError}</div>}<SessionSkeleton instructor={isInstructor}/></div>;

  const phase = state.scenario.phases[state.phaseIndex];
  const remainingMs = state.phaseDeadline ? Math.max(0, Date.parse(state.phaseDeadline) - now) : state.phaseRemainingMs ?? null;
  const phaseExpired = !!phase && state.events.some(event => event.type === 'timer_expired' && event.detail.phaseId === phase.id);
  const canControl = isInstructor && app.identity.id === state.instructorId;
  const mine = isInstructor && (canControl || isMine(summary, app.identity));
  const labels = meterLabels(state.scenario);
  const characterName = state.scenario.character?.name || 'VictorIA';
  const participantResults = participantResultsOf(report);
  const tally: Tally = statsState ? tallyFor(statsState, phase, excluded ? undefined : payload?.liveTally, undefined) : { counts: [], decided: 0, total: 0 };
  const phaseVotes = state.decisions.filter(decision => decision.phaseId === phase?.id).length;
  const lastPhase = state.phaseIndex === state.scenario.phases.length - 1;
  const simCount = simIds.size;
  const link = simulatorUrl(state.id, app.demo);
  const unitySeen = payload?.clients?.unity ? Date.parse(payload.clients.unity) : null;
  const unityOnline = unitySeen !== null && now - unitySeen < 6000;

  async function command(type: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const result = await app.api<SessionPayload>(`/sessions/${encodeURIComponent(id)}/commands`, { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), type, ...extra }) });
      live.replace(result);
      if (type === 'incident') setIncident('');
      const messages: Record<string, string> = { advance: 'Nueva situación abierta', pause: 'Sesión en pausa', resume: 'Sesión reanudada', complete: 'Sesión finalizada. El informe ya está disponible.', incident: 'Incidente lanzado a la clase', 'set-meter': 'Indicador ajustado', join: 'Te has unido a la sesión', decide: 'Decisión registrada' };
      if (messages[type]) toast(messages[type]);
      if (['advance', 'pause', 'resume', 'complete'].includes(type)) void app.reloadSessions();
    } catch (cause) { toast(errorText(cause), 'error'); } finally { setBusy(false); }
  }
  async function finish() {
    const result = await actions.finish(summary!, { pendingPhases: state!.scenario.phases.length - state!.phaseIndex - 1, pendingPeople: Math.max(0, tally.total - tally.decided) });
    if (result) live.replace(result);
  }
  async function demoClass(add: boolean) {
    setDemoClassBusy(true);
    try {
      const result = await app.api<Partial<SessionPayload> & { demoClass?: { added?: number; removed?: number } }>(`/sessions/${encodeURIComponent(id)}/demo-class`, add ? { method: 'POST', body: JSON.stringify({ count: DEMO_CLASS_SIZE }) } : { method: 'DELETE' });
      if (result.state && result.report) live.replace(result as SessionPayload); else await live.reload();
      const added = result.demoClass?.added ?? DEMO_CLASS_SIZE;
      toast(add ? `${plural(added, 'participante simulado incorporado', 'participantes simulados incorporados')}. Irán decidiendo en los próximos segundos.` : `${plural(result.demoClass?.removed ?? simCount, 'participante simulado retirado', 'participantes simulados retirados')}`);
      void app.reloadSessions();
    } catch (cause) {
      const status = (cause as ApiError).status;
      toast(status === 404 || status === 405 || status === 501 ? '«Simular clase» aún no está disponible en este servidor.' : `No se ha podido ${add ? 'simular la clase' : 'retirar la clase simulada'}: ${errorText(cause)}`, status === 404 ? 'info' : 'error');
    } finally { setDemoClassBusy(false); }
  }
  function project() {
    if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined);
    setQuery({ vista: 'directo' });
  }
  function closeProjector() {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    setQuery({ vista: null });
  }

  /* ---------- Participante ---------- */
  if (!isInstructor) return <ParticipantSession state={state} report={report} title={state.scenario.title} busy={busy} link={link} standalone={app.standalone} characterName={characterName} identityId={app.identity.id} timersOn={app.timersOn} remainingMs={remainingMs} phaseExpired={phaseExpired} onCommand={command} mode={live.mode}/>;

  /* ---------- Docente ---------- */
  const status = state.status;
  const moreItems: MenuItem[] = [
    { label: 'Proyectar en clase', icon: 'project', onSelect: project, className: 'show-sm-flex' },
    ...(status !== 'complete' ? [{ label: 'Copiar enlace para participantes', icon: 'link', onSelect: () => void actions.copyLink(id), className: 'show-sm-flex' } as MenuItem] : []),
    ...(canControl && status !== 'complete' ? [{ label: simCount > 0 ? 'Quitar simulados' : `Simular clase (${DEMO_CLASS_SIZE})`, icon: 'sim', onSelect: () => void demoClass(simCount === 0), disabled: demoClassBusy, className: 'show-sm-flex' } as MenuItem] : []),
    ...sessionMenu(summary, actions, { mine, standalone: app.standalone, omit: ['open', 'project', 'copy', 'pause', 'resume', 'finish', 'report'], afterDelete: () => navigate('/sesiones') })
  ];
  const headerActions = <div className="action-bar" role="toolbar" aria-label="Acciones de la sesión">
    {canControl && status === 'active' && !lastPhase && <button className="btn btn-primary" onClick={() => void command('advance')} disabled={busy || phaseVotes === 0} title={phaseVotes === 0 ? 'Necesitas al menos una decisión para avanzar.' : undefined}>Siguiente situación<Icon name="next" size={16}/></button>}
    {canControl && status === 'active' && lastPhase && <button className="btn btn-primary" onClick={() => void finish()} disabled={busy}><Icon name="stop" size={16}/>Finalizar sesión</button>}
    {canControl && status === 'paused' && <button className="btn btn-primary" onClick={() => void command('resume')} disabled={busy}><Icon name="play" size={16}/>Reanudar</button>}
    {status === 'complete' && tab !== 'informe' && <button className="btn btn-primary" onClick={() => setQuery({ vista: 'informe' })}><Icon name="report" size={16}/>Ver informe</button>}
    {status === 'complete' && <button className="btn" onClick={() => void actions.duplicate(summary)}><Icon name="copy" size={16}/>Duplicar</button>}
    {canControl && status === 'active' && <button className="btn" onClick={() => void command('pause')} disabled={busy}><Icon name="pause" size={16}/>Pausar</button>}
    {canControl && status !== 'complete' && !(status === 'active' && lastPhase) && <button className="btn" onClick={() => void finish()} disabled={busy}><Icon name="stop" size={16}/>Finalizar</button>}
    <span className="action-sep hide-sm" aria-hidden="true"/>
    <button className="btn btn-quiet hide-sm" onClick={project}><Icon name="project" size={16}/>Proyectar</button>
    {status !== 'complete' && <button className="btn btn-quiet hide-sm" onClick={() => void actions.copyLink(id)}><Icon name="link" size={16}/>Copiar enlace</button>}
    {canControl && status !== 'complete' && <button className="btn btn-quiet hide-sm" onClick={() => void demoClass(simCount === 0)} disabled={demoClassBusy}><Icon name="sim" size={16}/>{demoClassBusy ? 'Un momento…' : simCount > 0 ? 'Quitar simulados' : 'Simular clase'}</button>}
    <ActionMenu items={moreItems} buttonLabel="Más" label="Más acciones de la sesión" className="btn-quiet"/>
  </div>;

  return <div className={`page session-page ${tab === 'informe' ? 'printing-report' : ''}`}>
    <div className="session-head">
      <PageHeader crumbs={[{ label: 'Sesiones', to: '/sesiones' }, { label: title }]}
        title={<InlineName value={summary.name ?? ''} display={title} canEdit={mine} onSave={async name => { await renameInline(name); }}/>}
        description={<span className="head-meta"><StatusPill status={status}/>{status !== 'complete' && (live.mode === 'reconnecting' || !!loadError) && <LiveBadge mode="reconnecting"/>}<span className="head-meta-text">{state.scenario.title}{' · '}Creada {relativeDate(state.createdAt)}{!canControl && summary.instructorName ? ` · De ${summary.instructorName}` : ''}</span></span>}/>
      {headerActions}
      <nav className="tabs" aria-label="Secciones de la sesión">
        {([['directo', 'En directo'], ['participantes', 'Participantes'], ['informe', status === 'complete' ? 'Informe' : 'Informe provisional']] as const).map(([key, label]) =>
          <Link key={key} to={`/sesiones/${id}${key === 'directo' ? '' : `?vista=${key}`}`} className="tab" aria-current={tab === key ? 'page' : undefined} onClick={event => { event.preventDefault(); setQuery({ vista: key === 'directo' ? null : key }, { replace: true }); }}>{label}{key === 'participantes' && <span className="tab-count">{state.participants.length}</span>}</Link>)}
      </nav>
    </div>
    {!canControl &&<p className="notice-inline">Esta sesión la conduce {summary.instructorName ?? 'otro docente'}. Puedes seguirla y consultar su informe, pero no controlarla.</p>}

    {tab === 'directo' && <div className="tab-panel">
      <KpiStrip state={state} report={report} tally={tally} remainingMs={remainingMs} phaseExpired={phaseExpired} timersOn={app.timersOn} simCount={excluded ? 0 : simCount}/>
      <PhaseSteps state={state}/>
      {canControl && <NextStep state={state} tally={tally} phaseVotes={phaseVotes} lastPhase={lastPhase} busy={busy} onCommand={type => type === 'complete' ? void finish() : void command(type)} onReport={() => setQuery({ vista: 'informe' })} onProject={project} onCopy={() => void actions.copyLink(id)}/>}
      <div className="grid">
        <section className="panel scene" aria-labelledby="phase-title">
          <div className="panel-top"><span className="eyebrow">Situación {state.phaseIndex + 1} de {state.scenario.phases.length}</span>{app.timersOn && <Timer remainingMs={remainingMs} expired={phaseExpired} paused={status === 'paused'} limitSec={phase?.timeLimitSec} complete={status === 'complete'}/>}</div>
          <h3 id="phase-title" key={phase?.id}>{phase?.title}</h3><p className="briefing">{phase?.briefing}</p>
          <div className="experience">
            <div className="experience-head"><span className="eyebrow">{characterName}</span>{!app.standalone && <span className={`presence ${unityOnline ? 'online' : ''}`}><i/>{unityOnline ? 'Simulador abierto' : 'Simulador sin actividad'}</span>}</div>
            {phase?.characterLine && <blockquote>«{phase.characterLine}»</blockquote>}
            {status !== 'complete' && <div className="simulator-link"><span className="eyebrow">Simulador 3D en el ordenador</span><div><input readOnly aria-label="Enlace del simulador" value={link} onFocus={event => event.currentTarget.select()}/><button type="button" onClick={() => void actions.copyLink(id)}>Copiar enlace</button>{!app.standalone && <a className="primary" href={link} target="_blank" rel="noopener">Abrir simulador</a>}</div><small>Experiencia inmersiva con VictorIA en el navegador, sin instalar nada. Cada participante entra con su correo y su código personal. Para unirse desde el móvil sin cuenta, usa el QR de abajo.</small></div>}
            {status !== 'complete' && <div className="session-join"><JoinShare api={app.api} sessionId={id} variant="card" canRegenerate={canControl}/></div>}
          </div>
          {phase && <LiveDistribution phase={phase} tally={tally} closed={status === 'complete'}/>}
          {canControl && status !== 'complete' && <details className="advanced"><summary>Herramientas del docente</summary>
            <label className="field-label" htmlFor="incident-text">Lanzar un incidente</label>
            <div className="incident"><input id="incident-text" value={incident} onChange={event => setIncident(event.target.value)} maxLength={200} aria-describedby="incident-hint" placeholder="Ej.: Un estudiante pregunta si puede usar IA en el examen"/><select value={incidentDelta} onChange={event => setIncidentDelta(Number(event.target.value))} aria-label={`Efecto en ${labels.risk}`}>{INCIDENT_DELTAS.map(delta => <option key={delta} value={delta}>{labels.risk} {signed(delta)}</option>)}</select><button onClick={() => void command('incident', { note: incident.trim(), riskDelta: incidentDelta })} disabled={busy || !incident.trim()}>Lanzar</button></div>
            <small className="field-hint" id="incident-hint">Afecta a toda la clase. No incluyas nombres ni datos personales.</small>
            <label className="field-label" htmlFor="meter-select">Ajustar un indicador de la clase</label>
            <div className="meter-control"><select id="meter-select" value={meter} onChange={event => { const next = event.target.value as MeterName; setMeter(next); setMeterValue(state.meters[next]); }}>{METERS.map(name => <option key={name} value={name}>{labels[name]}</option>)}</select><input type="number" min="0" max="100" step="1" aria-label="Nuevo valor" value={meterValue} onChange={event => setMeterValue(Number(event.target.value))}/><button onClick={() => void command('set-meter', { meter, value: meterValue })} disabled={busy || !Number.isInteger(meterValue) || meterValue < 0 || meterValue > 100 || meterValue === state.meters[meter]}>Aplicar</button></div>
          </details>}
        </section>
        <aside className="right-column">
          <section className="panel metrics"><div className="section-heading"><span className="eyebrow">Indicadores de la clase</span><small className="muted">Media</small></div>
            {METERS.map(name => <Meter key={name} label={labels[name]} value={(report.meters ?? state.meters)[name]} initial={state.scenario.initialMeters[name]} danger={name === 'risk'}/>)}</section>
          <section className="panel report"><span className="eyebrow">Resultados de la clase</span><div className="score">{report.decisions > 0 ? <><CountUp value={report.score}/><small>/100</small></> : <span className="score-empty">Sin decisiones todavía</span>}</div>
            <div className="report-grid"><div><strong>{pct(report.correctDecisionsPct)}</strong><span>Decisiones óptimas</span></div><div><strong>{report.criticalDecisions ?? 0}</strong><span>Decisiones críticas</span></div><div><strong>{report.objectivesMet}/{report.objectivesTotal}</strong><span>Objetivos alcanzados</span></div><div><strong>{report.decisions}</strong><span>Decisiones</span></div></div>
            <p>Puntuación de 0 a 100 con los indicadores del escenario. Valora decisiones, no personas.</p></section>
          <p className="ai-notice" role="note"><span aria-hidden="true">i</span><span><strong>{characterName} es un personaje virtual.</strong> {state.scenario.origin?.kind === 'ai' ? 'Escenario redactado con IA a partir de documentos y revisado por un docente antes de publicarse.' : 'Imagen y voz sintéticas, intervenciones guionizadas.'} No se infieren emociones ni estados psicológicos.</span></p>
        </aside>
      </div>
      {report.timeline.length > 0 && <Debrief state={state} report={report} instructor onCsv={() => downloadCsv(state, report)} participantName={userId => state.participants.find(person => person.userId === userId)?.name ?? 'Participante'}/>}
      <EventsPanel state={state}/>
    </div>}

    {tab === 'participantes' && <div className="tab-panel"><ParticipantsTab state={state} results={participantResults} simCount={simCount} excludeSimulated={!!excluded} onToggle={() => setExcludeSimulated(value => !value)} onCopy={status !== 'complete' ? () => void actions.copyLink(id) : undefined} onManage={() => navigate('/participantes')}/></div>}

    {tab === 'informe' && <div className="tab-panel"><ReportPanel state={statsState!} report={report} results={participantResults} simulatedCount={simCount} excludeSimulated={!!excluded} onToggleSimulated={() => setExcludeSimulated(value => !value)} sessionName={summary.name ?? undefined}/></div>}

    {projecting && <ProjectorView state={state} liveTally={payload?.liveTally} remainingMs={remainingMs} phaseExpired={phaseExpired} mode={live.mode} standalone={app.standalone} canControl={canControl} busy={busy} exclude={excluded} api={app.api} onClose={closeProjector} onCommand={type => type === 'complete' ? void command('complete') : void command(type)}/>}
  </div>;

  async function renameInline(name: string) {
    const previous = summary!.name ?? null;
    app.updateSession(id, { name });
    try {
      const result = await app.api<{ session?: SessionSummary }>(`/sessions/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name }) });
      if (result.session) app.updateSession(id, result.session);
      toast('Nombre actualizado');
    } catch (cause) {
      app.updateSession(id, { name: previous });
      const status = (cause as ApiError).status;
      toast(status === 405 ? 'Renombrar aún no está disponible en este servidor.' : `No se ha podido renombrar: ${errorText(cause)}`, 'error');
      throw cause;
    }
  }
}

/** Nombre editable en el sitio: botón con lápiz → campo; Intro guarda y Esc cancela. */
function InlineName({ value, display, canEdit, onSave }: { value: string; display: string; canEdit: boolean; onSave: (name: string) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (editing) { input.current?.focus(); input.current?.select(); } }, [editing]);
  if (!canEdit) return <>{display}</>;
  if (!editing) return <span className="inline-name">{display}<button ref={trigger} type="button" className="icon-button" aria-label="Renombrar la sesión" title="Renombrar" onClick={() => { setDraft(value || display); setEditing(true); }}><Icon name="edit" size={16}/></button></span>;
  const stop = () => { setEditing(false); window.setTimeout(() => trigger.current?.focus(), 0); };
  async function save() {
    const name = draft.trim();
    if (!name || name === value) { stop(); return; }
    setSaving(true);
    try { await onSave(name); stop(); } catch { /* el aviso ya se mostró */ } finally { setSaving(false); }
  }
  return <form className="inline-edit" onSubmit={event => { event.preventDefault(); void save(); }}>
    <input ref={input} value={draft} maxLength={80} aria-label="Nombre de la sesión" onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') { event.preventDefault(); stop(); } }} disabled={saving}/>
    <button className="btn btn-primary btn-sm" disabled={saving || !draft.trim()}>Guardar</button><button type="button" className="btn btn-sm" onClick={stop}>Cancelar</button>
  </form>;
}

/* ---------- Vista del participante ---------- */

function ParticipantSession({ state, report, title, busy, link, standalone, characterName, identityId, timersOn, remainingMs, phaseExpired, onCommand, mode }: {
  state: SessionPayload['state']; report: Report; title: string; busy: boolean; link: string; standalone: boolean; characterName: string; identityId: string;
  timersOn: boolean; remainingMs: number | null; phaseExpired: boolean; onCommand: (type: string, extra?: Record<string, unknown>) => Promise<void>; mode: ReturnType<typeof useLiveSession>['mode'];
}) {
  const phase = state.scenario.phases[state.phaseIndex];
  const hasJoined = state.participants.some(person => person.userId === identityId);
  const myDecision = state.decisions.find(decision => decision.userId === identityId && decision.phaseId === phase?.id);
  const labels = meterLabels(state.scenario);
  return <div className="page">
    <PageHeader crumbs={[{ label: 'Mis sesiones', to: '/' }, { label: title }]} title={title}
      description={<span className="head-meta"><StatusPill status={state.status}/>{state.status !== 'complete' && mode === 'reconnecting' && <LiveBadge mode={mode} standalone={standalone}/>}<span>{plural(state.scenario.phases.length, 'situación', 'situaciones')}</span></span>}
      actions={state.status !== 'complete' && !standalone ? <a className="btn btn-primary" href={link}><Icon name="external" size={16}/>Abrir simulador</a> : undefined}/>
    <div className="grid">
      <section className="panel scene" aria-labelledby="phase-title">
        <div className="panel-top"><span className="eyebrow">Situación {state.phaseIndex + 1} de {state.scenario.phases.length}</span><span className="phase-line" aria-hidden="true"><i style={{ width: `${((state.phaseIndex + 1) / state.scenario.phases.length) * 100}%` }}/></span>{timersOn && <Timer remainingMs={remainingMs} expired={phaseExpired} paused={state.status === 'paused'} limitSec={phase?.timeLimitSec} complete={state.status === 'complete'}/>}</div>
        <h3 id="phase-title" key={phase?.id}>{phase?.title}</h3><p className="briefing">{phase?.briefing}</p>
        <div className="experience"><div className="experience-head"><span className="eyebrow">{characterName}</span></div>{phase?.characterLine && <blockquote>«{phase.characterLine}»</blockquote>}</div>
        {state.status !== 'complete' && !hasJoined && <div className="join-box"><p>Únete para ver las opciones y decidir. Tu progreso es individual: tus compañeros no ven tus respuestas.</p><button className="btn btn-primary" onClick={() => void onCommand('join')} disabled={busy}>{busy ? 'Uniéndote…' : 'Unirme a la sesión'}</button></div>}
        {hasJoined && !myDecision && state.status === 'active' && <div className="options" role="group" aria-label="Opciones de esta situación">{phase?.options.map((option, i) => <button key={option.id} onClick={() => void onCommand('decide', { optionId: option.id })} disabled={busy}><span className="option-letter" aria-hidden="true">{optionLetter(i)}</span><strong>{option.label}</strong><span>Elegir</span></button>)}</div>}
        {hasJoined && !myDecision && state.status === 'paused' && <div className="notice">La sesión está en pausa. Podrás decidir en cuanto tu docente la reanude.</div>}
        {myDecision && state.status !== 'complete' && <div className="notice" role="status"><strong>Decisión registrada.</strong> {phase?.options.find(option => option.id === myDecision.optionId)?.consequence} La siguiente situación aparecerá aquí cuando tu docente la abra.</div>}
        {state.status === 'complete' && <div className="notice success">Sesión finalizada. Abajo tienes tus resultados y las ideas clave de cada situación.</div>}
      </section>
      <aside className="right-column">
        <section className="panel metrics"><span className="eyebrow">Tus indicadores</span>{METERS.map(name => <Meter key={name} label={labels[name]} value={(report.meters ?? state.meters)[name]} initial={state.scenario.initialMeters[name]} danger={name === 'risk'}/>)}</section>
        <section className="panel report"><span className="eyebrow">Tus resultados</span><div className="score">{report.decisions > 0 ? <><CountUp value={report.score}/><small>/100</small></> : <span className="score-empty">Aún no has decidido</span>}</div>
          <div className="report-grid"><div><strong>{pct(report.correctDecisionsPct)}</strong><span>Decisiones óptimas</span></div><div><strong>{report.decisions}</strong><span>Decisiones</span></div></div>
          <p>Valora tus decisiones en el escenario, nunca a ti como persona.</p></section>
        <p className="ai-notice" role="note"><span aria-hidden="true">i</span><span><strong>{characterName} es un personaje virtual.</strong> Su imagen y su voz son sintéticas y sus intervenciones están guionizadas.</span></p>
      </aside>
    </div>
    {state.status === 'complete' && report.timeline.length > 0 && <Debrief state={state} report={report} instructor={false} participantName={() => 'Tú'}/>}
  </div>;
}
