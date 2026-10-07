/**
 * Analítica de la organización (/analitica) y franja resumen de Inicio. Solo agregados de GET /api/analytics:
 * nunca se ordena ni se etiqueta a personas; `quality` valora la opción elegida, no a quien la elige.
 * Gráficos hechos a mano en SVG/CSS (sin librerías), con resumen accesible y tabla alternativa.
 * Filtros en la URL: ?rango=30d|90d|12m|todo&escenario=<id>&simuladas=1.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useApp } from './app-context';
import { Icon, PageHeader, StatusPill } from './kit';
import { Link, navigate, setQuery, useLocation } from './router';
import { errorText, optionLetter, plural, qualityLabel, relativeDate } from './types';
import { prefersReducedMotion, Sk, useCountUp } from './ui';
import './analytics.css';

/* ---------- Contrato (refleja AnalyticsResponse de worker/analytics.ts) ---------- */

type Quality = 'best' | 'acceptable' | 'poor';
type MeterKey = 'relationship' | 'margin' | 'risk';
export interface AnalyticsResponse {
  range: { from: string; to: string };
  totals: {
    sessions: number; sessionsCompleted: number; sessionsActive: number;
    participants: number; simulatedParticipants: number; decisions: number;
    completionRate: number | null; optimalRate: number | null; avgDecisionSeconds: number | null;
  };
  trend: { week: string; sessions: number; participants: number; decisions: number; optimalRate: number | null }[];
  scenarios: { scenarioId: string; title: string; sessions: number; participants: number; decisions: number; optimalRate: number | null; completionRate: number | null }[];
  phases: {
    scenarioId: string; scenarioTitle: string; phaseId: string; phaseTitle: string; decisions: number; optimalRate: number | null;
    distribution: { optionId: string; label: string; quality: Quality | null; count: number; share: number }[];
    mostChosenNonOptimal: { optionId: string; label: string; share: number } | null;
  }[];
  meters: { scenarioId: string; meter: MeterKey; label: string; avgStart: number; avgEnd: number; delta: number }[];
  recentSessions: { id: string; name: string | null; scenarioTitle: string; status: string; createdAt: string; participants: number; optimalRate: number | null }[];
}

/* ---------- Filtros ---------- */

const RANGES = [
  { key: '30d', label: 'Últimos 30 días', short: '30 días', days: 30 },
  { key: '90d', label: 'Últimos 90 días', short: '90 días', days: 90 },
  { key: '12m', label: 'Últimos 12 meses', short: '12 meses', days: 365 },
  { key: 'todo', label: 'Todo', short: 'Todo', days: null }
] as const;
type RangeKey = typeof RANGES[number]['key'];
const DEFAULT_RANGE: RangeKey = '90d';

function dateOnly(date: Date): string { return date.toISOString().slice(0, 10); }
function analyticsPath(range: RangeKey, scenarioId: string | null, simulated: boolean): string {
  const params = new URLSearchParams();
  const days = RANGES.find(item => item.key === range)?.days;
  params.set('from', days == null ? '2020-01-01' : dateOnly(new Date(Date.now() - days * 86400000)));
  if (scenarioId) params.set('scenarioId', scenarioId);
  if (simulated) params.set('includeSimulated', 'true');
  return `/analytics?${params.toString()}`;
}

/** Carga de /api/analytics con el último resultado conservado mientras llega el siguiente (sin parpadeos). */
function useAnalytics(path: string) {
  const { api } = useApp();
  const [data, setData] = useState<AnalyticsResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const request = useRef(0);
  const load = useCallback(() => {
    const id = ++request.current;
    setLoading(true); setError('');
    api<AnalyticsResponse>(path)
      .then(result => { if (id === request.current) { setData(result); setLoading(false); } })
      .catch(cause => { if (id === request.current) { setError(errorText(cause)); setLoading(false); } });
  }, [api, path]);
  useEffect(() => { load(); }, [load]);
  return { data, error, loading, reload: load };
}

/* ---------- Formato ---------- */

