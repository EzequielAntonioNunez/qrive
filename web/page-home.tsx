/** Inicio. Docente: saludo, indicadores de la organización, sesiones abiertas y finalizadas recientes. Participante: «Mis sesiones». */
import React from 'react';
import { isMine, scenarioTitleOf, simulatorUrl, titleOf, useApp, useSessionActions } from './app-context';
import { ActionMenu, EmptyState, Icon, PageHeader, StatusPill } from './kit';
import { Link, navigate } from './router';
import { AnalyticsStrip } from './page-analytics';
import { sessionMenu } from './session-menu';
import { plural, relativeDate, type SessionSummary } from './types';
import { Sk } from './ui';

function greeting(): string {
  const hour = new Date().getHours();
  return hour < 14 ? 'Buenos días' : hour < 21 ? 'Buenas tardes' : 'Buenas noches';
}
function firstName(name: string): string { return name.trim().split(/\s+/)[0] ?? ''; }

export function progressText(session: SessionSummary): string | null {
  if (session.status === 'complete') {
    if (!session.phaseCount) return null;
    // Cierre anticipado: se indica cuántas situaciones se llegaron a trabajar.
    if (session.phaseIndex != null && session.phaseIndex + 1 < session.phaseCount) return `${session.phaseIndex + 1} de ${plural(session.phaseCount, 'situación', 'situaciones')}`;
    return plural(session.phaseCount, 'situación', 'situaciones');
  }
  if (session.phaseIndex == null || !session.phaseCount) return null;
  return `Situación ${session.phaseIndex + 1} de ${session.phaseCount}`;
}
export function peopleText(session: SessionSummary): string | null {
  if (session.participantCount == null) return null;
  const simulated = session.simulatedCount ?? 0;
  const real = Math.max(0, session.participantCount - simulated);
  if (!real && simulated) return plural(simulated, 'simulado', 'simulados');
  return `${plural(real, 'participante', 'participantes')}${simulated ? ` · ${simulated} simulados` : ''}`;
}

export function HomePage() {
  const app = useApp();
  return app.isInstructor ? <InstructorHome/> : <ParticipantHome/>;
}

function InstructorHome() {
  const app = useApp();
  const actions = useSessionActions();
  const { sessions, identity, scenarios } = app;
  const openSessions = (sessions ?? []).filter(item => item.status !== 'complete').sort((a, b) => Number(isMine(b, identity)) - Number(isMine(a, identity)));
  const finished = (sessions ?? []).filter(item => item.status === 'complete').sort((a, b) => (b.completedAt ?? b.createdAt).localeCompare(a.completedAt ?? a.createdAt));
  const now = new Date();
  const thisMonth = finished.filter(item => { const date = new Date(item.completedAt ?? item.createdAt); return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth(); }).length;
  const active = openSessions.filter(item => item.status === 'active').length;
  const paused = openSessions.length - active;
  const hasCounts = (sessions ?? []).some(item => item.participantCount != null);
  const people = (sessions ?? []).reduce((sum, item) => sum + Math.max(0, (item.participantCount ?? 0) - (item.simulatedCount ?? 0)), 0);

  return <div className="page">
    <PageHeader title={`${greeting()}, ${firstName(identity.name)}`} description={sessions?.length === 0 ? 'Te damos la bienvenida al Simulador de decisiones.' : 'Prepara una simulación, sigue las decisiones de tu grupo en directo y cierra con el informe de impacto.'}
      actions={sessions?.length === 0 ? undefined : <button className="btn btn-primary btn-lg" onClick={() => navigate('/sesiones/nueva')}><Icon name="plus" size={18}/>Nueva sesión</button>}/>

    {sessions?.length !== 0 && <section className="stat-row" aria-label="Resumen de la organización">
      <Stat label="Sesiones en curso" value={sessions ? active : null} sub={sessions ? (paused ? `${paused} en pausa` : 'Ahora mismo') : ''}/>
      <Stat label="Participantes" value={sessions ? (hasCounts ? people : null) : null} sub={hasCounts ? `en ${plural(sessions!.length, 'sesión', 'sesiones')} recientes` : 'Sin datos todavía'} loading={!sessions}/>
      <Stat label="Finalizadas este mes" value={sessions ? thisMonth : null} sub={now.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}/>
    </section>}
    {!!sessions?.length && <AnalyticsStrip expected={people > 0}/>}

    {sessions === null ? <section className="section"><div className="section-title"><Sk w={140} h={14}/></div><div className="live-grid">{[0, 1].map(i => <div className="live-card" key={i} aria-hidden="true"><Sk w={90} h={20}/><Sk w="80%" h={18} className="sk-gap"/><Sk w="50%" h={12} className="sk-gap-s"/><Sk w="100%" h={36} className="sk-gap"/></div>)}</div></section>
    : sessions.length === 0 ? <FirstRun/>
    : <>
      <section className="section" aria-labelledby="live-title">
        <div className="section-title"><h2 id="live-title">En curso ahora</h2>{openSessions.length > 0 && <Link className="link" to="/sesiones?estado=abiertas">Ver todas</Link>}</div>
        {openSessions.length === 0
          ? <div className="card"><EmptyState icon="sessions" title="No hay sesiones abiertas" action={<button className="btn btn-primary" onClick={() => navigate('/sesiones/nueva')}><Icon name="plus" size={16}/>Nueva sesión</button>}>Cuando crees una sesión, aparecerá aquí con sus accesos rápidos para proyectarla, pausarla o finalizarla.</EmptyState></div>
          : <div className="live-grid">{openSessions.slice(0, 6).map(item => <LiveCard key={item.id} session={item}/>)}</div>}
      </section>
      <section className="section" aria-labelledby="done-title">
        <div className="section-title"><h2 id="done-title">Finalizadas recientemente</h2>{finished.length > 0 && <Link className="link" to="/sesiones?estado=finalizadas">Ver todas</Link>}</div>
        {finished.length === 0 ? <div className="card"><p className="empty-line pad">Aún no has finalizado ninguna sesión. Al terminar una, aquí tendrás su informe de impacto.</p></div>
        : <ul className="list-card">{finished.slice(0, 5).map(item => <li key={item.id}>
            <Link to={`/sesiones/${item.id}`} className="list-main"><strong>{titleOf(item, scenarios)}</strong><small>{scenarioTitleOf(item, scenarios)} · {relativeDate(item.completedAt ?? item.createdAt)}{peopleText(item) ? ` · ${peopleText(item)}` : ''}</small></Link>
            <button className="btn btn-sm" onClick={() => actions.report(item.id)}><Icon name="report" size={16}/>Ver informe</button>
          </li>)}</ul>}
      </section>
    </>}
  </div>;
}

