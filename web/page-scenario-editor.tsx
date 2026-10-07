/**
 * «Convertir en escenario para clase»: revisión y publicación del borrador generado a partir de una partida del
 * modo IA en vivo. El docente revisa y edita TODO antes de publicar (supervisión humana: AI Act); al publicar se
 * convierte en un escenario versionado normal (inmutable) que sirve para sesiones, invitados, proyector e informes.
 * El borrador editado se guarda solo en este navegador (localStorage) hasta que se publica.
 */
import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChoiceQuality, Phase, Scenario } from '../shared/simulation';
import { AI_DRAFT_MIN_PHASES, SCENARIO_LIMITS, effectsFor } from '../shared/ai-draft';
import { useApp, type ApiError } from './app-context';
import { EmptyState, Icon, PageHeader, useDialogs } from './kit';
import { Link, navigate } from './router';
import { errorText, optionLetter, plural } from './types';
import { Sk, useToast } from './ui';
import './scenario-editor.css';

type DraftResponse = { draft: Scenario; warnings: string[]; latestVersion: number | null; run: { id: string; status: string; generated: number; total: number } };
type Saved = { draft: Scenario; savedAt: string };

const storageKey = (runId: string) => `ufv-borrador-escenario:${runId}`;
function readSaved(runId: string): Saved | null {
  try { const raw = localStorage.getItem(storageKey(runId)); return raw ? JSON.parse(raw) as Saved : null; } catch { return null; }
}
function writeSaved(runId: string, draft: Scenario) {
  try { localStorage.setItem(storageKey(runId), JSON.stringify({ draft, savedAt: new Date().toISOString() } satisfies Saved)); } catch { /* sin almacenamiento */ }
}
function clearSaved(runId: string) { try { localStorage.removeItem(storageKey(runId)); } catch { /* sin almacenamiento */ } }

const TIMES = [60, 90, 120, 180, 240, 300, 480];
const QUALITY_TEXT: Record<ChoiceQuality, string> = { best: 'Mejor opción', acceptable: 'Aceptable', poor: 'Crítica' };

/** Problemas de validación por campo (mismas reglas que shared/scenario.ts y las extra de publicación). */
function problemsOf(draft: Scenario): Record<string, string> {
  const out: Record<string, string> = {};
  const check = (path: string, value: string | undefined, max: number, required = true) => {
    const length = (value ?? '').trim().length;
    if (required && !length) out[path] = 'Obligatorio.';
    else if ((value ?? '').length > max) out[path] = `Máximo ${max} caracteres (ahora ${(value ?? '').length}).`;
  };
  check('title', draft.title, SCENARIO_LIMITS.title);
  check('summary', draft.summary, SCENARIO_LIMITS.summary);
  if (draft.phases.length < AI_DRAFT_MIN_PHASES) out.phases = `Hacen falta al menos ${AI_DRAFT_MIN_PHASES} situaciones.`;
  draft.phases.forEach((phase, i) => {
    check(`p${i}.title`, phase.title, SCENARIO_LIMITS.phaseTitle);
    check(`p${i}.briefing`, phase.briefing, SCENARIO_LIMITS.briefing);
    check(`p${i}.characterLine`, phase.characterLine, SCENARIO_LIMITS.characterLine);
    if (phase.takeaway !== undefined) check(`p${i}.takeaway`, phase.takeaway, SCENARIO_LIMITS.takeaway, false);
    phase.options.forEach((option, j) => {
      check(`p${i}.o${j}.label`, option.label, SCENARIO_LIMITS.label);
      check(`p${i}.o${j}.consequence`, option.consequence, SCENARIO_LIMITS.consequence);
      check(`p${i}.o${j}.rationale`, option.rationale, SCENARIO_LIMITS.rationale);
    });
    if (!phase.options.some(option => option.quality === 'best')) out[`p${i}.best`] = 'Marca al menos una opción como «Mejor opción».';
  });
  return out;
}

/** Limpia el borrador para enviarlo: textos recortados y la idea clave vacía se omite. */
function cleaned(draft: Scenario): Scenario {
  const trim = (value: string) => value.replace(/\s+/g, ' ').trim();
  return {
    ...draft,
    title: trim(draft.title), summary: trim(draft.summary),
    phases: draft.phases.map(phase => {
      const { takeaway, ...rest } = phase;
      const next: Phase = { ...rest, title: trim(phase.title), briefing: trim(phase.briefing), characterLine: trim(phase.characterLine),
        options: phase.options.map(option => ({ ...option, label: trim(option.label), consequence: trim(option.consequence), rationale: trim(option.rationale ?? '') })) };
      if (takeaway?.trim()) next.takeaway = trim(takeaway);
      return next;
    })
  };
}