const pctNumber = (rate: number) => Math.round(rate * 100);
const fmt = (value: number, decimals = 0) => value.toLocaleString('es-ES', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
function pctText(rate: number | null | undefined): string { return rate == null ? 'Sin datos aún' : `${pctNumber(rate)} %`; }
function secondsText(seconds: number): string {
  if (seconds < 60) return `${fmt(seconds, seconds < 10 ? 1 : 0)} s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} min ${String(Math.round(seconds % 60)).padStart(2, '0')} s`;
}
function weekLabel(week: string, long = false): string {
  const date = new Date(`${week}T00:00:00Z`);
  return date.toLocaleDateString('es-ES', { day: 'numeric', month: long ? 'long' : 'short', timeZone: 'UTC' }).replace('.', '');
}

/** Cifra que cuenta desde cero al aparecer y entre valores al filtrar (sin animación si se ha reducido el movimiento). */
function Count({ value, decimals = 0, suffix = '' }: { value: number; decimals?: number; suffix?: string }) {
  const [ready, setReady] = useState(prefersReducedMotion());
  useEffect(() => { setReady(true); }, []);
  const shown = useCountUp(ready ? value : 0, 900);
  return <>{fmt(shown, decimals)}{suffix}</>;
}

function NoData({ compact = false }: { compact?: boolean }) {
  return <span className={`an-nodata ${compact ? 'compact' : ''}`}>Sin datos aún</span>;
}

/* ---------- Página ---------- */

export function AnalyticsPage() {
  const app = useApp();
  const { query } = useLocation();
  const rangeParam = query.get('rango');
  const range: RangeKey = RANGES.some(item => item.key === rangeParam) ? rangeParam as RangeKey : DEFAULT_RANGE;
  const scenarioId = query.get('escenario') || null;
  const simulated = query.get('simuladas') === '1';
  const path = useMemo(() => analyticsPath(range, scenarioId, simulated), [range, scenarioId, simulated]);
  const { data, error, loading, reload } = useAnalytics(path);

  const orgEmpty = app.sessions?.length === 0;
  const filtered = range !== DEFAULT_RANGE || !!scenarioId || simulated;
  const scenarioOptions = useMemo(() => {
    const list = new Map<string, string>();
    for (const item of app.scenarios ?? []) list.set(item.id, item.title);
    for (const item of data?.scenarios ?? []) if (!list.has(item.scenarioId)) list.set(item.scenarioId, item.title);
    if (scenarioId && !list.has(scenarioId)) list.set(scenarioId, scenarioId);
    return [...list].sort((a, b) => a[1].localeCompare(b[1], 'es'));
  }, [app.scenarios, data?.scenarios, scenarioId]);

  const header = <PageHeader eyebrow="Organización" title="Analítica"
    description="Cómo decide la clase en conjunto: participación, decisiones óptimas y en qué situaciones conviene reforzar. Datos agregados; nunca valora a las personas."
    actions={!orgEmpty ? <button className="btn btn-primary" onClick={() => navigate('/sesiones/nueva')}><Icon name="plus" size={16}/>Nueva sesión</button> : undefined}>
    {!orgEmpty && <Filters range={range} scenarioId={scenarioId} simulated={simulated} options={scenarioOptions}/>}
  </PageHeader>;

  if (orgEmpty) return <div className="page an-page">{header}<EmptyAnalytics/></div>;

  const first = !data && loading;
  const busy = loading && !!data;
  return <div className="page an-page" aria-busy={loading || undefined}>
    {header}
    <p className="sr-only" role="status">{loading ? 'Cargando analítica…' : data ? `Analítica actualizada: ${plural(data.totals.sessions, 'sesión', 'sesiones')} en el periodo.` : ''}</p>
    {error && <div className="card an-error" role="alert"><span className="an-error-icon" aria-hidden="true">!</span><div><strong>No se ha podido cargar la analítica</strong><p>{error}</p></div><button className="btn" onClick={reload}>Reintentar</button></div>}
    {first ? <AnalyticsSkeleton/>
    : error && !loading ? null
    : data && data.totals.sessions === 0 ? <div className="card an-period-empty">
        <span className="an-period-icon" aria-hidden="true"><Icon name="chart" size={22}/></span>
        <h2>No hay sesiones en este periodo</h2>
        <p>{scenarioId ? 'Con este escenario y este rango de fechas no hay sesiones.' : 'En este rango de fechas no se ha creado ninguna sesión.'} Amplía el periodo o quita los filtros.</p>
        {filtered && <button className="btn" onClick={() => setQuery({ rango: null, escenario: null, simuladas: null }, { replace: true })}>Quitar filtros</button>}
      </div>
    : data ? <div className={`an-body ${busy ? 'is-refreshing' : ''}`}>
        <Notices data={data} simulated={simulated}/>
        <KpiRow data={data} simulated={simulated}/>
        <TrendCard data={data} range={range}/>
        <div className="an-grid-2">
          <ReinforceCard data={data}/>
          <div className="an-col"><MetersCard data={data}/><ScenarioTable data={data}/></div>
        </div>
        <RecentSessions data={data}/>
        <Methodology/>
      </div>
    : null}
  </div>;
}

function Filters({ range, scenarioId, simulated, options }: { range: RangeKey; scenarioId: string | null; simulated: boolean; options: [string, string][] }) {
  const selectId = useId();
  return <div className="an-filters" role="group" aria-label="Filtros de la analítica">
    <div className="an-segmented" role="group" aria-label="Periodo">
      {RANGES.map(item => <button key={item.key} type="button" aria-pressed={range === item.key} title={item.label}
        onClick={() => setQuery({ rango: item.key === DEFAULT_RANGE ? null : item.key }, { replace: true })}>
        <span className="an-long">{item.label}</span><span className="an-short">{item.short}</span></button>)}
    </div>
    <label className="an-select" htmlFor={selectId}><span>Escenario</span>
      <select id={selectId} value={scenarioId ?? ''} onChange={event => setQuery({ escenario: event.target.value || null }, { replace: true })}>
        <option value="">Todos los escenarios</option>
        {options.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </select>
    </label>
    <label className="toggle an-toggle"><input type="checkbox" checked={simulated} onChange={event => setQuery({ simuladas: event.target.checked ? '1' : null }, { replace: true })}/><span aria-hidden="true"/>Incluir clases simuladas</label>
  </div>;
}

function Notices({ data, simulated }: { data: AnalyticsResponse; simulated: boolean }) {
  const { totals } = data;
  if (totals.decisions > 0) return null;
  if (!simulated && totals.simulatedParticipants > 0) return <div className="an-notice">
    <Icon name="sim" size={18}/>
    <p>Las sesiones de este periodo solo tienen <strong>{plural(totals.simulatedParticipants, 'participante simulado', 'participantes simulados')}</strong>, que no cuentan por defecto. Actívalos para ver cómo se verá la analítica con una clase real.</p>
    <button className="btn btn-sm" onClick={() => setQuery({ simuladas: '1' }, { replace: true })}>Incluir clases simuladas</button>
  </div>;
  return <div className="an-notice">
    <Icon name="clock" size={18}/>
    <p>Todavía no hay decisiones registradas en este periodo. Las cifras se completan a medida que los participantes deciden; una decisión reciente puede tardar unos segundos en contar.</p>
  </div>;
}

/* ---------- Indicadores clave ---------- */

function KpiRow({ data, simulated }: { data: AnalyticsResponse; simulated: boolean }) {
  const { totals } = data;
  const sim = totals.simulatedParticipants;
  return <section className="an-kpis" aria-label="Indicadores clave">
    <Kpi icon="sessions" label="Sesiones" value={totals.sessions} sub={`${plural(totals.sessionsCompleted, 'finalizada', 'finalizadas')} · ${fmt(totals.sessionsActive)} en curso`}/>
    <Kpi icon="users" label="Participantes" value={totals.participants} sub={sim ? (simulated ? `personas distintas · +${fmt(sim)} simulados aparte` : `personas distintas · ${fmt(sim)} simulados excluidos`) : 'personas distintas'}/>
    <Kpi icon="check" label="Decisiones" value={totals.decisions} sub="una por persona y situación"/>
    <Kpi icon="chart" label="Decisiones óptimas" value={totals.optimalRate == null ? null : pctNumber(totals.optimalRate)} suffix={' %'} sub="eligieron la mejor opción" accent/>
    <Kpi icon="layers" label="Tasa de finalización" value={totals.completionRate == null ? null : pctNumber(totals.completionRate)} suffix={' %'} sub="decidieron en todas las situaciones"/>
    <Kpi icon="clock" label="Tiempo de decisión" value={totals.avgDecisionSeconds} format={secondsText} sub="mediana por decisión"/>
  </section>;
}

function Kpi({ icon, label, value, sub, suffix = '', accent, format }: { icon: string; label: string; value: number | null; sub: string; suffix?: string; accent?: boolean; format?: (value: number) => string }) {
  return <div className={`an-kpi ${accent ? 'accent' : ''}`}>
    <span className="an-kpi-label"><Icon name={icon} size={15}/>{label}</span>
    <strong className="an-kpi-value">{value == null ? <NoData/> : format ? (value < 60 ? <Count value={value} decimals={value < 10 ? 1 : 0} suffix={' s'}/> : format(value)) : <Count value={value} suffix={suffix}/>}</strong>
    <span className="an-kpi-sub">{sub}</span>
  </div>;
}

/* ---------- Tendencia (12 semanas): recuentos arriba y % óptimas abajo, mismo eje temporal ---------- */

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    setWidth(node.clientWidth);
    const observer = new ResizeObserver(entries => setWidth(Math.round(entries[0].contentRect.width)));
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find(item => item * power >= value / 2)! * power;
  return Math.ceil(value / step) * step;
}

function TrendCard({ data, range }: { data: AnalyticsResponse; range: RangeKey }) {
  const trend = data.trend;
  const [box, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const titleId = useId();
  const hasAny = trend.some(item => item.sessions > 0);
  const W = Math.max(280, width);
  const narrow = W < 520;
  const pad = { l: 34, r: 10 };
  const top = { y: 12, h: narrow ? 120 : 150 };
  const bottom = { y: top.y + top.h + 46, h: narrow ? 70 : 84 };
  const axisY = bottom.y + bottom.h + 18;
  const H = axisY + 6;
  const n = Math.max(1, trend.length);
  const band = (W - pad.l - pad.r) / n;
  const cx = (i: number) => pad.l + band * i + band / 2;
  const max = niceMax(Math.max(0, ...trend.map(item => Math.max(item.participants, item.decisions))));
  const yCount = (value: number) => top.y + top.h - (value / max) * top.h;
  const yRate = (rate: number) => bottom.y + bottom.h - rate * bottom.h;
  const barW = Math.max(3, Math.min(14, band * 0.28));
  const rangeLabel = RANGES.find(item => item.key === range)!;

  const segments: string[] = [];
  let current = '';
  trend.forEach((item, i) => {
    if (item.optimalRate == null) { if (current) segments.push(current); current = ''; return; }
    current += `${current ? 'L' : 'M'}${cx(i).toFixed(1)},${yRate(item.optimalRate).toFixed(1)}`;
  });
  if (current) segments.push(current);

  const totalDecisions = trend.reduce((sum, item) => sum + item.decisions, 0);
  const rated = trend.filter(item => item.optimalRate != null);
  const summary = trend.length
    ? `Evolución semanal desde la semana del ${weekLabel(trend[0].week, true)} hasta la del ${weekLabel(trend[trend.length - 1].week, true)}: ${plural(totalDecisions, 'decisión', 'decisiones')} en total${rated.length ? `; el porcentaje de decisiones óptimas va del ${pctNumber(Math.min(...rated.map(item => item.optimalRate!)))} % al ${pctNumber(Math.max(...rated.map(item => item.optimalRate!)))} % según la semana` : ''}. La tabla siguiente contiene los datos.`
    : 'Sin semanas en el periodo.';
  const labelEvery = narrow ? Math.ceil(n / 4) : n > 8 ? 2 : 1;
  const tip = active != null ? trend[active] : null;

  function onKey(event: React.KeyboardEvent) {
    if (!trend.length) return;
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
      event.preventDefault();
      setActive(index => { const base = index ?? trend.length - 1; return Math.max(0, Math.min(trend.length - 1, base + (event.key === 'ArrowRight' ? 1 : -1))); });
    } else if (event.key === 'Home') { event.preventDefault(); setActive(0); }
    else if (event.key === 'End') { event.preventDefault(); setActive(trend.length - 1); }
    else if (event.key === 'Escape') setActive(null);
  }

  return <section className="card an-card" aria-labelledby={titleId}>
    <div className="an-card-head">
      <div><h2 id={titleId} className="an-card-title">Evolución semanal</h2><p className="an-card-sub">Últimas {trend.length} semanas{rangeLabel.days != null && rangeLabel.days < 84 ? ` (el periodo elegido cubre ${rangeLabel.short})` : ''} · cada sesión cuenta en la semana en que se creó</p></div>
      <ul className="an-legend" aria-label="Leyenda">
        <li><i className="sw sw-participants"/>Participantes</li>
        <li><i className="sw sw-decisions"/>Decisiones</li>
        <li><i className="sw sw-line"/>% decisiones óptimas</li>
      </ul>
    </div>
    <div className="an-trend" ref={box} tabIndex={0} onKeyDown={onKey} onFocus={() => setActive(index => index ?? Math.max(0, trend.length - 1))} onBlur={() => setActive(null)} onMouseLeave={() => setActive(null)}
      aria-label="Gráfico de evolución semanal. Usa las flechas izquierda y derecha para recorrer las semanas." aria-describedby={`${titleId}-tip`}>
      {width > 0 && <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary}>
        {[0, 0.5, 1].map(f => <g key={`c${f}`} className="an-grid"><line x1={pad.l} x2={W - pad.r} y1={yCount(max * f)} y2={yCount(max * f)}/><text x={pad.l - 6} y={yCount(max * f) + 3.5} textAnchor="end">{fmt(max * f)}</text></g>)}
        {[0, 0.5, 1].map(f => <g key={`r${f}`} className="an-grid"><line x1={pad.l} x2={W - pad.r} y1={yRate(f)} y2={yRate(f)}/><text x={pad.l - 6} y={yRate(f) + 3.5} textAnchor="end">{f * 100}%</text></g>)}
        <text className="an-panel-label" x={pad.l} y={bottom.y - 16}>% decisiones óptimas</text>
        {active != null && <rect className="an-hover-band" x={pad.l + band * active} y={top.y - 6} width={band} height={axisY - top.y}/>}
        {trend.map((item, i) => <g key={item.week}>
          {item.participants > 0 && <rect className="an-bar participants" x={cx(i) - barW - 1} y={yCount(item.participants)} width={barW} height={top.y + top.h - yCount(item.participants)} rx={Math.min(3, barW / 2)}/>}
          {item.decisions > 0 && <rect className="an-bar decisions" x={cx(i) + 1} y={yCount(item.decisions)} width={barW} height={top.y + top.h - yCount(item.decisions)} rx={Math.min(3, barW / 2)}/>}
          {(i % labelEvery === 0 || i === n - 1) && <text className="an-axis" x={cx(i)} y={axisY} textAnchor="middle">{weekLabel(item.week)}</text>}
        </g>)}
        {segments.map(d => <path key={d} className="an-line" d={d}/>)}
        {trend.map((item, i) => item.optimalRate != null && <circle key={`p${item.week}`} className={`an-dot ${active === i ? 'on' : ''}`} cx={cx(i)} cy={yRate(item.optimalRate)} r={active === i ? 5.5 : 4}/>)}
        {trend.map((item, i) => <rect key={`h${item.week}`} className="an-hit" x={pad.l + band * i} y={0} width={band} height={H} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}/>)}
      </svg>}
      {width === 0 && <Sk h={300}/>}
      {!hasAny && width > 0 && <div className="an-trend-empty"><span>Sin sesiones en estas semanas</span></div>}
      <div id={`${titleId}-tip`} className={`an-tip ${tip ? 'show' : ''}`} role="status" aria-live="polite"
        style={tip && active != null ? { left: Math.max(8, Math.min(W - 196, cx(active) - 94)) } : undefined}>
        {tip && <><strong>Semana del {weekLabel(tip.week, true)}</strong>
          <dl><div><dt>Sesiones</dt><dd>{fmt(tip.sessions)}</dd></div><div><dt><i className="sw sw-participants"/>Participantes</dt><dd>{fmt(tip.participants)}</dd></div><div><dt><i className="sw sw-decisions"/>Decisiones</dt><dd>{fmt(tip.decisions)}</dd></div><div><dt><i className="sw sw-line"/>Óptimas</dt><dd>{tip.optimalRate == null ? '—' : `${pctNumber(tip.optimalRate)} %`}</dd></div></dl></>}
      </div>
    </div>
    <div className="sr-only"><table><caption>Datos semanales</caption>
      <thead><tr><th scope="col">Semana</th><th scope="col">Sesiones</th><th scope="col">Participantes</th><th scope="col">Decisiones</th><th scope="col">% decisiones óptimas</th></tr></thead>
      <tbody>{trend.map(item => <tr key={item.week}><th scope="row">{weekLabel(item.week, true)}</th><td>{item.sessions}</td><td>{item.participants}</td><td>{item.decisions}</td><td>{pctText(item.optimalRate)}</td></tr>)}</tbody>
    </table></div>
  </section>;
}

