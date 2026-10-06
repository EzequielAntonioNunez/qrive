import { describe, expect, it } from 'vitest';
import { serveSimulator, simulatorContentType, simulatorKey } from '../worker/simulator';

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
