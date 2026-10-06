/** Bloques del detalle de sesión: indicadores clave, cronología, siguiente paso, votación en directo, participantes, debate e informe. */
import React, { useMemo, useState } from 'react';
import type { Phase, SessionState, SimEvent } from '../shared/simulation';
import { download } from './app-context';
import { EmptyState, Icon, SearchField } from './kit';
import { ImpactReport } from './report';
import { share, type Tally } from './stats';
import {
  actorLabel, eventLabel, formatClock, optionLetter, pct, plural, qualityLabel, relativeDate, signed,
  type ParticipantResult, type Person, type Report, type TimelineEntry
} from './types';
import { Bar, CountUp, Sk } from './ui';

export function KpiStrip({ state, report, tally, remainingMs, phaseExpired, timersOn, simCount }: { state: SessionState; report: Report; tally: Tally; remainingMs: number | null; phaseExpired: boolean; timersOn: boolean; simCount: number }) {
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
    <div className="kpi"><span className="kpi-label">Participantes</span><strong className="kpi-value"><CountUp value={state.participants.length}/></strong><span className="kpi-sub">{state.participants.length === 0 ? 'Esperando al primero' : simCount ? `${plural(simCount, 'simulado', 'simulados')} incluidos` : 'en la sesión'}</span></div>
    {complete
      ? <div className="kpi"><span className="kpi-label">Decisiones óptimas</span><strong className="kpi-value">{report.correctDecisionsPct == null ? '—' : <CountUp value={report.correctDecisionsPct} suffix=" %"/>}</strong><span className="kpi-sub">{plural(report.decisions, 'decisión', 'decisiones')} en total</span></div>
      : <div className="kpi"><span className="kpi-label">Han decidido</span><strong className="kpi-value"><CountUp value={decidedPct} suffix=" %"/></strong><span className="kpi-sub">{tally.decided} de {tally.total} en la situación {state.phaseIndex + 1}</span><Bar value={decidedPct} tone="sky" label={`${decidedPct} % ha decidido`}/></div>}
    {complete
      ? <div className="kpi"><span className="kpi-label">Puntuación de la clase</span><strong className="kpi-value"><CountUp value={report.score}/><small>/100</small></strong><span className="kpi-sub">Media de los indicadores</span></div>
      : <div className={`kpi ${remainingMs != null && remainingMs < 60000 && !phaseExpired && state.status === 'active' ? 'urgent' : ''}`}><span className="kpi-label">Tiempo restante</span><strong className="kpi-value tabular">{time.value}</strong><span className="kpi-sub">{time.sub}</span></div>}
    <div className="kpi"><span className="kpi-label">Progreso</span><strong className="kpi-value">{done}<small>/{total}</small></strong><span className="kpi-sub">{complete ? 'Todas las situaciones cerradas' : 'situaciones cerradas'}</span><span className="segments" aria-hidden="true">{state.scenario.phases.map((item, i) => <i key={item.id} className={complete || i < state.phaseIndex ? 'done' : i === state.phaseIndex ? 'current' : ''}/>)}</span></div>
  </section>;
}

