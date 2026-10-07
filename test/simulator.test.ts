import { describe, expect, it } from 'vitest';
import { guestSimulatorGate, serveSimulator, simulatorCacheControl, simulatorContentType, simulatorKey } from '../worker/simulator';

const consoleHtml = () => new Response('<!doctype html><div id="root"></div>', { headers: { 'content-type': 'text/html' } });

// ASSETS con la misma regla que el despliegue: lo que no existe devuelve la consola (SPA).
function fakeEnv(assets: Record<string, string>, objects: Record<string, string>) {
  const reads: string[] = [];
  return {
    reads,
    env: {
      ASSETS: { fetch: async (request: Request) => {
        const path = new URL(request.url).pathname;
        const body = assets[path];
        return body === undefined ? consoleHtml() : new Response(body, { headers: { 'content-type': path.endsWith('/') ? 'text/html' : 'application/javascript' } });
      } },
      FILES: { get: async (key: string) => {
        reads.push(key);
        const body = objects[key];
        return body === undefined ? null : { body: new Response(body).body, httpEtag: '"etag"' };
      } }
    } as never
  };
}

describe('simulador WebGL', () => {
  it('maps URLs to R2 keys and rejects path traversal', () => {
    expect(simulatorKey('/simulador/')).toBe('simulador/index.html');
    expect(simulatorKey('/simulador/Build/abc.wasm.unityweb')).toBe('simulador/Build/abc.wasm.unityweb');
    expect(simulatorKey('/simulador/Build/../../secret')).toBeNull();
    expect(simulatorKey('/simulador/Build/%2e%2e/x')).toBeNull();
    expect(simulatorKey('/api/me')).toBeNull();
  });

  it('uses the right content types for Unity files', () => {
    expect(simulatorContentType('simulador/Build/a.wasm')).toBe('application/wasm');
    expect(simulatorContentType('simulador/Build/a.data.unityweb')).toBe('application/octet-stream');
    expect(simulatorContentType('simulador/Build/a.loader.js')).toContain('application/javascript');
  });

  it('serves static assets first and does not touch R2', async () => {
    const { env, reads } = fakeEnv({ '/simulador/Build/a.loader.js': 'loader' }, {});
    const response = await serveSimulator(new Request('https://axyro.test/simulador/Build/a.loader.js'), env);
    expect(await response.text()).toBe('loader');
    expect(reads).toEqual([]);
  });

  it('falls back to R2 when the asset is missing (SPA fallback) with cache and content type', async () => {
    const { env, reads } = fakeEnv({}, { 'simulador/Build/a.data.unityweb': 'datos' });
    const response = await serveSimulator(new Request('https://axyro.test/simulador/Build/a.data.unityweb'), env);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('datos');
    expect(response.headers.get('content-type')).toBe('application/octet-stream');
    expect(response.headers.get('cache-control')).toContain('immutable');
    expect(response.headers.get('content-encoding')).toBeNull();
    expect(reads).toEqual(['simulador/Build/a.data.unityweb']);
  });

  it('returns 404 when the file is in neither place and redirects /simulador keeping the session', async () => {
    const { env } = fakeEnv({}, {});
    expect((await serveSimulator(new Request('https://axyro.test/simulador/Build/x.wasm'), env)).status).toBe(404);
    const redirect = await serveSimulator(new Request('https://axyro.test/simulador?sesion=abc'), env);
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe('https://axyro.test/simulador/?sesion=abc');
  });
});

describe('simulador WebGL: caché y progreso', () => {
  it('los ficheros con hash de Build/ se cachean un año; index.html y voice.js se revalidan', async () => {
    const { env } = fakeEnv({ '/simulador/Build/a.loader.js': 'loader', '/simulador/': '<!doctype html>', '/simulador/voice.js': 'voz' }, {});
    const build = await serveSimulator(new Request('https://axyro.test/simulador/Build/a.loader.js'), env);
    expect(build.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    const page = await serveSimulator(new Request('https://axyro.test/simulador/?sesion=abc'), env);
    expect(page.headers.get('cache-control')).toBe('no-cache');
    const voice = await serveSimulator(new Request('https://axyro.test/simulador/voice.js'), env);
    expect(voice.headers.get('cache-control')).toBe('no-cache');
    expect(simulatorCacheControl('simulador/index.html')).toBe('no-cache');
  });

  it('el fichero de datos servido desde R2 lleva Content-Length (progreso real en MB) y caché inmutable', async () => {
    const env = {
      FILES: { get: async () => ({ body: new Response('0123456789').body, httpEtag: '"e"', size: 10 }) }
    } as never;
    const response = await serveSimulator(new Request('https://axyro.test/simulador/Build/f.data.unityweb'), env);
    expect(response.headers.get('content-length')).toBe('10');
    expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await response.text()).toBe('0123456789');
  });
});

describe('simulador WebGL: invitados', () => {
  const guest = { guest: { sessionId: 'sesion-a' } };
  it('un miembro o un fichero de Build/ no pasan por la puerta de invitados', () => {
    expect(guestSimulatorGate({}, new Request('https://axyro.test/simulador/?sesion=otra'))).toBeNull();
    expect(guestSimulatorGate(guest, new Request('https://axyro.test/simulador/Build/a.loader.js'))).toBeNull();
  });
  it('el invitado abre su sesión; sin sesión va a la suya; otra sesión muestra un aviso sin cargar Unity', async () => {
    expect(guestSimulatorGate(guest, new Request('https://axyro.test/simulador/?sesion=sesion-a'))).toBeNull();
    expect(guestSimulatorGate(guest, new Request('https://axyro.test/simulador/index.html?sesion=sesion-a'))).toBeNull();
    for (const url of ['https://axyro.test/simulador/', 'https://axyro.test/simulador']) {
      const redirect = guestSimulatorGate(guest, new Request(url))!;
      expect(redirect.status).toBe(302);
      expect(redirect.headers.get('location')).toBe('https://axyro.test/simulador/?sesion=sesion-a');
    }
    const other = guestSimulatorGate(guest, new Request('https://axyro.test/simulador/index.html?sesion=sesion-b'))!;
    expect(other.status).toBe(403);
    const html = await other.text();
    expect(html).toContain('Este enlace es de otra sesión');
    expect(html).toContain('/simulador/?sesion=sesion-a');
    expect(html).toContain('/jugar/sesion-a');
    expect(html).not.toContain('sesion-b');
    expect(html).not.toContain('createUnityInstance');
  });
});

describe('simulador WebGL: revalidación desde R2', () => {
  it('responde 304 sin cuerpo cuando la condición de R2 no se cumple (ETag igual)', async () => {
    let options: unknown;
    const env = { FILES: { get: async (_key: string, opts: unknown) => { options = opts; return { httpEtag: '"e"', size: 10 }; } } } as never;
    const response = await serveSimulator(new Request('https://axyro.test/simulador/Build/f.data.unityweb', { headers: { 'if-none-match': '"e"' } }), env);
    expect(response.status).toBe(304);
    expect(response.headers.get('etag')).toBe('"e"');
    expect((options as { onlyIf: Headers }).onlyIf.get('if-none-match')).toBe('"e"');
  });
});
