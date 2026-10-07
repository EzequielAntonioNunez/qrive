/**
 * Enrutado mínimo con la History API. El Worker (y Vite en desarrollo) sirven index.html para cualquier ruta que no
 * sea de la API, así que las URL son reales y se pueden recargar o compartir.
 *
 *   /                      Inicio
 *   /sesiones              Listado de sesiones
 *   /sesiones/nueva        Asistente de nueva sesión (?escenario=<id>)
 *   /sesiones/:id          Detalle (?vista=directo | participantes | informe)
 *   /escenarios[/:id]      Catálogo y detalle de escenarios
 *   /participantes         Participantes y accesos
 *   /analitica             Analítica agregada de la organización (?rango=&escenario=&simuladas=1)
 *   /escenarios/ia         Modo IA en vivo · demo: colecciones de conocimiento (?coleccion=<id>)
 *   /ia/:runId             Reproductor inmersivo del modo IA en vivo (pantalla completa)
 *   /escenarios/borrador/:runId  Revisión y publicación de un escenario generado a partir de una partida con IA
 *
 * Compatibilidad: /?sesion=<id>&vista=<v> (enlaces anteriores) se redirige a /sesiones/<id>?vista=<v>.
 */
import React, { useEffect, useSyncExternalStore } from 'react';

export type Route =
  | { name: 'home' }
  | { name: 'sessions' }
  | { name: 'new-session' }
  | { name: 'session'; id: string }
  | { name: 'scenarios' }
  | { name: 'scenario'; id: string }
  | { name: 'people' }
  | { name: 'analytics' }
  | { name: 'knowledge' }
  | { name: 'ai-live'; id: string }
  | { name: 'scenario-draft'; runId: string }
  | { name: 'not-found' };

const listeners = new Set<() => void>();
function emit() { for (const listener of listeners) listener(); }
function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => { listeners.delete(listener); window.removeEventListener('popstate', listener); };
}
const snapshot = () => `${window.location.pathname}${window.location.search}`;

export function navigate(to: string, options: { replace?: boolean } = {}) {
  if (to === snapshot()) return;
  if (options.replace) window.history.replaceState(null, '', to); else window.history.pushState(null, '', to);
  emit();
}

/** Cambia solo parámetros de la consulta de la ruta actual (null los elimina). */
export function setQuery(values: Record<string, string | null>, options: { replace?: boolean } = {}) {
  const params = new URLSearchParams(window.location.search);
  for (const [key, value] of Object.entries(values)) { if (value == null) params.delete(key); else params.set(key, value); }
  const query = params.toString();
  navigate(`${window.location.pathname}${query ? `?${query}` : ''}`, options);
}

export function parseRoute(pathname: string): Route {
  const path = pathname.replace(/\/+$/, '') || '/';
  if (path === '/' || path === '/index.html') return { name: 'home' };
  if (path === '/sesiones') return { name: 'sessions' };
  if (path === '/sesiones/nueva') return { name: 'new-session' };
  if (path === '/escenarios') return { name: 'scenarios' };
  if (path === '/participantes') return { name: 'people' };
  if (path === '/analitica') return { name: 'analytics' };
  if (path === '/escenarios/ia') return { name: 'knowledge' };
  const draft = path.match(/^\/escenarios\/borrador\/([\w-]{1,80})$/);
  if (draft) return { name: 'scenario-draft', runId: draft[1] };
  const aiRun = path.match(/^\/ia\/([\w-]{1,80})$/);
  if (aiRun) return { name: 'ai-live', id: aiRun[1] };
  const session = path.match(/^\/sesiones\/([\w-]{1,80})$/);
  if (session) return { name: 'session', id: session[1] };
  const scenario = path.match(/^\/escenarios\/([^/]{1,120})$/);
  if (scenario) return { name: 'scenario', id: decodeURIComponent(scenario[1]) };
  return { name: 'not-found' };
}

/** Ruta y consulta actuales; se vuelve a pintar con cada navegación. */
export function useLocation(): { route: Route; path: string; query: URLSearchParams } {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const url = new URL(current, window.location.origin);
  return { route: parseRoute(url.pathname), path: url.pathname, query: url.searchParams };
}

/** Redirige los enlaces antiguos de la consola (/?sesion=…&vista=…) a la ruta nueva. */
export function useLegacyRedirect() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const id = params.get('sesion');
    if ((window.location.pathname === '/' || window.location.pathname === '/index.html') && id && /^[\w-]{1,80}$/.test(id)) {
      const vista = params.get('vista');
      navigate(`/sesiones/${id}${vista ? `?vista=${encodeURIComponent(vista)}` : ''}`, { replace: true });
    }
  }, []);
}

/** Enlace interno: navega sin recargar, pero respeta Ctrl/Cmd+clic y el botón central (nueva pestaña). */
export function Link({ to, children, onClick, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }) {
  return <a href={to} {...rest} onClick={event => {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || rest.target) return;
    event.preventDefault();
    navigate(to);
  }}>{children}</a>;
}
