import type { Identity } from './auth';
import type { Env } from './types';

/**
 * Simulador WebGL (Unity) servido en /simulador/. Los ficheros de hasta 25 MiB van en los static assets
 * (web/public/simulador/); los que superan ese límite los sube `pnpm unity:webgl` al bucket R2 bajo `simulador/`.
 * Solo se sirve con identidad (miembro con código personal o invitado con PIN; ver app.ts y guestSimulatorGate).
 */
export const SIMULATOR_PREFIX = 'simulador/';

const contentTypes: Record<string, string> = {
  html: 'text/html; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  wasm: 'application/wasm',
  data: 'application/octet-stream',
  unityweb: 'application/octet-stream',
  br: 'application/octet-stream',
  gz: 'application/octet-stream',
  png: 'image/png',
  jpg: 'image/jpeg',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  txt: 'text/plain; charset=utf-8'
};

export function simulatorContentType(path: string): string {
  const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  return contentTypes[extension] ?? 'application/octet-stream';
}

/** Clave R2 para una ruta /simulador/...; null si la ruta no es válida. */
export function simulatorKey(pathname: string): string | null {
  if (!pathname.startsWith('/simulador/')) return null;
  let relative: string;
  try { relative = decodeURIComponent(pathname.slice('/simulador/'.length)); } catch { return null; }
  if (relative === '' || relative.endsWith('/')) relative += 'index.html';
  if (relative.split('/').some(part => part === '..' || part === '.' || part === '') || relative.includes('\\')) return null;
  return SIMULATOR_PREFIX + relative;
}

/**
 * Los ficheros de Build/ llevan hash en el nombre (nameFilesAsHashes): se cachean un año sin revalidar, así que la
 * segunda carga no descarga nada. Son el binario del simulador, sin datos de sesiones ni de personas.
 * index.html y voice.js cambian con cada build: el navegador los revalida siempre (no-cache).
 */
export function simulatorCacheControl(key: string): string {
  return key.startsWith(`${SIMULATOR_PREFIX}Build/`) ? 'public, max-age=31536000, immutable' : 'no-cache';
}

// Con not_found_handling = single-page-application, un fichero que no está en los assets devuelve la consola
// (index.html, 200). Si se pedía otra cosa que HTML, es que el fichero no existe en los assets.
function isSpaFallback(response: Response, key: string): boolean {
  return !key.endsWith('.html') && (response.headers.get('content-type') ?? '').startsWith('text/html');
}

/** Los static assets llevan por defecto «max-age=0, must-revalidate»: se sustituye por la política del simulador. */
function withCacheControl(response: Response, key: string): Response {
  const out = new Response(response.body, response);
  out.headers.set('cache-control', simulatorCacheControl(key));
  return out;
}

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`);

/** Página de aviso (sin Unity, para no descargar el simulador en balde) cuando un invitado abre otra sesión. */
function otherSessionPage(ownSessionId: string): Response {
  const own = encodeURIComponent(ownSessionId);
  const html = `<!DOCTYPE html>
<html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Simulador UFV</title><link rel="icon" href="/brand/ufv-logo-navy.svg">
<style>
html,body{margin:0;min-height:100%;background:#001A33;color:#fff;font-family:Arial,Helvetica,sans-serif}
main{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
section{max-width:480px;text-align:center;display:grid;gap:18px;justify-items:center}
img{height:48px;width:auto}
h1{font:400 26px/1.25 Rockwell,"Rockwell Nova","Roboto Slab",Georgia,serif;margin:0}
p{margin:0;color:#C9D6E6;line-height:1.55;font-size:15px}
.acciones{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
a{display:inline-flex;align-items:center;min-height:44px;padding:0 18px;border-radius:10px;font-weight:700;font-size:15px;text-decoration:none}
.principal{background:#649EFF;color:#001A33}.secundaria{border:1.5px solid #649EFF;color:#fff}
a:focus-visible{outline:2px solid #fff;outline-offset:2px}
</style></head>
<body><main><section role="alert">
<img src="/brand/ufv-logo-white.svg" alt="Universidad Francisco de Vitoria">
<h1>Este enlace es de otra sesión</h1>
<p>Tu acceso de invitado solo vale para la sesión a la que te uniste con el código del aula. Si quieres entrar en otra, únete con su código.</p>
<div class="acciones">
<a class="principal" href="/simulador/?sesion=${escapeHtml(own)}">Abrir mi sesión en 3D</a>
<a class="secundaria" href="/jugar/${escapeHtml(own)}">Volver a mi sesión</a>
<a class="secundaria" href="/unirse">Unirme con otro código</a>
</div>
</section></main></body></html>`;
  return new Response(html, { status: 403, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}

/**
 * Invitados en el simulador: solo su sesión. La página del simulador sin `?sesion=` lleva a la suya; con otra
 * sesión, un aviso claro en lugar de cargar Unity. La API sigue siendo la barrera real (guestAllowed).
 * Devuelve null si la petición puede seguir (miembros, ficheros de Build/, o el invitado en su propia sesión).
 */
export function guestSimulatorGate(identity: Pick<Identity, 'guest'>, request: Request): Response | null {
  const ownSessionId = identity.guest?.sessionId;
  if (!ownSessionId) return null;
  const url = new URL(request.url);
  const key = url.pathname === '/simulador' ? `${SIMULATOR_PREFIX}index.html` : simulatorKey(url.pathname);
  if (!key || !key.endsWith('.html')) return null;
  const requested = url.searchParams.get('sesion');
  if (!requested) return Response.redirect(`${url.origin}/simulador/?sesion=${encodeURIComponent(ownSessionId)}`, 302);
  return requested === ownSessionId ? null : otherSessionPage(ownSessionId);
}

export async function serveSimulator(request: Request, env: Pick<Env, 'FILES' | 'ASSETS'>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/simulador') return Response.redirect(`${url.origin}/simulador/${url.search}`, 308);
  const key = simulatorKey(url.pathname);
  if (!key) return new Response('No encontrado.', { status: 404 });

  if (env.ASSETS) {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 304 || (asset.ok && !isSpaFallback(asset, key))) return withCacheControl(asset, key);
    if (asset.status >= 300 && asset.status < 400) return asset;
  }

  // Petición condicional (revalidación de la caché del navegador o de Unity): 304 sin volver a enviar el fichero.
  const object = await env.FILES.get(key, { onlyIf: request.headers });
  if (object && !('body' in object)) {
    return new Response(null, { status: 304, headers: { etag: object.httpEtag, 'cache-control': simulatorCacheControl(key) } });
  }
  if (!object) return new Response('No encontrado.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const headers = new Headers();
  headers.set('content-type', simulatorContentType(key));
  headers.set('cache-control', simulatorCacheControl(key));
  headers.set('etag', object.httpEtag);
  // Con Content-Length el cargador de Unity calcula el progreso real (y la plantilla muestra los MB).
  if (typeof object.size === 'number') headers.set('content-length', String(object.size));
  headers.set('x-content-type-options', 'nosniff');
  if (request.method === 'HEAD') return new Response(null, { headers });
  return new Response(object.body, { headers });
}