/* ---------- Dónde necesita refuerzo la clase ---------- */

function ReinforceCard({ data }: { data: AnalyticsResponse }) {
  const titleId = useId();
  const rated = data.phases.filter(phase => phase.optimalRate != null);
  const weak = rated.filter(phase => phase.optimalRate! < 1).slice(0, 4);
  return <section className="card an-card" aria-labelledby={titleId}>
    <div className="an-card-head"><div><h2 id={titleId} className="an-card-title">Dónde necesita refuerzo la clase</h2><p className="an-card-sub">Situaciones con menor proporción de decisiones óptimas. Útil para preparar el debate.</p></div></div>
    <QualityLegend/>
    {!rated.length ? <p className="an-empty-line">Aparecerá cuando haya decisiones en situaciones con opciones valoradas.</p>
    : !weak.length ? <div className="an-success"><Icon name="check" size={18}/><p>En todas las situaciones del periodo la clase eligió la mejor opción.</p></div>
    : <ol className="an-phases">{weak.map(phase => <PhaseRow key={`${phase.scenarioId}-${phase.phaseId}`} phase={phase}/>)}</ol>}
  </section>;
}

function QualityLegend() {
  return <ul className="an-legend an-legend-quality" aria-label="Valoración de las opciones">
    <li><i className="sw q-best"/>Mejor opción</li><li><i className="sw q-acceptable"/>Aceptable</li><li><i className="sw q-poor"/>Crítica</li><li><i className="sw q-none"/>Sin valorar</li>
  </ul>;
}

