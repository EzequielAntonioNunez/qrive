/** Catálogo de escenarios y detalle con situaciones, opciones y (para el docente) valoración, motivo e idea clave. */
import React, { useEffect, useState } from 'react';
import { estimatedMinutes, useApp } from './app-context';
import { brand } from './brand';
import { EmptyState, Icon, PageHeader } from './kit';
import { Link, navigate, setQuery, useLocation } from './router';
import { optionLetter, plural, qualityLabel, type ScenarioSummary } from './types';
import { Sk } from './ui';
import { aiLiveFlag } from './ai-live-types';
import { ScenarioTabs } from './page-knowledge';
import type { Scenario } from '../shared/simulation';
import './scenario-editor.css';

export function ScenariosPage() {
  const app = useApp();
  const { scenarios } = app;
  useEffect(() => { if (scenarios?.length) for (const item of scenarios) void app.loadScenario(item.id); }, [scenarios?.length]);
  return <div className="page">
    <PageHeader title="Escenarios" description="Situaciones de aprendizaje listas para usar. Revisa cada una antes de clase y crea una sesión con ella."/>
    {aiLiveFlag.enabled && <ScenarioTabs current="catalog"/>}
    {scenarios === null ? <div className="scenario-grid">{[0, 1, 2].map(i => <div className="scenario-card" key={i} aria-hidden="true"><Sk w={120} h={10}/><Sk w="80%" h={20} className="sk-gap"/><Sk w="100%" h={12} className="sk-gap"/><Sk w="90%" h={12} className="sk-gap-s"/></div>)}</div>
    : scenarios.length === 0 ? <div className="card"><EmptyState icon="scenarios" title="No hay escenarios publicados">Tu organización aún no tiene escenarios disponibles.</EmptyState></div>
    : (() => {
        const own = scenarios.filter(item => !item.catalog);
        const catalog = scenarios.filter(item => item.catalog);
        const grid = (list: ScenarioSummary[]) => <div className="scenario-grid">{list.map(item => <ScenarioCard key={item.id} item={item} detail={app.scenarioDetails[item.id]} instructor={app.isInstructor}/>)}</div>;
        return own.length ? <>
          <h2 className="scenario-group-title">Tus escenarios <span className="tab-count">{own.length}</span></h2>{grid(own)}
          {catalog.length > 0 && <><h2 className="scenario-group-title">Catálogo {brand.shortName} <span className="tab-count">{catalog.length}</span></h2>{grid(catalog)}</>}
        </> : grid(catalog);
      })()}
  </div>;
}

/** «Creado con IA · revisado por <docente>»: procedencia de los escenarios publicados desde el modo IA en vivo. */
export function AiOriginBadge({ item }: { item: Pick<ScenarioSummary, 'origin' | 'publishedBy'> | undefined }) {
  if (item?.origin !== 'ai') return null;
  return <span className="ai-origin" title="Generado con IA a partir de documentos de la organización y revisado por un docente antes de publicarse."><Icon name="sparkles" size={13}/>Creado con IA{item.publishedBy ? ` · revisado por ${item.publishedBy}` : ' · revisado por un docente'}</span>;
}

function ScenarioCard({ item, detail, instructor }: { item: ScenarioSummary; detail: Scenario | undefined; instructor: boolean }) {
  const minutes = estimatedMinutes(detail);
  return <article className="scenario-card">
    <span className="scenario-meta">{plural(item.phases, 'situación', 'situaciones')}{minutes ? ` · unos ${minutes} min` : ''}</span>
    <h2><Link to={`/escenarios/${encodeURIComponent(item.id)}`}>{item.title}</Link></h2>
    <AiOriginBadge item={item}/>
    <p className="scenario-summary">{item.summary}</p>
    {detail?.character?.name && <p className="scenario-char"><span className="avatar sm" aria-hidden="true">{detail.character.name[0]}</span>Con {detail.character.name}, personaje virtual</p>}
    <div className="card-actions">{instructor && <button className="btn btn-primary btn-sm" onClick={() => navigate(`/sesiones/nueva?escenario=${encodeURIComponent(item.id)}`)}><Icon name="plus" size={16}/>Crear sesión</button>}<Link className="btn btn-sm" to={`/escenarios/${encodeURIComponent(item.id)}`}>Ver situaciones</Link></div>
  </article>;
}