function Stat({ label, value, sub, loading }: { label: string; value: number | null; sub: string; loading?: boolean }) {
  return <div className="stat"><span className="stat-label">{label}</span>{value == null ? (loading !== false && sub === '' ? <Sk w={60} h={34} className="sk-gap-s"/> : <strong className="stat-value muted-value">—</strong>) : <strong className="stat-value">{value.toLocaleString('es-ES')}</strong>}<span className="stat-sub">{sub}</span></div>;
}

function LiveCard({ session }: { session: SessionSummary }) {
  const app = useApp();
  const actions = useSessionActions();
  const mine = isMine(session, app.identity);
  const progress = progressText(session);
  const ratio = session.phaseIndex != null && session.phaseCount ? (session.phaseIndex + (session.status === 'complete' ? 1 : 0.5)) / session.phaseCount : null;
  return <article className="live-card">
    <div className="live-card-top"><StatusPill status={session.status}/><ActionMenu label={`Acciones de ${titleOf(session, app.scenarios)}`} items={sessionMenu(session, actions, { mine, standalone: app.standalone, omit: ['open', 'project', 'pause', 'resume', 'finish'] })}/></div>
    <h3><Link to={`/sesiones/${session.id}`}>{titleOf(session, app.scenarios)}</Link></h3>
    <p className="live-card-meta">{scenarioTitleOf(session, app.scenarios)}</p>
    <div className="live-card-facts">{progress && <span><Icon name="layers" size={14}/>{progress}</span>}{peopleText(session) && <span><Icon name="users" size={14}/>{peopleText(session)}</span>}<span><Icon name="clock" size={14}/>{relativeDate(session.createdAt)}</span>{!mine && session.instructorName && <span>De {session.instructorName}</span>}</div>
    {ratio != null && <span className="progress-line" aria-hidden="true"><i style={{ width: `${Math.min(100, ratio * 100)}%` }}/></span>}
    <div className="live-card-actions">
      <button className="btn btn-primary btn-sm" onClick={() => actions.open(session.id)}>Abrir</button>
      <button className="btn btn-sm" onClick={() => actions.project(session.id)}><Icon name="project" size={16}/>Proyectar</button>
      {mine && session.status === 'active' && <button className="btn btn-sm btn-quiet" onClick={() => void actions.pause(session.id)}><Icon name="pause" size={16}/>Pausar</button>}
      {mine && session.status === 'paused' && <button className="btn btn-sm btn-quiet" onClick={() => void actions.resume(session.id)}><Icon name="play" size={16}/>Reanudar</button>}
      {mine && <button className="btn btn-sm btn-quiet" onClick={() => void actions.finish(session)}><Icon name="stop" size={16}/>Finalizar</button>}
    </div>
  </article>;
}

