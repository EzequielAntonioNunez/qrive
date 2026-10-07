import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Scenario } from '../shared/simulation';
import { AppProvider, type ApiError, type AppContextValue } from './app-context';
import { brand } from './brand';
import './style.css';
import './polish.css';
import './app.css';
import { DialogProvider, Icon, PageHeader } from './kit';
import { AnalyticsPage } from './page-analytics';
import { HomePage } from './page-home';
import { NewSessionPage } from './page-new-session';
import { PeoplePage } from './page-people';
import { ScenarioPage, ScenariosPage } from './page-scenarios';
import { SessionPage } from './page-session';
import { SessionsPage } from './page-sessions';
import { Link, navigate, useLegacyRedirect, useLocation, type Route } from './router';
import { installStandaloneApi } from './standalone';
import { errorText, roleLabel, type Identity, type Role, type ScenarioSummary, type SessionSummary } from './types';
import { Sk, ToastProvider } from './ui';
import { parsePublicRoute } from './guest';
import { JoinPage } from './page-join';
import { PlayPage } from './page-play';
import { aiLiveFlag } from './ai-live-types';
import { KnowledgePage } from './page-knowledge';
const AiLivePage = React.lazy(() => import('./page-ai-live').then(module => ({ default: module.AiLivePage })));

const standalone = import.meta.env.VITE_STANDALONE === '1';
if (standalone) installStandaloneApi();

type Me = { identity: Identity; demo: boolean; flags?: { phase_timers?: boolean; realtime_websocket?: boolean; ai_live_demo?: boolean }; permissions?: { assignInstructor?: boolean } };