export function ScenarioPage({ id }: { id: string }) {
  const app = useApp();
  const [missing, setMissing] = useState(false);
  const published = useLocation().query.get('publicado') === '1';
  const scenario = app.scenarioDetails[id];
  useEffect(() => { void app.loadScenario(id).then(result => setMissing(!result)); }, [id]);
  useEffect(() => { if (scenario) document.title = `${scenario.title} · ${brand.product} · ${brand.shortName}`; }, [scenario?.title]);
  const crumbs = [{ label: 'Escenarios', to: '/escenarios' }, { label: scenario?.title ?? 'Escenario' }];
  if (missing && !scenario) return <div className="page"><PageHeader title="Escenario no encontrado" crumbs={crumbs}/><div className="card"><EmptyState icon="scenarios" title="No encontramos este escenario" action={<button className="btn btn-primary" onClick={() => navigate('/escenarios')}>Volver a escenarios</button>}>Puede que el enlace no sea correcto.</EmptyState></div></div>;
  if (!scenario) return <div className="page" aria-busy="true"><div className="page-header"><Sk w={160} h={10}/><Sk w="min(460px, 80vw)" h={30} className="sk-gap"/><Sk w="min(560px, 85vw)" h={12} className="sk-gap"/></div>{[0, 1].map(i => <div className="card phase-card" key={i}><Sk w={120} h={10}/><Sk w="60%" h={20} className="sk-gap"/><Sk w="100%" h={12} className="sk-gap"/></div>)}</div>;
  const minutes = estimatedMinutes(scenario);
  const instructor = app.isInstructor;
  const summary = app.scenarios?.find(item => item.id === scenario.id);
  const fromAi = scenario.origin?.kind === 'ai' || summary?.origin === 'ai';
  return <div className="page">
    <PageHeader crumbs={crumbs} title={scenario.title} description={scenario.summary}
      actions={instructor ? <button className="btn btn-primary" onClick={() => navigate(`/sesiones/nueva?escenario=${encodeURIComponent(scenario.id)}`)}><Icon name="plus" size={18}/>Crear sesión con este escenario</button> : undefined}>
      <div className="fact-row"><span><Icon name="layers" size={16}/>{plural(scenario.phases.length, 'situación', 'situaciones')}</span>{minutes && <span><Icon name="clock" size={16}/>Unos {minutes} min</span>}<span><Icon name="users" size={16}/>Con {scenario.character?.name || 'VictorIA'}, personaje virtual</span><span>Versión {scenario.version}</span>{fromAi && <AiOriginBadge item={{ origin: 'ai', publishedBy: summary?.publishedBy ?? null }}/>}</div>
    </PageHeader>
    {published && instructor && <div className="notice-inline se-restored" role="status"><span><strong>Escenario publicado.</strong> Ya está disponible para tus clases: crea una sesión y comparte el QR o el PIN con el grupo.</span><button className="text-button" onClick={() => setQuery({ publicado: null }, { replace: true })}>Cerrar</button></div>}
    {instructor && fromAi && <p className="notice-inline">Generado con IA a partir de documentos de la organización y revisado por un docente antes de publicarse. Sin locución grabada: VictorIA se muestra como texto en el móvil y en el simulador.</p>}
    {instructor && <p className="notice-inline">Preparación de la clase: aquí ves la valoración de cada opción, el porqué y la idea clave. Los participantes no los ven hasta que deciden.</p>}
    <ol className="phase-list">{scenario.phases.map((phase, i) => <li key={phase.id} className="card phase-card">
      <div className="phase-card-head"><span className="phase-num">{i + 1}</span><div><span className="eyebrow">Situación {i + 1}{phase.timeLimitSec ? ` · ${Math.round(phase.timeLimitSec / 60)} min` : ''}</span><h2>{phase.title}</h2></div></div>
      <p className="briefing">{phase.briefing}</p>
      {phase.characterLine && <blockquote className="char-line"><span>{scenario.character?.name || 'VictorIA'}</span>«{phase.characterLine}»</blockquote>}
      <ul className="option-list">{phase.options.map((option, j) => <li key={option.id}>
        <span className="option-letter" aria-hidden="true">{optionLetter(j)}</span>
        <div><strong>{option.label}</strong>{instructor && <p>{option.consequence}</p>}{instructor && option.rationale && <p className="rationale"><span>Por qué</span>{option.rationale}</p>}</div>
        {instructor && option.quality && <span className={`quality ${option.quality}`}>{qualityLabel(option.quality)}</span>}
      </li>)}</ul>
      {instructor && phase.takeaway && <p className="takeaway"><span>Idea clave</span>{phase.takeaway}</p>}
    </li>)}</ol>
    {instructor && <div className="page-foot"><button className="btn btn-primary btn-lg" onClick={() => navigate(`/sesiones/nueva?escenario=${encodeURIComponent(scenario.id)}`)}><Icon name="plus" size={18}/>Crear sesión con este escenario</button></div>}
  </div>;
}
