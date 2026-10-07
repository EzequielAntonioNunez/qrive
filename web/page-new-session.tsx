/** Nueva sesión en tres pasos: escenario, detalles y «listo» con el enlace para compartir. */
import React, { useEffect, useState } from 'react';
import type { Scenario } from '../shared/simulation';
import { estimatedMinutes, simulatorUrl, useApp, useSessionActions, type ApiError } from './app-context';
import { EmptyState, Icon, Modal, PageHeader } from './kit';
import { navigate, useLocation } from './router';
import { errorText, plural, type ScenarioSummary, type SessionPayload } from './types';
import { CopyButton, Sk, useToast } from './ui';
import { JoinShare } from './share-qr';

const STEPS = ['Escenario', 'Detalles', 'Listo'];

export function NewSessionPage() {
  const app = useApp();
  const toast = useToast();
  const actions = useSessionActions();
  const { query } = useLocation();
  const preset = query.get('escenario');
  const [step, setStep] = useState(0);
  const [scenarioId, setScenarioId] = useState<string | null>(preset);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const { scenarios } = app;

  useEffect(() => { if (scenarios?.length) for (const item of scenarios) void app.loadScenario(item.id); }, [scenarios?.length]);
  useEffect(() => {
    if (!scenarios?.length) return;
    if (preset && scenarios.some(item => item.id === preset)) { setScenarioId(preset); setStep(current => current === 0 ? 1 : current); }
    else if (!scenarioId) setScenarioId(scenarios[0].id);
  }, [scenarios, preset]);
  // Cada paso lleva el foco a su título para lectores de pantalla y teclado.
  // En «Detalles», el foco va directamente al nombre (su etiqueta ya anuncia el paso).
  useEffect(() => { document.querySelector<HTMLElement>(step === 1 ? '#session-name' : '[data-step-title]')?.focus({ preventScroll: true }); }, [step]);

  const chosen = scenarios?.find(item => item.id === scenarioId);
  const placeholder = 'P. ej., Ética de la IA · 3.º Derecho · Grupo A';

  async function create() {
    if (!chosen) return;
    setBusy(true); setError('');
    try {
      const body: Record<string, string> = { scenarioId: chosen.id };
      if (name.trim()) body.name = name.trim();
      const result = await app.api<SessionPayload & { session?: { name?: string | null } }>('/sessions', { method: 'POST', body: JSON.stringify(body) });
      await app.reloadSessions();
      setCreated({ id: result.state.id, name: result.session?.name || name.trim() || chosen.title });
      setStep(2);
      toast('Sesión creada');
    } catch (cause) {
      const status = (cause as ApiError).status;
      setError(status === 400 ? errorText(cause) : `No se ha podido crear la sesión: ${errorText(cause)}`);
    } finally { setBusy(false); }
  }

  const link = created ? simulatorUrl(created.id, app.demo) : '';
  return <div className="page narrow">
    <PageHeader title="Nueva sesión" crumbs={[{ label: 'Sesiones', to: '/sesiones' }, { label: 'Nueva sesión' }]} description="Elige el escenario, ponle nombre y comparte el enlace con tu grupo."/>
    <ol className="stepper" aria-label="Pasos">
      {STEPS.map((label, i) => <li key={label} className={i < step || created ? 'done' : i === step ? 'current' : ''} aria-current={i === step ? 'step' : undefined}><span>{i < step || created ?<Icon name="check" size={14}/> : i + 1}</span>{label}</li>)}
    </ol>

    {step === 0 && <section aria-labelledby="step-title">
      <h2 id="step-title" className="step-title" tabIndex={-1} data-step-title>Elige un escenario</h2>
      {scenarios === null ? <div className="scenario-grid">{[0, 1].map(i => <div className="scenario-card" key={i} aria-hidden="true"><Sk w={120} h={10}/><Sk w="80%" h={20} className="sk-gap"/><Sk w="100%" h={12} className="sk-gap"/><Sk w="90%" h={12} className="sk-gap-s"/></div>)}</div>
      : scenarios.length === 0 ? <div className="card"><EmptyState icon="scenarios" title="No hay escenarios disponibles">Tu organización aún no tiene escenarios publicados.</EmptyState></div>
      : <div className="scenario-grid" role="radiogroup" aria-label="Escenarios">{scenarios.map(item => <ScenarioChoice key={item.id} item={item} detail={app.scenarioDetails[item.id]} selected={item.id === scenarioId} onSelect={() => setScenarioId(item.id)} onPreview={() => setPreview(item.id)}/>)}</div>}
      <div className="step-actions"><button className="btn" onClick={() => navigate('/sesiones')}>Cancelar</button><button className="btn btn-primary" disabled={!chosen} onClick={() => setStep(1)}>Continuar<Icon name="next" size={16}/></button></div>
    </section>}

    {step === 1 && chosen && <section aria-labelledby="step-title">
      <h2 id="step-title" className="step-title" tabIndex={-1} data-step-title>Detalles de la sesión</h2>
      <form className="card form-card" onSubmit={event => { event.preventDefault(); void create(); }}>
        <div className="chosen"><span className="eyebrow">Escenario</span><strong>{chosen.title}</strong><small>{plural(chosen.phases, 'situación', 'situaciones')}{estimatedMinutes(app.scenarioDetails[chosen.id]) ? ` · unos ${estimatedMinutes(app.scenarioDetails[chosen.id])} min` : ''}</small><button type="button" className="link" onClick={() => setStep(0)}>Cambiar</button></div>
        <label className="field" htmlFor="session-name"><span>Nombre de la sesión <em className="optional">opcional</em></span>
          <input id="session-name" value={name} maxLength={80} placeholder={placeholder} onChange={event => setName(event.target.value)} aria-describedby="session-name-hint" autoComplete="off"/></label>
        <div className="field-meta"><small id="session-name-hint">Te ayuda a distinguirla en el listado (p. ej., asignatura y grupo). Si lo dejas vacío, se usará el escenario y la fecha.</small><small className="tabular">{name.length}/80</small></div>
        {error && <p className="error" role="alert">{error}</p>}
        <div className="step-actions"><button type="button" className="btn" onClick={() => setStep(0)}><Icon name="back" size={16}/>Atrás</button><button className="btn btn-primary" disabled={busy}>{busy ? 'Creando…' : 'Crear sesión'}</button></div>
      </form>
    </section>}

    {step === 2 && created && <section aria-labelledby="step-title">
      <div className="card ready-card">
        <span className="ready-icon" aria-hidden="true"><Icon name="check" size={26}/></span>
        <h2 id="step-title" className="step-title" tabIndex={-1} data-step-title>La sesión «{created.name}» está lista</h2>
        <p>Comparte el enlace con tu grupo. El tiempo de la primera situación empieza cuando entra el primer participante.</p>
        <div className="share-box"><label className="sr-only" htmlFor="share-link">Enlace para participantes</label><input id="share-link" readOnly value={link} onFocus={event => event.currentTarget.select()}/><CopyButton text={link} className="btn btn-primary"/></div>
        <div className="wizard-join"><JoinShare api={app.api} sessionId={created.id} variant="card"/></div>
        <ol className="steps-list compact">
          <li><span>1</span><div><strong>Comparte el enlace</strong><p>Por el campus virtual, el correo o proyectándolo en el aula.</p></div></li>
          <li><span>2</span><div><strong>Cada participante entra con su correo y su código</strong><p>Si alguien no tiene acceso, dale de alta en Participantes y accesos.</p></div></li>
          <li><span>3</span><div><strong>Conduce la sesión desde el panel</strong><p>Abre cada situación, sigue la votación y finaliza para obtener el informe.</p></div></li>
        </ol>
        <div className="step-actions center"><button className="btn btn-primary btn-lg" onClick={() => navigate(`/sesiones/${created.id}`)}>Abrir panel de la sesión</button><button className="btn btn-lg" onClick={() => actions.project(created.id)}><Icon name="project" size={18}/>Proyectar en clase</button></div>
      </div>
    </section>}

    {preview && app.scenarioDetails[preview] && <Modal title={app.scenarioDetails[preview].title} size="lg" onClose={() => setPreview(null)} description={app.scenarioDetails[preview].summary}
      footer={<><button className="btn" onClick={() => setPreview(null)}>Cerrar</button><button className="btn btn-primary" onClick={() => { setScenarioId(preview); setPreview(null); setStep(1); }}>Usar este escenario</button></>}>
      <ScenarioOutline scenario={app.scenarioDetails[preview]}/>
    </Modal>}
  </div>;
}

