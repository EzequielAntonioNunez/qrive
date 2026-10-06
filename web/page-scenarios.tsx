/** Catálogo de escenarios y detalle con situaciones, opciones y (para el docente) valoración, motivo e idea clave. */
import React, { useEffect, useState } from 'react';
import { estimatedMinutes, useApp } from './app-context';
import { EmptyState, Icon, PageHeader } from './kit';
import { Link, navigate } from './router';
import { optionLetter, plural, qualityLabel } from './types';
import { Sk } from './ui';

export function ScenariosPage() {
  const app = useApp();
  const { scenarios } = app;
  useEffect(() => { if (scenarios?.length) for (const item of scenarios) void app.loadScenario(item.id); }, [scenarios?.length]);
  return <div className="page">
    <PageHeader title="Escenarios" description="Situaciones de aprendizaje listas para usar. Revisa cada una antes de clase y crea una sesión con ella."/>
    {scenarios === null ? <div className="scenario-grid">{[0, 1, 2].map(i => <div className="scenario-card" key={i} aria-hidden="true"><Sk w={120} h={10}/><Sk w="80%" h={20} className="sk-gap"/><Sk w="100%" h={12} className="sk-gap"/><Sk w="90%" h={12} className="sk-gap-s"/></div>)}</div>
    : scenarios.length === 0 ? <div className="card"><EmptyState icon="scenarios" title="No hay escenarios publicados">Tu organización aún no tiene escenarios disponibles.</EmptyState></div>
    : <div className="scenario-grid">{scenarios.map(item => {
        const detail = app.scenarioDetails[item.id];
        const minutes = estimatedMinutes(detail);
        return <article className="scenario-card" key={item.id}>
          <span className="scenario-meta">{plural(item.phases, 'situación', 'situaciones')}{minutes ? ` · unos ${minutes} min` : ''} · v{item.version}</span>
          <h2><Link to={`/escenarios/${encodeURIComponent(item.id)}`}>{item.title}</Link></h2>
          <p className="scenario-summary">{item.summary}</p>
          {detail?.character?.name && <p className="scenario-char"><span className="avatar sm" aria-hidden="true">{detail.character.name[0]}</span>Con {detail.character.name}, personaje virtual</p>}
          <div className="card-actions">{app.isInstructor && <button className="btn btn-primary btn-sm" onClick={() => navigate(`/sesiones/nueva?escenario=${encodeURIComponent(item.id)}`)}><Icon name="plus" size={16}/>Crear sesión</button>}<Link className="btn btn-sm" to={`/escenarios/${encodeURIComponent(item.id)}`}>Ver situaciones</Link></div>
        </article>;
      })}</div>}
  </div>;
}

export function ScenarioPage({ id }: { id: string }) {
  const app = useApp();
  const [missing, setMissing] = useState(false);
  const scenario = app.scenarioDetails[id];
  useEffect(() => { void app.loadScenario(id).then(result => setMissing(!result)); }, [id]);
  useEffect(() => { if (scenario) document.title = `${scenario.title} · Escenarios`; }, [scenario?.title]);
  const crumbs = [{ label: 'Escenarios', to: '/escenarios' }, { label: scenario?.title ?? 'Escenario' }];
  if (missing && !scenario) return <div className="page"><PageHeader title="Escenario no encontrado" crumbs={crumbs}/><div className="card"><EmptyState icon="scenarios" title="No encontramos este escenario" action={<button className="btn btn-primary" onClick={() => navigate('/escenarios')}>Volver a escenarios</button>}>Puede que el enlace no sea correcto.</EmptyState></div></div>;
  if (!scenario) return <div className="page" aria-busy="true"><div className="page-header"><Sk w={160} h={10}/><Sk w="min(460px, 80vw)" h={30} className="sk-gap"/><Sk w="min(560px, 85vw)" h={12} className="sk-gap"/></div>{[0, 1].map(i => <div className="card phase-card" key={i}><Sk w={120} h={10}/><Sk w="60%" h={20} className="sk-gap"/><Sk w="100%" h={12} className="sk-gap"/></div>)}</div>;
  const minutes = estimatedMinutes(scenario);
  const instructor = app.isInstructor;
  return <div className="page">
    <PageHeader crumbs={crumbs} title={scenario.title} description={scenario.summary}
      actions={instructor ? <button className="btn btn-primary" onClick={() => navigate(`/sesiones/nueva?escenario=${encodeURIComponent(scenario.id)}`)}><Icon name="plus" size={18}/>Crear sesión con este escenario</button> : undefined}>
      <div className="fact-row"><span><Icon name="layers" size={16}/>{plural(scenario.phases.length, 'situación', 'situaciones')}</span>{minutes && <span><Icon name="clock" size={16}/>Unos {minutes} min</span>}<span><Icon name="users" size={16}/>Con {scenario.character?.name || 'VictorIA'}, personaje virtual</span><span>Versión {scenario.version}</span></div>
    </PageHeader>
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