function PhaseRow({ phase }: { phase: AnalyticsResponse['phases'][number] }) {
  const rate = phase.optimalRate!;
  const wrong = phase.mostChosenNonOptimal;
  const wrongQuality = wrong ? phase.distribution.find(item => item.optionId === wrong.optionId)?.quality : null;
  const summary = `Reparto de las ${phase.decisions} decisiones: ${phase.distribution.map((option, i) => `opción ${optionLetter(i)} «${option.label}», ${qualityLabel(option.quality).toLowerCase()}, ${Math.round(option.share * 100)} %`).join('; ')}.`;
  return <li className="an-phase">
    <div className="an-phase-head">
      <div className="an-phase-text"><strong>{phase.phaseTitle}</strong><small>{phase.scenarioTitle} · {plural(phase.decisions, 'decisión', 'decisiones')}</small></div>
      <div className="an-phase-rate"><strong><Count value={pctNumber(rate)} suffix={' %'}/></strong><small>óptimas</small></div>
    </div>
    <div className="an-stack" role="img" aria-label={summary}>
      {phase.distribution.filter(option => option.count > 0).map(option => <span key={option.optionId} className={`q-${option.quality ?? 'none'}`} style={{ flexGrow: option.count }} title={`${option.label}: ${Math.round(option.share * 100)} %`}/>)}
    </div>
    <ul className="an-options">
      {phase.distribution.map((option, i) => <li key={option.optionId} className={option.count === 0 ? 'zero' : ''}>
        <i className={`sw q-${option.quality ?? 'none'}`} aria-hidden="true"/><span className="an-opt-letter">{optionLetter(i)}</span>
        <span className="an-opt-label" title={option.label}>{option.label}</span>
        <span className="an-opt-quality">{qualityLabel(option.quality)}</span>
        <span className="an-opt-share">{Math.round(option.share * 100)}&nbsp;%</span>
      </li>)}
    </ul>
    <div className="an-phase-foot">
      {wrong ? <p className={`an-callout ${wrongQuality === 'poor' ? 'poor' : ''}`}><span className={`an-callout-mark q-${wrongQuality ?? 'none'}`} aria-hidden="true"/>El {Math.round(wrong.share * 100)}&nbsp;% eligió «{wrong.label}»{wrongQuality ? <> ({qualityLabel(wrongQuality).toLowerCase()})</> : null}</p> : <span/>}
      <Link className="link an-phase-link" to={`/escenarios/${encodeURIComponent(phase.scenarioId)}`}>Ver escenario<Icon name="next" size={14}/></Link>
    </div>
  </li>;
}