function FirstRun() {
  return <section className="first-run" aria-labelledby="first-title">
    <div className="first-run-hero">
      <span className="eyebrow">Empieza aquí</span>
      <h2 id="first-title">Entrena la toma de decisiones con situaciones reales del aula</h2>
      <p>Tu grupo decide en cada situación desde su navegador; tú sigues las respuestas en directo y cierras con un informe de impacto listo para el debate.</p>
      <div className="hero-actions"><button className="btn btn-light btn-lg" onClick={() => navigate('/sesiones/nueva')}><Icon name="plus" size={18}/>Crear tu primera sesión</button><button className="btn btn-ghost-light btn-lg" onClick={() => navigate('/escenarios')}>Explorar escenarios</button></div>
    </div>
    <FirstRunPath/>
  </section>;
}

/** Camino de tres pasos del primer uso (Inicio y estados vacíos). */
export function FirstRunPath() {
  return <ol className="path">
    <li><span className="path-icon"><Icon name="plus" size={20}/></span><div><small>Paso 1</small><strong>Crea la sesión</strong><p>Elige un escenario del catálogo y ponle el nombre de tu grupo. Menos de un minuto.</p></div></li>
    <li><span className="path-icon"><Icon name="link" size={20}/></span><div><small>Paso 2</small><strong>Invita a la clase</strong><p>Proyecta el QR o el código de seis cifras: cada participante entra desde su móvil u ordenador con un alias, sin cuenta ni instalaciones.</p></div></li>
    <li><span className="path-icon"><Icon name="project" size={20}/></span><div><small>Paso 3</small><strong>Proyecta en clase</strong><p>Sigue la votación en directo, revela la mejor opción y descarga el informe al terminar.</p></div></li>
  </ol>;
}

function ParticipantHome() {
  const app = useApp();
  const { sessions, scenarios, identity } = app;
  return <div className="page">
    <PageHeader title={`Hola, ${firstName(identity.name)}`} description="Aquí tienes las simulaciones en las que participas. Tus respuestas son individuales: tus compañeros no las ven."/>
    <div className="participant-layout">
      <section className="section" aria-labelledby="mine-title">
        <div className="section-title"><h2 id="mine-title">Mis sesiones</h2></div>
        {sessions === null ? <ul className="list-card">{[0, 1].map(i => <li key={i} aria-hidden="true"><div className="list-main"><Sk w={220} h={14}/><Sk w={160} h={10} className="sk-gap-s"/></div><Sk w={120} h={34}/></li>)}</ul>
        : sessions.length === 0 ? <div className="card"><EmptyState icon="sessions" title="Todavía no participas en ninguna sesión">Cuando abras el enlace que te comparta tu docente y te unas, la sesión aparecerá aquí con tus resultados.</EmptyState></div>
        : <ul className="list-card">{sessions.map(item => <li key={item.id}>
            <Link to={`/sesiones/${item.id}`} className="list-main"><strong>{scenarioTitleOf(item, scenarios)}</strong><small><StatusPill status={item.status} className="pill-inline"/> {relativeDate(item.createdAt)}</small></Link>
            <div className="row-actions">{item.status !== 'complete' && !app.standalone && <a className="btn btn-primary btn-sm" href={simulatorUrl(item.id, app.demo)}><Icon name="external" size={16}/>Abrir simulador</a>}<Link className="btn btn-sm" to={`/sesiones/${item.id}`}>{item.status === 'complete' ? 'Ver mis resultados' : 'Ver en la consola'}</Link></div>
          </li>)}</ul>}
      </section>
      <aside className="card help-card" aria-labelledby="how-title">
        <h2 id="how-title" className="card-title">Cómo participar</h2>
        <ol className="steps-list compact">
          <li><span>1</span><div><strong>Abre el enlace de tu docente</strong><p>Te lo compartirá en clase o por el campus virtual. Funciona en el navegador, sin instalar nada.</p></div></li>
          <li><span>2</span><div><strong>Entra con tu correo y tu código</strong><p>El código de seis cifras es personal. Si lo has perdido, pide uno nuevo a tu docente.</p></div></li>
          <li><span>3</span><div><strong>Decide en cada situación</strong><p>Elige la opción que te parezca mejor. Al final verás tus resultados y las ideas clave.</p></div></li>
        </ol>
        <p className="fine-print">Las valoraciones se refieren a las decisiones, nunca a las personas. El personaje es virtual y sus intervenciones están guionizadas.</p>
      </aside>
    </div>
  </div>;
}