function App() {
  useLegacyRedirect();
  const { route, path } = useLocation();
  const [demoUser, setDemoUser] = useState<Role>('instructor');
  const [me, setMe] = useState<Me | null>(null);
  const [authRequired, setAuthRequired] = useState<boolean | null>(standalone ? false : null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioSummary[] | null>(null);
  const [scenarioDetails, setScenarioDetails] = useState<Record<string, Scenario>>({});
  const [loadError, setLoadError] = useState('');
  const [drawer, setDrawer] = useState(false);
  const loading = useRef(new Map<string, Promise<Scenario | null>>());

  const api = useCallback(async <T,>(apiPath: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(`/api${apiPath}`, { ...init, headers: { 'content-type': 'application/json', 'x-demo-user': demoUser, ...init?.headers } });
    let body: T & { error?: string };
    try { const text = await response.text(); body = (text ? JSON.parse(text) : {}) as T & { error?: string }; }
    catch { body = {} as T & { error?: string }; }
    if (!response.ok) {
      if (response.status === 401 && !standalone && apiPath !== '/auth/login') { setAuthRequired(true); setMe(null); }
      throw Object.assign(new Error(body.error ?? `Error ${response.status}`), { status: response.status });
    }
    return body;
  }, [demoUser]);

  const loadMe = useCallback(async () => {
    try { const who = await api<Me>('/me'); setMe(who); setAuthRequired(false); setLoadError(''); }
    catch (cause) { if ((cause as ApiError).status !== 401 || standalone) setLoadError('Se ha perdido la conexión con el servidor. Reintentando automáticamente…'); }
  }, [api]);
  const reloadSessions = useCallback(async () => {
    try { const listing = await api<{ sessions: SessionSummary[] }>('/sessions'); setSessions(listing.sessions); setLoadError(''); }
    catch (cause) { if ((cause as ApiError).status !== 401) setLoadError('Se ha perdido la conexión con el servidor. Reintentando automáticamente…'); }
  }, [api]);

  useEffect(() => { setSessions(null); setMe(null); void loadMe(); }, [loadMe]);
  useEffect(() => {
    if (!me) return;
    void reloadSessions();
    // El listado se refresca con menos frecuencia dentro del detalle (allí llega en directo).
    const every = route.name === 'session' ? 15000 : 5000;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void reloadSessions(); }, every);
    return () => window.clearInterval(timer);
  }, [me?.identity.id, me?.identity.role, reloadSessions, route.name]);
  useEffect(() => {
    if (!me) return;
    void api<{ scenarios: ScenarioSummary[] }>('/scenarios').then(result => setScenarios(result.scenarios)).catch(() => setScenarios(current => current ?? []));
  }, [api, me?.identity.id]);
  // Sin servidor, se reintenta /me cada pocos segundos.
  useEffect(() => { if (me || authRequired) return; const timer = window.setInterval(() => void loadMe(), 4000); return () => window.clearInterval(timer); }, [me, authRequired, loadMe]);

  const loadScenario = useCallback((id: string) => {
    const cached = loading.current.get(id);
    if (cached) return cached;
    const request = api<{ scenario: Scenario }>(`/scenarios/${encodeURIComponent(id)}`).then(result => { setScenarioDetails(current => ({ ...current, [id]: result.scenario })); return result.scenario; }).catch(() => { loading.current.delete(id); return null; });
    loading.current.set(id, request);
    return request;
  }, [api]);
  useEffect(() => { loading.current.clear(); setScenarioDetails({}); }, [api]);

  const updateSession = useCallback((id: string, patch: Partial<SessionSummary>) => setSessions(current => current?.map(item => item.id === id ? { ...item, ...patch } : item) ?? current), []);
  const dropSessions = useCallback((ids: string[]) => setSessions(current => current?.filter(item => !ids.includes(item.id)) ?? current), []);

  // Cambio de ruta: foco en el título de la página y scroll arriba (no en la primera carga).
  const first = useRef(true);
  useEffect(() => {
    setDrawer(false);
    if (first.current) { first.current = false; return; }
    window.scrollTo({ top: 0 });
    const timer = window.setTimeout(() => document.querySelector<HTMLElement>('[data-page-title]')?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(timer);
  }, [path]);
  useEffect(() => { if (route.name !== 'session') document.title = `${pageTitle(route)} · ${brand.product} · ${brand.shortName}`; }, [route]);

  const value = useMemo<AppContextValue | null>(() => me ? {
    api, identity: me.identity, isInstructor: me.identity.role === 'instructor', demo: me.demo, standalone,
    timersOn: me.flags?.phase_timers !== false, realtime: me.flags?.realtime_websocket === true, canAssignInstructor: me.permissions?.assignInstructor === true,
    sessions, reloadSessions, updateSession, dropSessions, scenarios, scenarioDetails, loadScenario
  } : null, [api, me, sessions, reloadSessions, updateSession, dropSessions, scenarios, scenarioDetails, loadScenario]);

  if (authRequired) return <Login api={api} onDone={() => { setAuthRequired(false); void loadMe(); }}/>;
  if (!value) return <div className="auth-screen"><div className="auth-card" aria-busy="true"><img src={brand.logoOnDark} alt={brand.organization}/><Sk w={120} h={10}/><Sk w="80%" h={34} className="sk-gap"/><Sk w="100%" h={12} className="sk-gap"/><Sk w="70%" h={12}/><p className="sr-only" role="status">Comprobando tu acceso…</p>{loadError && <p className="error" role="alert">{loadError}</p>}</div></div>;

  const instructor = value.isInstructor;
  // Modo IA en vivo (demo): solo docentes y con la bandera ai_live_demo. El reproductor va a pantalla completa, fuera del marco.
  aiLiveFlag.enabled = instructor && me?.flags?.ai_live_demo === true;
  if (route.name === 'ai-live' && aiLiveFlag.enabled) return <AppProvider value={value}><React.Suspense fallback={<div className="ai-live"><div className="ai-bg"/></div>}><AiLivePage key={route.id} runId={route.id}/></React.Suspense></AppProvider>;
  const openCount = (sessions ?? []).filter(item => item.status !== 'complete').length;
  const section = route.name === 'session' || route.name === 'new-session' ? 'sessions' : route.name === 'scenario' || route.name === 'knowledge' ? 'scenarios' : route.name;
  const nav = instructor
    ? [{ key: 'home', to: '/', label: 'Inicio', icon: 'home' }, { key: 'sessions', to: '/sesiones', label: 'Sesiones', icon: 'sessions', badge: openCount }, { key: 'analytics', to: '/analitica', label: 'Analítica', icon: 'chart' }, { key: 'scenarios', to: '/escenarios', label: 'Escenarios', icon: 'scenarios' }, { key: 'people', to: '/participantes', label: 'Participantes y accesos', icon: 'people' }]
    : [{ key: 'home', to: '/', label: 'Mis sesiones', icon: 'home' }];
  const isActive = (key: string) => key === section || (!instructor && key === 'home' && section === 'sessions');

  const sidebar = <>
    <div className="brand"><img src={brand.logoOnDark} alt={brand.organization} height="32"/><small>{brand.product}</small></div>
    <nav className="nav" aria-label="Principal"><ul>{nav.map(item => <li key={item.key}><Link to={item.to} className="nav-link" aria-current={isActive(item.key) ? 'page' : undefined}><Icon name={item.icon}/><span>{item.label}</span>{!!item.badge && <span className="nav-badge" aria-label={`${item.badge} abiertas`}>{item.badge}</span>}</Link></li>)}</ul></nav>
    {instructor && <Link to="/sesiones/nueva" className="nav-cta"><Icon name="plus" size={16}/>Nueva sesión</Link>}
    <div className="nav-spacer"/>
    {value.demo && <div className="role-switch"><span className="eyebrow">{standalone ? 'Demo · ver como' : 'Entorno local · ver como'}</span><div className="switch-row" role="group" aria-label="Ver la consola como"><button aria-pressed={demoUser === 'instructor'} className={demoUser === 'instructor' ? 'selected' : ''} onClick={() => { setDemoUser('instructor'); navigate('/'); }}>Docente</button><button aria-pressed={demoUser === 'participant'} className={demoUser === 'participant' ? 'selected' : ''} onClick={() => { setDemoUser('participant'); navigate('/'); }}>Participante</button></div>{standalone && <small className="env-note">Demo en el navegador: los datos se guardan solo en este equipo.</small>}</div>}
    <div className="user-block"><span className="avatar" aria-hidden="true">{value.identity.name.trim().split(/\s+/).map(part => part[0]).slice(0, 2).join('').toUpperCase()}</span><div className="user-text"><strong>{value.identity.name}</strong><small>{value.identity.email || roleLabel(value.identity.role)}</small><small>{roleLabel(value.identity.role)}</small></div>
      {!value.demo && <button className="icon-button" aria-label="Cerrar sesión" title="Cerrar sesión" onClick={async () => { await api('/auth/logout', { method: 'POST', body: '{}' }).catch(() => undefined); setMe(null); setAuthRequired(true); navigate('/'); }}><Icon name="logout"/></button>}</div>
  </>;

  return <AppProvider value={value}>
    <a className="skip-link" href="#contenido">Saltar al contenido</a>
    <div className="shell">
      <header className="mobile-bar"><button className="icon-button" aria-label="Abrir menú" aria-expanded={drawer} aria-controls="menu-principal" onClick={() => setDrawer(true)}><Icon name="menu"/></button><img src={brand.logoOnDark} alt={brand.organization} height="26"/>{instructor ? <Link to="/sesiones/nueva" className="icon-button" aria-label="Nueva sesión"><Icon name="plus"/></Link> : <span className="mobile-bar-spacer"/>}</header>
      {drawer && <div className="drawer-backdrop" onClick={() => setDrawer(false)} aria-hidden="true"/>}
      <aside id="menu-principal" className={`shell-nav ${drawer ? 'open' : ''}`} aria-label="Menú">
        {drawer && <button className="icon-button drawer-close" aria-label="Cerrar menú" onClick={() => setDrawer(false)}><Icon name="close"/></button>}
        {sidebar}
      </aside>
      <main className="shell-main" id="contenido" tabIndex={-1}>
        {loadError && <div className="error" role="alert"><span>{loadError}</span><button className="text-button" onClick={() => void reloadSessions()}>Reintentar</button></div>}
        <Page route={route} instructor={instructor}/>
      </main>
    </div>
  </AppProvider>;
}