/* ---------- Impacto en los indicadores ---------- */

function MetersCard({ data }: { data: AnalyticsResponse }) {
  const titleId = useId();
  const groups = useMemo(() => {
    const map = new Map<string, AnalyticsResponse['meters']>();
    for (const row of data.meters) map.set(row.scenarioId, [...(map.get(row.scenarioId) ?? []), row]);
    return [...map].map(([id, rows]) => ({ id, title: data.scenarios.find(item => item.scenarioId === id)?.title ?? id, rows }));
  }, [data]);
  return <section className="card an-card" aria-labelledby={titleId}>
    <div className="an-card-head"><div><h2 id={titleId} className="an-card-title">Impacto en los indicadores</h2><p className="an-card-sub">Media de la clase al empezar y al terminar, en sesiones finalizadas (escala 0–100).</p></div></div>
    <ul className="an-legend" aria-label="Leyenda"><li><i className="sw sw-start"/>Inicio</li><li><i className="sw sw-end"/>Final</li><li><span className="an-tone good">▲</span>Favorable</li><li><span className="an-tone bad">▼</span>Desfavorable</li></ul>
    {!groups.length ? <p className="an-empty-line">Aparecerá cuando finalice una sesión con participantes.</p>
    : <div className="an-meter-groups">{groups.map(group => <div key={group.id} className="an-meter-group">
        <h3>{group.title}</h3>
        <ul>{group.rows.map(row => <MeterRow key={row.meter} row={row}/>)}</ul>
      </div>)}</div>}
  </section>;
}