function ScenarioChoice({ item, detail, selected, onSelect, onPreview }: { item: ScenarioSummary; detail?: Scenario; selected: boolean; onSelect: () => void; onPreview: () => void }) {
  const minutes = estimatedMinutes(detail);
  return <div className={`scenario-card selectable ${selected ? 'selected' : ''}`}>
    <button type="button" role="radio" aria-checked={selected} className="scenario-select" onClick={onSelect}>
      <span className="radio" aria-hidden="true"/>
      <span className="scenario-meta">{plural(item.phases, 'situación', 'situaciones')}{minutes ? ` · unos ${minutes} min` : ''}</span>
      <strong>{item.title}</strong>
      <span className="scenario-summary">{item.summary}</span>
    </button>
    <button type="button" className="link" onClick={onPreview} disabled={!detail}>Ver situaciones</button>
  </div>;
}

/** Resumen de las situaciones (sin valoraciones): para elegir escenario. */
export function ScenarioOutline({ scenario }: { scenario: Scenario }) {
  return <ol className="outline">{scenario.phases.map((phase, i) => <li key={phase.id}><span>{i + 1}</span><div><strong>{phase.title}</strong><p>{phase.briefing}</p><small>{plural(phase.options.length, 'opción', 'opciones')}{phase.timeLimitSec ? ` · ${Math.round(phase.timeLimitSec / 60)} min` : ' · sin límite de tiempo'}</small></div></li>)}</ol>;
}