export function PhaseSteps({ state }: { state: SessionState }) {
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

export function NextStep({ state, tally, phaseVotes, lastPhase, busy, onCommand, onReport, onProject, onCopy }: { state: SessionState; tally: Tally; phaseVotes: number; lastPhase: boolean; busy: boolean; onCommand: (type: 'advance' | 'complete' | 'resume') => void; onReport: () => void; onProject: () => void; onCopy?: () => void }) {
  const pending = Math.max(0, tally.total - tally.decided);
  let text: string; let action: React.ReactNode = null;
  if (state.status === 'complete') { text = 'La sesión ha terminado. Comenta las ideas clave con el grupo y descarga el informe de impacto.'; action = <button className="btn btn-primary" onClick={onReport}>Ver informe</button>; }
  else if (state.status === 'paused') { text = 'La sesión está en pausa: los participantes no pueden decidir y el tiempo está detenido.'; action = <button className="btn btn-primary" disabled={busy} onClick={() => onCommand('resume')}>Reanudar</button>; }
  else if (state.participants.length === 0) { text = 'Comparte el enlace con tu grupo. El tiempo de la primera situación empieza cuando se une el primer participante.'; action = onCopy ? <button className="btn btn-primary" onClick={onCopy}><Icon name="link" size={16}/>Copiar enlace</button> : null; }
  else if (phaseVotes === 0) { text = `Esperando la primera decisión de ${plural(tally.total, 'participante', 'participantes')}. Proyecta el panel en directo para seguir la votación con la clase.`; action = <button className="btn" onClick={onProject}><Icon name="project" size={16}/>Proyectar en clase</button>; }
  else if (pending > 0) { text = `Faltan ${plural(pending, 'participante', 'participantes')} por decidir. Puedes esperar o ${lastPhase ? 'finalizar la sesión' : 'abrir la siguiente situación'}: quien no decida conservará sus indicadores.`; }
  else { text = lastPhase ? 'Toda la clase ha decidido en la última situación. Finaliza la sesión para cerrar el informe.' : 'Toda la clase ha decidido. Comenta el resultado y abre la siguiente situación.'; action = <button className="btn btn-primary" disabled={busy} onClick={() => onCommand(lastPhase ? 'complete' : 'advance')}>{lastPhase ? 'Finalizar sesión' : 'Siguiente situación'}</button>; }
  return <div className="next-step" role="status" aria-live="polite"><span className="eyebrow">Siguiente paso</span><p>{text}</p>{action}</div>;
}

export function LiveDistribution({ phase, tally, closed }: { phase: Phase; tally: Tally; closed: boolean }) {
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

export function Meter({ label, value, initial, danger = false }: { label: string; value: number; initial: number; danger?: boolean }) {
  const delta = value - initial;
  const good = danger ? delta < 0 : delta > 0;
  return <div className="meter"><div><span>{label}{delta !== 0 && <em className={`delta ${good ? 'up' : 'down'}`} title={`Desde el valor inicial (${initial})`}>{signed(delta)}</em>}</span><strong><CountUp value={value}/></strong></div><Bar value={value} tone={danger ? 'danger' : 'navy'} label={`${label}: ${value} de 100`}/></div>;
}

/** Pestaña «Participantes»: estado en la situación actual, última actividad y resultados (valoran decisiones, no personas). */
export function ParticipantsTab({ state, results, simCount, excludeSimulated, onToggle, onCopy, onManage }: { state: SessionState; results: ParticipantResult[]; simCount: number; excludeSimulated: boolean; onToggle: () => void; onCopy?: () => void; onManage?: () => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'decided'>('all');
  const phase = state.scenario.phases[state.phaseIndex];
  const people = state.participants as Person[];
  const decidedNow = useMemo(() => new Set(state.decisions.filter(decision => decision.phaseId === phase?.id).map(decision => decision.userId)), [state, phase?.id]);
  const lastActivity = useMemo(() => {
    const map = new Map<string, string>();
    for (const person of people) map.set(person.userId, person.joinedAt);
    for (const decision of state.decisions) { const prev = map.get(decision.userId); if (!prev || decision.at > prev) map.set(decision.userId, decision.at); }
    return map;
  }, [state]);
  const complete = state.status === 'complete';
  const needle = query.trim().toLowerCase();
  const rows = people.filter(person => (!needle || person.name.toLowerCase().includes(needle))
    && (filter === 'all' || complete || (filter === 'decided' ? decidedNow.has(person.userId) : !decidedNow.has(person.userId))));
  const resultOf = (userId: string) => results.find(row => row.userId === userId);
  const pendingCount = people.filter(person => !decidedNow.has(person.userId)).length;

  if (people.length === 0) return <section className="card"><EmptyState icon="users" title="Aún no se ha unido nadie" action={<>{onCopy && <button className="btn btn-primary" onClick={onCopy}><Icon name="link" size={16}/>Copiar enlace para participantes</button>}{onManage && <button className="btn" onClick={onManage}>Gestionar accesos</button>}</>}>Comparte el enlace con tu grupo. Cada participante entra con su correo y su código personal; si alguien no tiene acceso, dale de alta en Participantes y accesos.</EmptyState></section>;

  return <section className="card" aria-labelledby="people-title">
    <div className="card-head wrap"><div><h2 id="people-title" className="card-title">{plural(people.length, 'participante', 'participantes')}</h2><p className="card-sub">{complete ? 'Sesión finalizada' : `Situación ${state.scenario.phases.length ? state.phaseIndex + 1 : 0}: ${people.length - pendingCount} han decidido · ${pendingCount} pendientes`}</p></div>
      {simCount > 0 && <label className="toggle"><input type="checkbox" checked={excludeSimulated} onChange={onToggle}/><span aria-hidden="true"/>Excluir simulados de las estadísticas</label>}</div>
    <div className="toolbar">
      <SearchField value={query} onChange={setQuery} placeholder="Buscar por nombre" label="Buscar participante"/>
      {!complete && <div className="chips" role="group" aria-label="Filtrar participantes">{([['all', 'Todos'], ['pending', 'Pendientes'], ['decided', 'Han decidido']] as const).map(([key, label]) => <button key={key} type="button" className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>{label}</button>)}</div>}
    </div>
    {rows.length === 0 ? <p className="empty-line">Ningún participante coincide con la búsqueda.</p>
    : <div className="table-wrap"><table className="table">
      <thead><tr><th scope="col">Participante</th><th scope="col">Situación actual</th><th scope="col">Última actividad</th><th scope="col" className="num">Puntuación</th><th scope="col" className="num hide-sm">Óptimas</th><th scope="col" className="num hide-sm">Críticas</th><th scope="col" className="num hide-sm">Decisiones</th></tr></thead>
      <tbody>{rows.map(person => { const row = resultOf(person.userId); const dimmed = excludeSimulated && person.simulated; return <tr key={person.userId} className={dimmed ? 'excluded' : ''}>
        <th scope="row"><span className="person"><span className="avatar" aria-hidden="true">{initials(person.name)}</span>{person.name}{person.simulated && <em className="tag-sim">Simulado</em>}</span></th>
        <td>{complete ? <span className="state-pill done">Completó</span> : decidedNow.has(person.userId) ? <span className="state-pill done">Decidió</span> : <span className="state-pill">Pendiente</span>}</td>
        <td className="muted-cell">{relativeDate(lastActivity.get(person.userId))}</td>
        <td className="num">{dimmed ? '—' : row?.score ?? '—'}</td><td className="num hide-sm">{dimmed ? '—' : pct(row?.correctDecisionsPct)}</td><td className="num hide-sm">{dimmed ? '—' : row?.criticalDecisions ?? '—'}</td><td className="num hide-sm">{dimmed ? '—' : row?.decisions ?? '—'}</td>
      </tr>; })}</tbody></table></div>}
    <p className="fine-print">Las puntuaciones valoran las decisiones tomadas en el escenario, nunca a las personas.</p>
  </section>;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '·';
}

/** Debriefing agrupado por situación. El docente ve cuántos eligieron cada opción; el participante, su propia decisión. */
export function Debrief({ state, report, instructor, onCsv, participantName }: { state: SessionState; report: Report; instructor: boolean; onCsv?: () => void; participantName: (userId: string) => string }) {
  const groups = groupByPhase(report.timeline);
  return <section className="card debrief"><div className="card-head"><div><h2 className="card-title">Qué se decidió y por qué</h2><p className="card-sub">Debate por situación</p></div>{onCsv && <button className="btn btn-quiet" onClick={onCsv}><Icon name="download" size={16}/>CSV</button>}</div>
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

export function EventsPanel({ state }: { state: SessionState }) {
  return <details className="card events-card"><summary><span className="card-title">Registro de actividad</span><small className="muted">{plural(state.events.length, 'evento', 'eventos')}</small></summary><div className="events">{[...state.events].reverse().slice(0, 150).map((event: SimEvent) => <div className="event" key={event.seq}><span className="event-seq">{String(event.seq).padStart(2, '0')}</span><div><strong>{eventLabel(event.type)}</strong><small>{new Date(event.at).toLocaleTimeString('es-ES')} · {actorLabel(event.actorId, state)}</small></div><span>{event.type === 'incident' && typeof event.detail.note === 'string' ? event.detail.note : ''}</span></div>)}</div></details>;
}

export function ReportPanel({ state, report, results, simulatedCount, excludeSimulated, onToggleSimulated, sessionName }: { state: SessionState; report: Report; results: ParticipantResult[]; simulatedCount: number; excludeSimulated: boolean; onToggleSimulated: () => void; sessionName?: string }) {
  return <div className="report-view">
    <div className="report-toolbar"><p className="report-hint">Para descargarlo, elige «Guardar como PDF» en el diálogo de impresión. Está maquetado para A4.</p><div>{simulatedCount > 0 && <label className="toggle"><input type="checkbox" checked={excludeSimulated} onChange={onToggleSimulated}/><span aria-hidden="true"/>Excluir simulados</label>}<button type="button" className="btn btn-primary" onClick={() => window.print()}><Icon name="download" size={16}/>Descargar PDF</button></div></div>
    <ImpactReport state={state} report={report} results={results} simulatedCount={simulatedCount} excludeSimulated={excludeSimulated} sessionName={sessionName}/>
  </div>;
}

/* ---------- Esqueleto de carga del detalle ---------- */

export function SessionSkeleton({ instructor }: { instructor: boolean }) {
  return <div aria-busy="true" aria-label="Cargando la sesión">
    <p className="sr-only" role="status">Cargando la sesión…</p>
    <div className="page-header"><Sk w={160} h={10}/><Sk w="min(460px, 80vw)" h={30} className="sk-gap"/><Sk w="min(320px, 70vw)" h={12} className="sk-gap"/></div>
    {instructor && <div className="action-bar"><Sk w={110} h={38}/><Sk w={160} h={38}/><Sk w={110} h={38}/></div>}
    {instructor && <section className="kpis">{[0, 1, 2, 3].map(i => <div className="kpi" key={i}><Sk w={90} h={10}/><Sk w={80} h={34} className="sk-gap"/><Sk w={130} h={10} className="sk-gap"/></div>)}</section>}
    <div className="grid">
      <section className="panel scene"><div className="panel-top"><Sk w={140} h={10}/><Sk w={72} h={30}/></div><Sk w="75%" h={32} className="sk-title"/><div className="sk-stack sk-paragraph"><Sk w="100%" h={14}/><Sk w="96%" h={14}/><Sk w="60%" h={14}/></div>
        <div className="distribution">{[0, 1, 2].map(i => <div className="dist-row" key={i}><Sk w={26} h={26}/><div className="dist-body"><Sk w="60%" h={12}/><Sk w="100%" h={8} className="sk-gap-s"/></div></div>)}</div></section>
      <aside className="right-column"><section className="panel metrics"><Sk w={150} h={10}/>{[0, 1, 2].map(i => <div className="meter" key={i}><div><Sk w={110} h={12}/><Sk w={28} h={20}/></div><Sk w="100%" h={6} className="sk-gap-s"/></div>)}</section></aside>
    </div>
  </div>;
}

/* ---------- Utilidades ---------- */

/** Resultados por participante: acepta `participants` como lista o, en su defecto, `participantReports`. */
export function participantResultsOf(report: Report): ParticipantResult[] {
  const list = Array.isArray(report.participants) ? report.participants : Array.isArray(report.participantReports) ? report.participantReports : [];
  return list.filter((row): row is ParticipantResult => !!row && typeof row.userId === 'string');
}
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
export function exportBaseName(state: SessionState): string {
  const scenario = state.scenario.id.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'escenario';
  const created = new Date(state.createdAt);
  const day = Number.isNaN(created.getTime()) ? new Date() : created;
  const date = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
  return `simulador-ufv-${scenario}-${date}`;
}
export function downloadCsv(state: SessionState, report: Report) {
  const quote = (value: string | number) => `"${String(value).replace(/"/g, '""')}"`;
  const rows = [['sesion', 'escenario', 'version', 'fase', 'participante', 'opcion', 'valoracion', 'segundos', 'tiempo_agotado', 'consecuencia', 'por_que', 'idea_clave'],
    ...report.timeline.map(entry => [state.id, state.scenario.id, state.scenario.version, entry.phaseTitle, state.participants.find(person => person.userId === entry.userId)?.name ?? entry.userId, entry.label, qualityLabel(entry.quality), Math.round(entry.durationMs / 1000), entry.timedOut ? 'si' : 'no', entry.consequence, entry.rationale ?? '', entry.takeaway ?? '']),
    [], ['puntuacion', report.score], ['decisiones_correctas_pct', report.correctDecisionsPct ?? ''], ['reaccion_pct', report.reactionPct ?? ''], ['objetivos_pct', report.objectivesPct], ['decisiones_criticas', report.criticalDecisions], ['tiempos_agotados', report.timeouts]];
  download(new Blob(['﻿' + rows.map(row => row.map(quote).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }), `${exportBaseName(state)}.csv`);
}