function MeterRow({ row }: { row: AnalyticsResponse['meters'][number] }) {
  // En «Riesgo», bajar es favorable; en el resto, subir.
  const better = row.meter === 'risk' ? row.delta < 0 : row.delta > 0;
  const tone = Math.abs(row.delta) < 0.5 ? 'flat' : better ? 'good' : 'bad';
  const lo = Math.min(row.avgStart, row.avgEnd), hi = Math.max(row.avgStart, row.avgEnd);
  const verdict = tone === 'flat' ? 'sin cambios' : tone === 'good' ? 'favorable' : 'desfavorable';
  return <li className={`an-meter ${tone}`}>
    <span className="an-meter-label">{row.label}</span>
    <span className="an-meter-track" role="img" aria-label={`${row.label}: de ${fmt(row.avgStart, 1)} a ${fmt(row.avgEnd, 1)} (${verdict})`}>
      <i className="range" style={{ left: `${lo}%`, width: `${Math.max(0, hi - lo)}%` }}/>
      <i className="start" style={{ left: `${row.avgStart}%` }}/>
      <i className="end" style={{ left: `${row.avgEnd}%` }}/>
    </span>
    <span className="an-meter-values"><span>{fmt(row.avgStart)}</span><Icon name="next" size={12}/><strong>{fmt(row.avgEnd)}</strong></span>
    <span className={`an-delta ${tone}`} title={verdict}>{tone === 'flat' ? '=' : row.delta > 0 ? '▲' : '▼'} {row.delta > 0 ? '+' : row.delta < 0 ? '−' : ''}{fmt(Math.abs(row.delta), Number.isInteger(row.delta) ? 0 : 1)}<span className="sr-only"> ({verdict})</span></span>
  </li>;
}

/* ---------- Por escenario y sesiones recientes ---------- */

function RateCell({ rate }: { rate: number | null }) {
  if (rate == null) return <NoData compact/>;
  const value = pctNumber(rate);
  return <span className="an-rate-cell"><span className="an-mini" aria-hidden="true"><i style={{ width: `${value}%` }}/></span>{value}&nbsp;%</span>;
}