export function ScenarioEditorPage({ runId }: { runId: string }) {
  const app = useApp();
  const toast = useToast();
  const { confirm } = useDialogs();
  const [server, setServer] = useState<DraftResponse | null>(null);
  const [draft, setDraft] = useState<Scenario | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ title: string; text: string } | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState('');
  const [conflict, setConflict] = useState<number | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const dirty = useRef(false);

  useEffect(() => { document.title = 'Revisar escenario generado con IA · Escenarios'; }, []);
  useEffect(() => {
    let stop = false;
    void app.api<DraftResponse>(`/ai-runs/${encodeURIComponent(runId)}/draft`, { method: 'POST', body: '{}' }).then(result => {
      if (stop) return;
      setServer(result);
      const saved = readSaved(runId);
      if (saved?.draft?.phases?.length) {
        setDraft({ ...saved.draft, version: Math.max(saved.draft.version, result.draft.version) });
        setRestored(saved.savedAt);
      } else setDraft(result.draft);
    }).catch(cause => {
      if (stop) return;
      const status = (cause as ApiError).status;
      setFailure(status === 404 ? { title: 'No encontramos esta partida', text: 'Puede que se haya borrado (las partidas de demostración se eliminan con la retención) o que sea de otra persona.' }
        : status === 409 ? { title: 'Aún no hay situaciones suficientes', text: errorText(cause) }
        : { title: 'No se ha podido preparar el borrador', text: errorText(cause) });
    });
    return () => { stop = true; };
  }, [app.api, runId]);

  // Autoguardado local (solo en este navegador) mientras se edita.
  useEffect(() => {
    if (!draft || !dirty.current) return;
    const timer = window.setTimeout(() => writeSaved(runId, draft), 500);
    return () => window.clearTimeout(timer);
  }, [draft, runId]);

  const update = useCallback((change: (current: Scenario) => Scenario) => {
    dirty.current = true;
    setDraft(current => current ? change(current) : current);
    setPublishError(''); setConflict(null);
  }, []);
  const updatePhase = useCallback((index: number, patch: Partial<Phase>) => update(current => ({ ...current, phases: current.phases.map((phase, i) => i === index ? { ...phase, ...patch } : phase) })), [update]);
  const updateOption = useCallback((index: number, optionIndex: number, patch: Partial<Phase['options'][number]>) => update(current => ({
    ...current, phases: current.phases.map((phase, i) => i !== index ? phase : { ...phase, options: phase.options.map((option, j) => j === optionIndex ? { ...option, ...patch } : option) })
  })), [update]);
  const move = (index: number, delta: number) => update(current => {
    const phases = [...current.phases];
    const target = index + delta;
    if (target < 0 || target >= phases.length) return current;
    [phases[index], phases[target]] = [phases[target], phases[index]];
    return { ...current, phases };
  });
  async function remove(index: number) {
    if (!draft || draft.phases.length <= AI_DRAFT_MIN_PHASES) return;
    const ok = await confirm({ title: '¿Quitar esta situación?', tone: 'danger', confirmLabel: 'Quitar situación', body: <p>«{draft.phases[index].title}» no formará parte del escenario. Puedes recuperarla con «Volver al borrador original».</p> });
    if (ok) update(current => ({ ...current, phases: current.phases.filter((_, i) => i !== index) }));
  }
  async function resetToServer() {
    if (!server) return;
    const ok = await confirm({ title: '¿Volver al borrador original?', tone: 'danger', confirmLabel: 'Descartar mis cambios', body: <p>Se perderán los cambios guardados en este navegador.</p> });
    if (!ok) return;
    clearSaved(runId); dirty.current = false; setRestored(null); setDraft(server.draft); setShowErrors(false);
  }

  const problems = useMemo(() => draft ? problemsOf(draft) : {}, [draft]);
  const problemCount = Object.keys(problems).length;
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const touch = (path: string) => setTouched(current => current.has(path) ? current : new Set([...current, path]));
  const err = (path: string) => showErrors || touched.has(path) ? problems[path] : undefined;

  async function publish(version?: number) {
    if (!draft) return;
    if (problemCount) { setShowErrors(true); setPublishError(problemCount === 1 ? 'Corrige el campo marcado antes de publicar.' : `Corrige los ${problemCount} campos marcados antes de publicar.`); window.setTimeout(() => document.querySelector<HTMLElement>('.se-field.invalid textarea, .se-field.invalid input, .se-problem')?.focus(), 30); return; }
    const scenario = cleaned({ ...draft, version: version ?? draft.version });
    const ok = await confirm({
      title: 'Publicar escenario', confirmLabel: 'Publicar escenario',
      body: <><p>«{scenario.title}» quedará disponible para crear sesiones de clase en tu organización (versión {scenario.version}).</p><p>Las versiones publicadas no se pueden modificar: un cambio posterior será una versión nueva. Confirmas que has revisado el contenido generado con IA.</p></>
    });
    if (!ok) return;
    setPublishing(true); setPublishError('');
    try {
      const result = await app.api<{ scenario: Scenario }>(`/ai-runs/${encodeURIComponent(runId)}/publish`, { method: 'POST', body: JSON.stringify({ scenario }) });
      clearSaved(runId); dirty.current = false;
      await app.reloadScenarios?.(result.scenario.id);
      toast('Escenario publicado');
      navigate(`/escenarios/${encodeURIComponent(result.scenario.id)}?publicado=1`);
    } catch (cause) {
      setPublishing(false);
      if ((cause as ApiError).status === 409) {
        // Ya existe esa versión: se consulta la última para ofrecer la siguiente.
        const fresh = await app.api<DraftResponse>(`/ai-runs/${encodeURIComponent(runId)}/draft`, { method: 'POST', body: '{}' }).catch(() => null);
        const latest = fresh?.latestVersion ?? draft.version;
        setConflict(latest);
        setPublishError(errorText(cause));
      } else setPublishError(errorText(cause));
    }
  }

  const crumbs = [{ label: 'Escenarios', to: '/escenarios' }, { label: 'Modo IA en vivo', to: '/escenarios/ia' }, { label: 'Revisar escenario' }];
  if (failure) return <div className="page"><PageHeader title="Convertir en escenario para clase" crumbs={crumbs}/>
    <div className="card"><EmptyState icon="sparkles" title={failure.title} action={<><button className="btn btn-primary" onClick={() => navigate(`/ia/${encodeURIComponent(runId)}`)}>Volver a la partida</button><button className="btn" onClick={() => navigate('/escenarios/ia')}>Ir a colecciones</button></>}>{failure.text}</EmptyState></div></div>;
  if (!draft || !server) return <div className="page" aria-busy="true"><div className="page-header"><Sk w={200} h={10}/><Sk w="min(460px, 80vw)" h={30} className="sk-gap"/><Sk w="min(560px, 85vw)" h={12} className="sk-gap"/></div>{[0, 1].map(i => <div className="card se-phase" key={i}><Sk w={120} h={10}/><Sk w="60%" h={20} className="sk-gap"/><Sk w="100%" h={60} className="sk-gap"/></div>)}<p className="sr-only" role="status">Preparando el borrador…</p></div>;

  const incomplete = server.run.generated < server.run.total;
  return <div className="page se-page">
    <PageHeader crumbs={crumbs} eyebrow="Borrador · sin publicar" title="Revisa el escenario antes de publicarlo"
      description="Edita lo que necesites. Al publicarlo será un escenario normal para tus clases: QR o PIN, proyector, votos en directo, informe y analítica."/>
    <div className="ai-notice se-notice" role="note"><Icon name="sparkles" size={18}/><div><strong>Generado con IA a partir de tus documentos · revisa antes de usarlo con estudiantes.</strong> Comprueba que cada situación, opción y valoración es correcta. La valoración es de cada decisión, nunca de la persona.</div></div>
    {restored && <div className="notice-inline se-restored" role="status"><span>Hemos recuperado los cambios que guardaste en este navegador ({new Date(restored).toLocaleString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}).</span><button className="text-button" onClick={() => void resetToServer()}>Volver al borrador original</button></div>}
    {(incomplete || server.warnings.length > 1) && <ul className="se-warnings" aria-label="Avisos del borrador">{server.warnings.filter(item => !item.startsWith('Revisa todo')).map(item => <li key={item}>{item}</li>)}</ul>}

    <section className="card se-general" aria-labelledby="se-general-title">
      <h2 id="se-general-title" className="se-section-title">Escenario</h2>
      <TextField label="Título" value={draft.title} max={SCENARIO_LIMITS.title} error={err('title')} onBlur={() => touch('title')} onChange={value => update(current => ({ ...current, title: value }))}/>
      <TextField label="Resumen" hint="Se muestra al elegir el escenario." multiline rows={3} value={draft.summary} max={SCENARIO_LIMITS.summary} error={err('summary')} onBlur={() => touch('summary')} onChange={value => update(current => ({ ...current, summary: value }))}/>
      <dl className="se-facts">
        <div><dt>Personaje</dt><dd>{draft.character.name}</dd></div>
        <div><dt>Indicadores</dt><dd>{draft.meterLabels ? `${draft.meterLabels.relationship}, ${draft.meterLabels.margin} y ${draft.meterLabels.risk}` : 'Relación, Margen y Riesgo'}</dd></div>
        <div><dt>Versión</dt><dd>{draft.version}</dd></div>
        <div><dt>Situaciones</dt><dd>{draft.phases.length}</dd></div>
      </dl>
      <p className="se-fine">Los efectos en los indicadores se calculan a partir de la valoración de cada opción. VictorIA no tiene locución grabada para estas situaciones: en el móvil y en el simulador se leen como texto.</p>
    </section>

    {problems.phases && <p className="error se-problem" role="alert" tabIndex={-1}>{problems.phases}</p>}
    <ol className="se-phases">{draft.phases.map((phase, i) => <li key={phase.id} className="card se-phase">
      <div className="se-phase-head">
        <span className="phase-num">{i + 1}</span>
        <span className="eyebrow">Situación {i + 1} de {draft.phases.length}</span>
        <div className="se-phase-tools" role="group" aria-label={`Ordenar o quitar la situación ${i + 1}`}>
          <button type="button" className="icon-button" aria-label={`Subir la situación ${i + 1}`} title="Subir" disabled={i === 0} onClick={() => move(i, -1)}><Chevron up/></button>
          <button type="button" className="icon-button" aria-label={`Bajar la situación ${i + 1}`} title="Bajar" disabled={i === draft.phases.length - 1} onClick={() => move(i, 1)}><Chevron/></button>
          <button type="button" className="icon-button se-danger" aria-label={`Quitar la situación ${i + 1}`} title={draft.phases.length <= AI_DRAFT_MIN_PHASES ? `Mínimo ${AI_DRAFT_MIN_PHASES} situaciones` : 'Quitar'} disabled={draft.phases.length <= AI_DRAFT_MIN_PHASES} onClick={() => void remove(i)}><Icon name="trash" size={16}/></button>
        </div>
      </div>
      <div className="se-grid">
        <TextField label="Título de la situación" value={phase.title} max={SCENARIO_LIMITS.phaseTitle} error={err(`p${i}.title`)} onBlur={() => touch(`p${i}.title`)} onChange={value => updatePhase(i, { title: value })}/>
        <label className="field se-field se-time"><span>Tiempo para decidir</span>
          <select value={phase.timeLimitSec ?? 0} onChange={event => { const value = Number(event.target.value); updatePhase(i, value ? { timeLimitSec: value } : { timeLimitSec: undefined }); }}>
            {TIMES.map(value => <option key={value} value={value}>{value < 60 ? `${value} s` : value % 60 ? `${Math.floor(value / 60)} min ${value % 60} s` : `${value / 60} min`}</option>)}
            {phase.timeLimitSec && !TIMES.includes(phase.timeLimitSec) && <option value={phase.timeLimitSec}>{phase.timeLimitSec} s</option>}
            <option value={0}>Sin temporizador</option>
          </select>
        </label>
      </div>
      <TextField label={`Lo que dice ${draft.character.name}`} hint="La narración de la situación: se muestra en el móvil y en el simulador." multiline rows={3} value={phase.characterLine} max={SCENARIO_LIMITS.characterLine} error={err(`p${i}.characterLine`)} onBlur={() => touch(`p${i}.characterLine`)} onChange={value => updatePhase(i, { characterLine: value })}/>
      <TextField label="Contexto para el grupo" hint="Texto breve bajo el título. Por defecto, las fuentes en las que se basa." multiline rows={2} value={phase.briefing} max={SCENARIO_LIMITS.briefing} error={err(`p${i}.briefing`)} onBlur={() => touch(`p${i}.briefing`)} onChange={value => updatePhase(i, { briefing: value })}/>
      <fieldset className="se-options"><legend>Opciones</legend>
        {problems[`p${i}.best`] && <p className="se-inline-error" role="alert">{problems[`p${i}.best`]}</p>}
        {phase.options.map((option, j) => <div key={option.id} className={`se-option q-${option.quality ?? 'none'}`}>
          <div className="se-option-head">
            <span className="option-letter" aria-hidden="true">{optionLetter(j)}</span>
            <label className="se-quality"><span className="sr-only">Valoración de la opción {optionLetter(j)}</span>
              <select value={option.quality ?? 'acceptable'} onChange={event => { const quality = event.target.value as ChoiceQuality; updateOption(i, j, { quality, effects: effectsFor(quality) }); }}>
                {(['best', 'acceptable', 'poor'] as ChoiceQuality[]).map(value => <option key={value} value={value}>{QUALITY_TEXT[value]}</option>)}
              </select>
            </label>
          </div>
          <TextField label={`Opción ${optionLetter(j)}`} multiline rows={2} value={option.label} max={SCENARIO_LIMITS.label} error={err(`p${i}.o${j}.label`)} onBlur={() => touch(`p${i}.o${j}.label`)} onChange={value => updateOption(i, j, { label: value })}/>
          <TextField label="Consecuencia" multiline rows={2} value={option.consequence} max={SCENARIO_LIMITS.consequence} error={err(`p${i}.o${j}.consequence`)} onBlur={() => touch(`p${i}.o${j}.consequence`)} onChange={value => updateOption(i, j, { consequence: value })}/>
          <TextField label="Por qué" hint="Se muestra después de decidir y en el informe." multiline rows={2} value={option.rationale ?? ''} max={SCENARIO_LIMITS.rationale} error={err(`p${i}.o${j}.rationale`)} onBlur={() => touch(`p${i}.o${j}.rationale`)} onChange={value => updateOption(i, j, { rationale: value })}/>
        </div>)}
      </fieldset>
      <TextField label="Idea clave" hint="Opcional. Lo que debería quedar de esta situación; se muestra tras decidir." multiline rows={2} value={phase.takeaway ?? ''} max={SCENARIO_LIMITS.takeaway} error={err(`p${i}.takeaway`)} onBlur={() => touch(`p${i}.takeaway`)} onChange={value => updatePhase(i, { takeaway: value })}/>
    </li>)}</ol>

    <div className="se-publish card" aria-live="polite">
      <div>
        <strong>¿Todo revisado?</strong>
        <p>{problemCount && showErrors ? (problemCount === 1 ? 'Queda 1 campo por corregir.' : `Quedan ${problemCount} campos por corregir.`) : `Se publicará la versión ${draft.version} con ${plural(draft.phases.length, 'situación', 'situaciones')}. Tus cambios se guardan en este navegador hasta entonces.`}</p>
        {publishError && <p className="error" role="alert">{publishError}</p>}
      </div>
      <div className="se-publish-actions">
        <Link className="btn" to="/escenarios/ia">Seguir más tarde</Link>
        {conflict !== null ? <button className="btn btn-primary btn-lg" disabled={publishing} onClick={() => { update(current => ({ ...current, version: conflict + 1 })); void publish(conflict + 1); }}><Icon name="check" size={18}/>Publicar como versión {conflict + 1}</button>
        : <button className="btn btn-primary btn-lg" disabled={publishing} onClick={() => void publish()}><Icon name="check" size={18}/>{publishing ? 'Publicando…' : 'Publicar escenario'}</button>}
      </div>
    </div>
  </div>;
}

function Chevron({ up = false }: { up?: boolean }) {
  return <svg className="icon" width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={up ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'}/></svg>;
}

function TextField({ label, value, max, onChange, onBlur, error, hint, multiline = false, rows = 2 }: { label: string; value: string; max: number; onChange: (value: string) => void; onBlur?: () => void; error?: string; hint?: string; multiline?: boolean; rows?: number }) {
  const id = useId();
  const over = value.length > max;
  const props = { id, value, onBlur, 'aria-invalid': error ? true : undefined, 'aria-describedby': `${id}-meta`, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value) };
  return <div className={`field se-field ${error ? 'invalid' : ''}`}>
    <label htmlFor={id}>{label}</label>
    {multiline ? <textarea {...props} rows={rows}/> : <input {...props}/>}
    <div className="se-meta" id={`${id}-meta`}><small className={error ? 'se-error-text' : ''}>{error ?? hint ?? ''}</small><small className={`tabular ${over ? 'se-over' : ''}`}>{value.length}/{max}</small></div>
  </div>;
}