function pageTitle(route: Route): string {
  return ({ home: 'Inicio', sessions: 'Sesiones', 'new-session': 'Nueva sesión', session: 'Sesión', scenarios: 'Escenarios', scenario: 'Escenario', people: 'Participantes y accesos', analytics: 'Analítica', knowledge: 'Modo IA en vivo', 'ai-live': 'VictorIA en vivo', 'not-found': 'Página no encontrada' } as Record<Route['name'], string>)[route.name];
}

function Page({ route, instructor }: { route: Route; instructor: boolean }) {
  if (route.name === 'home') return <HomePage/>;
  if (route.name === 'session') return <SessionPage key={route.id} id={route.id}/>;
  if (instructor) {
    if (route.name === 'sessions') return <SessionsPage/>;
    if (route.name === 'new-session') return <NewSessionPage/>;
    if (route.name === 'scenarios') return <ScenariosPage/>;
    if (route.name === 'scenario') return <ScenarioPage key={route.id} id={route.id}/>;
    if (route.name === 'people') return <PeoplePage/>;
    if (route.name === 'analytics') return <AnalyticsPage/>;
    if (route.name === 'knowledge' && aiLiveFlag.enabled) return <KnowledgePage/>;
  } else if (route.name === 'sessions') return <HomePage/>;
  return <div className="page"><PageHeader title="Página no encontrada" description={instructor || route.name === 'not-found' ? 'La dirección no existe o ha cambiado.' : 'Esta sección está reservada al equipo docente.'}/>
    <div className="card"><div className="empty-block"><span className="empty-icon"><Icon name="home" size={22}/></span><h3>Vuelve al inicio para seguir</h3><div className="empty-actions"><button className="btn btn-primary" onClick={() => navigate('/')}>Ir a Inicio</button>{instructor && <button className="btn" onClick={() => navigate('/sesiones')}>Ver sesiones</button>}</div></div></div></div>;
}