function ScenarioTable({ data }: { data: AnalyticsResponse }) {
  const titleId = useId();
  return <section className="card an-card an-table-card" aria-labelledby={titleId}>
    <div className="an-card-head"><div><h2 id={titleId} className="an-card-title">Por escenario</h2><p className="an-card-sub">Participación y resultados agregados de cada escenario en el periodo.</p></div></div>
    <div className="table-wrap"><table className="table an-table">
      <thead><tr><th scope="col">Escenario</th><th scope="col" className="num">Sesiones</th><th scope="col" className="num">Participantes</th><th scope="col" className="num">Decisiones</th><th scope="col">% óptimas</th><th scope="col">Finalización</th></tr></thead>
      <tbody>{data.scenarios.map(row => <tr key={row.scenarioId}>
        <th scope="row"><Link to={`/escenarios/${encodeURIComponent(row.scenarioId)}`}>{row.title}</Link></th>
        <td className="num">{fmt(row.sessions)}</td><td className="num">{fmt(row.participants)}</td><td className="num">{fmt(row.decisions)}</td>
        <td><RateCell rate={row.optimalRate}/></td><td><RateCell rate={row.completionRate}/></td>
      </tr>)}</tbody>
    </table></div>
  </section>;
}

function RecentSessions({ data }: { data: AnalyticsResponse }) {
  const titleId = useId();
  if (!data.recentSessions.length) return null;
  return <section className="card an-card" aria-labelledby={titleId}>
    <div className="an-card-head"><div><h2 id={titleId} className="an-card-title">Sesiones recientes</h2><p className="an-card-sub">Abre el informe de impacto de cada sesión.</p></div><Link className="link" to="/sesiones">Ver todas</Link></div>
    <ul className="an-recent">{data.recentSessions.map(item => <li key={item.id}>
      <Link to={`/sesiones/${item.id}?vista=informe`} className="an-recent-link">
        <span className="an-recent-main"><strong>{item.name ?? item.scenarioTitle}</strong><small>{item.name ? `${item.scenarioTitle} · ` : ''}{relativeDate(item.createdAt)}</small></span>
        <span className="an-recent-meta"><StatusPill status={item.status} className="pill-inline"/><span><Icon name="users" size={14}/>{fmt(item.participants)}</span><span className="an-recent-rate">{item.optimalRate == null ? <NoData compact/> : <>{pctNumber(item.optimalRate)}&nbsp;% óptimas</>}</span></span>
        <Icon name="next" size={16} className="an-recent-arrow"/>
      </Link>
    </li>)}</ul>
  </section>;
}

function Methodology() {
  return <aside className="an-method" aria-label="Metodología">
    <Icon name="report" size={16}/>
    <p><strong>Cómo se calcula.</strong> Reglas fijas sobre las decisiones registradas, sin inteligencia artificial. Todos los datos son agregados: la analítica no identifica, ordena ni valora a las personas; la valoración de cada opción la define el diseño del escenario. % óptimas = decisiones con la mejor opción entre las decisiones con opción valorada. Finalización = participantes de sesiones finalizadas que decidieron en todas las situaciones. Tiempo de decisión = mediana. Las clases simuladas se excluyen salvo que se incluyan con el filtro.</p>
  </aside>;
}

/* ---------- Estados de carga y vacío ---------- */

function AnalyticsSkeleton() {
  return <div className="an-body" aria-hidden="true">
    <div className="an-kpis">{[0, 1, 2, 3, 4, 5].map(i => <div className="an-kpi" key={i}><Sk w={110} h={12}/><Sk w={80} h={32} className="sk-gap"/><Sk w="70%" h={10} className="sk-gap-s"/></div>)}</div>
    <div className="card an-card"><Sk w={180} h={16}/><Sk w={300} h={10} className="sk-gap-s"/><div className="an-sk-bars">{Array.from({ length: 12 }, (_, i) => <Sk key={i} w="100%" h={`${30 + ((i * 37) % 60)}%`} r={3}/>)}</div></div>
    <div className="an-grid-2">{[0, 1].map(i => <div className="card an-card" key={i}><Sk w={220} h={16}/><Sk w="80%" h={10} className="sk-gap-s"/>{[0, 1, 2].map(j => <div key={j} className="an-sk-row"><Sk w="60%" h={13}/><Sk w="100%" h={12} r={6} className="sk-gap-s"/><Sk w="40%" h={10} className="sk-gap-s"/></div>)}</div>)}</div>
  </div>;
}

