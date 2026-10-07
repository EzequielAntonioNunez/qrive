/**
 * Informe de impacto imprimible (A4). Se descarga como PDF con el diálogo de impresión del navegador:
 * la hoja de estilos @media print oculta el resto de la consola. Solo agrega decisiones; no valora a personas.
 */
import { meterLabels, type SessionState } from '../shared/simulation';
import { brand } from './brand';
import { phaseSummaries, share } from './stats';
import { METERS, longDate, optionLetter, pct, plural, qualityLabel, signed, type ParticipantResult, type Report } from './types';

type Props = { state: SessionState; report: Report; results: ParticipantResult[]; simulatedCount: number; excludeSimulated: boolean; sessionName?: string };

export function ImpactReport({ state, report, results, simulatedCount, excludeSimulated, sessionName }: Props) {
  const labels = meterLabels(state.scenario);
  const summaries = phaseSummaries(state);
  const initial = state.scenario.initialMeters;
  const final = report.meters ?? state.meters;
  const participants = state.participants.length;
  // Situaciones trabajadas: hasta la actual (una sesión puede finalizarse antes de la última).
  const phasesDone = state.status === 'complete' ? state.phaseIndex + 1 : summaries.filter(item => item.tally.decided > 0).length;
  const played = (index: number) => index <= state.phaseIndex;
  const takeaways = state.scenario.phases.filter((phase, index) => phase.takeaway && played(index));
  const issued = new Date();
  const held = longDate(state.createdAt);
  const frequent = summaries.filter(item => item.topIndex >= 0);
  const rated = summaries.some(item => item.bestIndexes.length > 0);

  return <article className="report-sheet" aria-label="Informe de impacto">
    <header className="rs-header">
      <img src={brand.logoOnLight} alt={brand.organization} height="44"/>
      <div><span className="eyebrow">Informe de impacto</span><h1>{state.scenario.title}</h1>
        <p>{sessionName && sessionName !== state.scenario.title ? <>{sessionName} · </> : null}Sesión {state.id.slice(0, 8).toUpperCase()} · {held ? `Celebrada el ${held}` : ''} · Emitido el {longDate(issued)}</p></div>
    </header>
    {state.status !== 'complete' && <p className="rs-provisional">Informe provisional: la sesión sigue en curso y los datos pueden cambiar.</p>}
    {simulatedCount > 0 && <p className="rs-provisional">{excludeSimulated ? `Excluye ${plural(simulatedCount, 'participante simulado', 'participantes simulados')} de demostración.` : `Incluye ${plural(simulatedCount, 'participante simulado', 'participantes simulados')} de demostración.`}</p>}

    <section className="rs-section">
      <h2><span>1</span>Resumen ejecutivo</h2>
      <div className="rs-kpis">
        <div><strong>{participants}</strong><span>Participantes</span></div>
        <div><strong>{phasesDone}/{state.scenario.phases.length}</strong><span>Situaciones trabajadas</span></div>
        <div><strong>{report.decisions}</strong><span>Decisiones registradas</span></div>
        <div><strong>{pct(report.correctDecisionsPct)}</strong><span>Decisiones óptimas</span></div>
      </div>
      <p className="rs-lead">{executiveSentence(report, participants, state, phasesDone)}</p>
      <table className="rs-table rs-meters">
        <thead><tr><th scope="col">Indicador de la clase</th><th scope="col">Inicial</th><th scope="col">Final</th><th scope="col">Variación</th></tr></thead>
        <tbody>{METERS.map(name => {
          const delta = final[name] - initial[name];
          const good = name === 'risk' ? delta < 0 : delta > 0;
          return <tr key={name}><th scope="row">{labels[name]}{name === 'risk' && <small>Cuanto más bajo, mejor</small>}</th><td>{initial[name]}</td><td>{final[name]}</td><td className={delta === 0 ? '' : good ? 'up' : 'down'}>{signed(delta)}</td></tr>;
        })}</tbody>
      </table>
    </section>

    <section className="rs-section">
      <h2><span>2</span>Distribución de decisiones por situación</h2>
      {summaries.map(item => {
        const votes = item.tally.counts.reduce((sum, value) => sum + value, 0);
        if (!played(item.index)) return <div className="rs-phase rs-phase-skipped" key={item.phase.id}>
          <h3>Situación {item.index + 1} · {item.phase.title}<small>{state.status === 'complete' ? 'Sin jugar' : 'Pendiente'}</small></h3>
          <p className="rs-muted">{state.status === 'complete' ? 'La sesión se finalizó antes de llegar a esta situación.' : 'Esta situación aún no se ha abierto.'}</p>
        </div>;
        return <div className="rs-phase" key={item.phase.id}>
          <h3>Situación {item.index + 1} · {item.phase.title}<small>{plural(votes, 'decisión', 'decisiones')}</small></h3>
          {item.phase.options.map((option, i) => {
            const percent = share(item.tally.counts[i] ?? 0, votes);
            return <div className={`rs-bar ${option.quality ?? 'none'}`} key={option.id}>
              <span className="rs-bar-label"><b>{optionLetter(i)}</b>{option.label}</span>
              <span className="rs-bar-track"><i style={{ width: `${percent}%` }}/></span>
              <span className="rs-bar-value">{percent} %<small>({item.tally.counts[i] ?? 0})</small></span>
              {option.quality && <span className={`rs-tag ${option.quality}`}>{qualityLabel(option.quality)}</span>}
            </div>;
          })}
          {votes === 0 && <p className="rs-muted">Sin decisiones registradas en esta situación.</p>}
        </div>;
      })}
    </section>

    <section className="rs-section rs-avoid-break">
      <h2><span>3</span>Decisiones más frecuentes</h2>
      {frequent.length ? <table className="rs-table">
        <thead><tr><th scope="col">Situación</th><th scope="col">Opción más elegida</th><th scope="col">Elegida por</th>{rated && <th scope="col">Valoración</th>}{rated && <th scope="col">Eligió la mejor</th>}</tr></thead>
        <tbody>{frequent.map(item => {
          const votes = item.tally.counts.reduce((sum, value) => sum + value, 0);
          const option = item.phase.options[item.topIndex];
          return <tr key={item.phase.id}><th scope="row">{item.index + 1}. {item.phase.title}</th><td>{option.label}</td><td>{share(item.tally.counts[item.topIndex], votes)} %</td>{rated && <td>{qualityLabel(option.quality)}</td>}{rated && <td>{pct(item.bestShare)}</td>}</tr>;
        })}</tbody>
      </table> : <p className="rs-muted">Todavía no hay decisiones registradas.</p>}
    </section>

    {takeaways.length > 0 && <section className="rs-section rs-avoid-break">
      <h2><span>4</span>Ideas clave</h2>
      <ol className="rs-takeaways">{takeaways.map(phase => <li key={phase.id}><strong>{phase.title}</strong><p>{phase.takeaway}</p></li>)}</ol>
    </section>}

    <section className="rs-section">
      <h2><span>{takeaways.length > 0 ? 5 : 4}</span>Resultados por participante</h2>
      {results.length ? <table className="rs-table rs-people">
        <thead><tr><th scope="col">Participante</th><th scope="col">Puntuación</th><th scope="col">Decisiones óptimas</th><th scope="col">Críticas</th><th scope="col">Decisiones</th></tr></thead>
        <tbody>{results.map(row => <tr key={row.userId}><th scope="row">{row.name ?? 'Participante'}{row.simulated && <em className="tag-sim">Simulado</em>}</th><td>{row.score ?? '—'}</td><td>{pct(row.correctDecisionsPct)}</td><td>{row.criticalDecisions ?? '—'}</td><td>{row.decisions ?? '—'}</td></tr>)}</tbody>
      </table> : <p className="rs-muted">No hay participantes en esta sesión.</p>}
    </section>

    <section className="rs-section rs-method rs-avoid-break">
      <h2><span>{takeaways.length > 0 ? 6 : 5}</span>Nota metodológica</h2>
      <ul>
        <li>Cada situación tiene opciones con efectos fijos definidos por el equipo docente en el diseño del escenario (versión {state.scenario.version}). Los resultados se obtienen con reglas deterministas: no interviene ningún modelo de inteligencia artificial en la valoración.</li>
        <li>Las valoraciones («Mejor opción», «Aceptable», «Crítica») califican la decisión tomada, nunca a la persona. El simulador no infiere emociones ni estados psicológicos.</li>
        <li>La puntuación resume los indicadores del escenario ({METERS.map(name => labels[name]).join(', ')}) en una escala de 0 a 100. Los indicadores de la clase son la media de los participantes.</li>
        <li>{characterNote(state)}</li>
      </ul>
    </section>

    <footer className="rs-footer"><span>{brand.organization} · {brand.product}</span><span>Informe de impacto · {longDate(issued)}</span></footer>
  </article>;
}