function Login({ api, onDone }: { api: AppContextValue['api']; onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, code }) });
      const next = new URLSearchParams(window.location.search).get('next');
      if (next?.startsWith('/simulador/') && !next.startsWith('//')) { window.location.assign(next); return; }
      setCode(''); onDone();
    } catch (cause) {
      const status = (cause as ApiError).status;
      setError(status === 429 ? 'Demasiados intentos. Espera unos minutos y vuelve a probar.' : status === 401 || status === 400 ? 'El correo o el código no son correctos. Revisa los datos o pide un código nuevo a tu docente.' : errorText(cause));
    } finally { setBusy(false); }
  }
  return <div className="auth-screen"><div className="auth-card enter"><img src={brand.logoOnDark} alt={brand.organization}/><span className="eyebrow">{brand.product}</span><h1>Accede con tu código</h1><p>Introduce tu correo institucional y el código personal de seis cifras que te ha dado tu docente.</p><form onSubmit={submit}><label>Correo electrónico<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required/></label><label>Código de acceso<input type="text" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="one-time-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} required aria-describedby="code-hint"/></label>{error && <p className="error" role="alert">{error}</p>}<button className="primary" disabled={busy || code.length !== 6}>{busy ? 'Comprobando…' : 'Entrar'}</button></form><small id="code-hint">El código es personal e intransferible. Si lo has perdido, pide uno nuevo a tu docente.</small></div></div>;
}

/** Rutas públicas (/unirse, /jugar) antes del acceso de la consola: el invitado entra solo con código y alias. */
function Root() {
  const { path } = useLocation();
  const open = parsePublicRoute(path);
  if (open?.name === 'join') return <JoinPage pin={open.pin}/>;
  if (open?.name === 'play') return <PlayPage key={open.id} sessionId={open.id}/>;
  return <App/>;
}

createRoot(document.getElementById('root')!).render(<React.StrictMode><ToastProvider><DialogProvider><Root/></DialogProvider></ToastProvider></React.StrictMode>);