function EmptyAnalytics() {
  const items = [
    { icon: 'chart', title: 'Participación y decisiones', text: 'Sesiones, participantes, decisiones y porcentaje de decisiones óptimas, semana a semana.', art: 'bars' },
    { icon: 'layers', title: 'Dónde necesita refuerzo la clase', text: 'Las situaciones con menos decisiones óptimas y la alternativa más elegida, para preparar el debate.', art: 'stack' },
    { icon: 'next', title: 'Impacto en los indicadores', text: 'Cómo evolucionan de media los indicadores del escenario entre el inicio y el final.', art: 'meters' },
    { icon: 'report', title: 'Informe por sesión', text: 'Acceso directo al informe de impacto de cada sesión finalizada.', art: 'list' }
  ];
  return <section className="an-empty" aria-labelledby="an-empty-title">
    <div className="an-empty-hero">
      <div className="an-empty-copy">
        <span className="eyebrow">Aún sin sesiones</span>
        <h2 id="an-empty-title">Tus datos aparecerán aquí después de la primera sesión</h2>
        <p>Cuando tu grupo decida en una simulación, verás cómo decide la clase en conjunto y en qué situaciones conviene reforzar. Solo datos agregados: nunca se valora ni se compara a las personas.</p>
        <div className="hero-actions"><button className="btn btn-light btn-lg" onClick={() => navigate('/sesiones/nueva')}><Icon name="plus" size={18}/>Crear sesión</button><button className="btn btn-ghost-light btn-lg" onClick={() => navigate('/escenarios')}>Explorar escenarios</button></div>
      </div>
      <svg className="an-empty-art" viewBox="0 0 240 160" aria-hidden="true" focusable="false">
        {[38, 62, 50, 84, 72, 104, 96].map((h, i) => <rect key={i} x={18 + i * 30} y={140 - h} width="16" height={h} rx="3"/>)}
        <path d="M26 92 L56 78 L86 84 L116 58 L146 64 L176 40 L206 34"/>
        {[[26, 92], [56, 78], [86, 84], [116, 58], [146, 64], [176, 40], [206, 34]].map(([x, y]) => <circle key={x} cx={x} cy={y} r="4"/>)}
      </svg>
    </div>
    <ul className="an-empty-grid">{items.map(item => <li key={item.title}>
      <EmptyArt kind={item.art}/>
      <div><strong>{item.title}</strong><p>{item.text}</p></div>
    </li>)}</ul>
    <Methodology/>
  </section>;
}

function EmptyArt({ kind }: { kind: string }) {
  return <svg className="an-empty-mini" viewBox="0 0 96 48" aria-hidden="true" focusable="false">
    {kind === 'bars' && [14, 22, 18, 30, 26, 36].map((h, i) => <rect key={i} x={6 + i * 15} y={44 - h} width="9" height={h} rx="2" className={i % 2 ? 'b' : 'a'}/>)}
    {kind === 'stack' && <><rect x="4" y="10" width="44" height="10" rx="2" className="a"/><rect x="50" y="10" width="26" height="10" rx="2" className="b"/><rect x="78" y="10" width="14" height="10" rx="2" className="c"/><rect x="4" y="28" width="60" height="10" rx="2" className="a"/><rect x="66" y="28" width="20" height="10" rx="2" className="b"/><rect x="88" y="28" width="4" height="10" rx="2" className="c"/></>}
    {kind === 'meters' && [10, 24, 38].map((y, i) => <g key={y}><rect x="4" y={y - 1.5} width="88" height="3" rx="1.5" className="t"/><circle cx={[30, 52, 70][i]} cy={y} r="4" className="o"/><circle cx={[62, 34, 50][i]} cy={y} r="4" className="a"/></g>)}
    {kind === 'list' && [8, 22, 36].map(y => <g key={y}><rect x="4" y={y - 3} width="40" height="6" rx="3" className="a"/><rect x="50" y={y - 2} width="24" height="4" rx="2" className="t"/><rect x="80" y={y - 3} width="12" height="6" rx="3" className="b"/></g>)}
  </svg>;
}

/* ---------- Franja de Inicio (solo con datos) ---------- */

/** Resumen compacto para Inicio: tres cifras de los últimos 12 meses. No se muestra si aún no hay decisiones. */
export function AnalyticsStrip({ expected }: { expected: boolean }) {
  const path = useMemo(() => analyticsPath('12m', null, false), []);
  const { data, loading } = useAnalytics(path);
  if (loading && !data) return expected ? <div className="an-strip" aria-hidden="true">{[0, 1, 2].map(i => <div key={i} className="an-strip-item"><Sk w={64} h={26}/><Sk w={110} h={10} className="sk-gap-s"/></div>)}<Sk w={120} h={14}/></div> : null;
  if (!data || data.totals.decisions === 0) return null;
  const { totals } = data;
  return <section className="an-strip" aria-label="Analítica de los últimos 12 meses">
    <div className="an-strip-item"><strong>{totals.optimalRate == null ? <NoData compact/> : <Count value={pctNumber(totals.optimalRate)} suffix={' %'}/>}</strong><span>decisiones óptimas</span></div>
    <div className="an-strip-item"><strong><Count value={totals.decisions}/></strong><span>decisiones de {plural(totals.participants, 'persona', 'personas')}</span></div>
    <div className="an-strip-item"><strong>{totals.completionRate == null ? <NoData compact/> : <Count value={pctNumber(totals.completionRate)} suffix={' %'}/>}</strong><span>completaron todas las situaciones</span></div>
    <Link to="/analitica?rango=12m" className="an-strip-link"><Icon name="chart" size={16}/>Ver analítica<Icon name="next" size={14}/></Link>
  </section>;
}