function executiveSentence(report: Report, participants: number, state: SessionState, phasesDone: number): string {
  if (!participants) return 'La sesión aún no tiene participantes. El informe se completará a medida que se registren decisiones.';
  const total = state.scenario.phases.length;
  const worked = state.status === 'complete' && phasesDone < total ? `${phasesDone} de ${plural(total, 'situación', 'situaciones')}` : plural(total, 'situación', 'situaciones');
  const parts = [`${plural(participants, 'participante trabajó', 'participantes trabajaron')} ${worked} sobre «${state.scenario.title}» y ${participants === 1 ? 'registró' : 'registraron'} ${plural(report.decisions, 'decisión', 'decisiones')}.`];
  if (report.correctDecisionsPct != null) parts.push(`El ${report.correctDecisionsPct} % de las decisiones coincidió con la mejor opción definida por el escenario.`);
  if (report.criticalDecisions) parts.push(`${plural(report.criticalDecisions, 'decisión se valoró', 'decisiones se valoraron')} como crítica${report.criticalDecisions === 1 ? '' : 's'}: son el mejor punto de partida para el debate.`);
  return parts.join(' ');
}

function characterNote(state: SessionState): string {
  const name = state.scenario.character?.name || 'VictorIA';
  const origin = state.scenario.origin?.kind === 'ai'
    ? 'el escenario se redactó con IA a partir de documentos y lo revisó un docente antes de publicarlo'
    : 'sus intervenciones están guionizadas y grabadas de antemano';
  return `${name} es un personaje virtual con imagen y voz sintéticas; ${origin}. Los participantes aparecen con el nombre con el que figuran en la consola.`;
}
