import type { Env } from './types';

/**
 * Simulador WebGL (Unity) servido en /simulador/. Los ficheros de hasta 25 MiB van en los static assets
 * (web/public/simulador/); los que superan ese límite los sube `pnpm unity:webgl` al bucket R2 bajo `simulador/`.
 * Cloudflare Access protege todo el dominio antes de llegar aquí.
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

/** Los ficheros de Build/ llevan hash en el nombre (nameFilesAsHashes): se pueden cachear sin caducidad. */
export function simulatorCacheControl(key: string): string {
  return key.startsWith(`${SIMULATOR_PREFIX}Build/`) ? 'private, max-age=31536000, immutable' : 'private, no-cache';
}

// Con not_found_handling = single-page-application, un fichero que no está en los assets devuelve la consola
// (index.html, 200). Si se pedía otra cosa que HTML, es que el fichero no existe en los assets.
function isSpaFallback(response: Response, key: string): boolean {
  return !key.endsWith('.html') && (response.headers.get('content-type') ?? '').startsWith('text/html');
}

export async function serveSimulator(request: Request, env: Pick<Env, 'FILES' | 'ASSETS'>): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === '/simulador') return Response.redirect(`${url.origin}/simulador/${url.search}`, 308);
  const key = simulatorKey(url.pathname);
  if (!key) return new Response('No encontrado.', { status: 404 });

  if (env.ASSETS) {
    const asset = await env.ASSETS.fetch(request);
    if (asset.status === 304 || (asset.ok && !isSpaFallback(asset, key))) return asset;
    if (asset.status >= 300 && asset.status < 400) return asset;
  }

  const object = await env.FILES.get(key);
  if (!object) return new Response('No encontrado.', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const headers = new Headers();
  headers.set('content-type', simulatorContentType(key));
  headers.set('cache-control', simulatorCacheControl(key));
  headers.set('etag', object.httpEtag);
  headers.set('x-content-type-options', 'nosniff');
  if (request.method === 'HEAD') return new Response(null, { headers });
  return new Response(object.body, { headers });
}
