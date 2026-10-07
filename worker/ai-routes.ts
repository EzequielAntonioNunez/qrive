import type { Context, Hono } from 'hono';
import { AiServiceError } from './ai-common';
import { answer, createRun, deleteRun, getRun, nextStep, parseAnswerRequest, parseRunRequest, type LiveContext } from './ai-live';
import type { AuthContext, Identity } from './auth';
import { flags } from './flags';
import {
  addDocument, collectionFor, createCollection, deleteCollection, deleteDocument, listCollections, listDocuments, parseCollectionName, parseUpload
} from './knowledge';

/**
 * Rutas del «Modo IA en vivo (demo)». Detrás del flag ai_live_demo (404 si está desactivado) y solo para instructores
 * (403; los invitados ya quedan fuera por la lista cerrada de guests.ts). Todo filtrado por la organización: un
 * recurso de otra organización es un 404. Las peticiones que cambian estado pasan por la comprobación CSRF del
 * middleware de /api/* (JSON del mismo origen). Ni los logs ni la auditoría llevan texto de documentos ni frases.
 */
export interface AiRouteDeps {
  readJson(c: Context<AuthContext>, optional?: boolean): Promise<unknown>;
  audit(env: AuthContext['Bindings'], identity: Identity, sessionId: string | null, action: string, detail: Record<string, unknown>): Promise<void>;
}

const PREFIXES = ['/api/knowledge', '/api/ai-runs'];

export function registerAiLiveRoutes(app: Hono<AuthContext>, deps: AiRouteDeps): void {
  for (const prefix of PREFIXES) {
    app.use(`${prefix}/*`, gate);
    app.use(prefix, gate);
  }

  const live = (c: Context<AuthContext>): LiveContext => {
    const identity = c.get('identity');
    let waitUntil: LiveContext['waitUntil'] = null;
    try { const ctx = c.executionCtx; waitUntil = promise => ctx.waitUntil(promise); } catch { waitUntil = null; }
    return { env: c.env, tenantId: identity.tenantId, userId: identity.id, requestId: c.get('requestId'), waitUntil };
  };
  /** Límite de generación por instructor (AI_LIMITER, 20/min): subidas, partidas, situaciones y respuestas. */
  const limited = async (c: Context<AuthContext>): Promise<Response | null> => {
    if (!c.env.AI_LIMITER) return null;
    const { success } = await c.env.AI_LIMITER.limit({ key: c.get('identity').id });
    return success ? null : c.json({ error: 'Demasiadas peticiones de IA. Espera unos segundos.', code: 'RATE_LIMITED' }, 429);
  };

  app.get('/api/knowledge/collections', async c => c.json({ collections: await listCollections(c.env, c.get('identity').tenantId) }));
  app.post('/api/knowledge/collections', async c => {
    const identity = c.get('identity');
    const body = await deps.readJson(c) as { name?: unknown } | null;
    const collection = await createCollection(c.env, identity.tenantId, identity.id, parseCollectionName(body?.name));
    await deps.audit(c.env, identity, null, 'knowledge_collection_created', { collectionId: collection.id });
    return c.json({ collection }, 201);
  });
  app.delete('/api/knowledge/collections/:id', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await collectionFor(c.env, identity.tenantId, id)) return c.json({ error: 'Colección no encontrada.' }, 404);
    await deleteCollection(c.env, identity.tenantId, id);
    await deps.audit(c.env, identity, null, 'knowledge_collection_deleted', { collectionId: id });
    return c.json({ deleted: true });
  });
  app.get('/api/knowledge/collections/:id/documents', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await collectionFor(c.env, identity.tenantId, id)) return c.json({ error: 'Colección no encontrada.' }, 404);
    return c.json({ documents: await listDocuments(c.env, identity.tenantId, id) });
  });
  app.post('/api/knowledge/collections/:id/documents', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await collectionFor(c.env, identity.tenantId, id)) return c.json({ error: 'Colección no encontrada.' }, 404);
    const input = parseUpload(await deps.readJson(c));
    const gateResponse = await limited(c);
    if (gateResponse) return gateResponse;
    const document = await addDocument(c.env, identity.tenantId, id, input, c.get('requestId'));
    await deps.audit(c.env, identity, null, 'knowledge_document_uploaded', { collectionId: id, documentId: document.id, mime: document.mime, bytes: document.bytes, status: document.status });
    // Un documento que no se ha podido leer queda en la lista con su motivo; la respuesta lo indica con 422.
    if (document.status === 'error') return c.json({ error: document.error, code: 'DOCUMENT_UNREADABLE', document }, 422);
    return c.json({ document }, 201);
  });
  app.delete('/api/knowledge/documents/:id', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    const collectionId = await deleteDocument(c.env, identity.tenantId, id);
    if (!collectionId) return c.json({ error: 'Documento no encontrado.' }, 404);
    await deps.audit(c.env, identity, null, 'knowledge_document_deleted', { collectionId, documentId: id });
    return c.json({ deleted: true });
  });

  app.post('/api/ai-runs', async c => {
    const identity = c.get('identity');
    const request = parseRunRequest(await deps.readJson(c));
    const gateResponse = await limited(c);
    if (gateResponse) return gateResponse;
    const run = await createRun(live(c), request);
    // El tema es texto libre: solo se registra si había uno.
    await deps.audit(c.env, identity, null, 'ai_run_created', { runId: run.id, collectionId: run.collectionId, situations: run.situationsTotal, focused: run.focus !== null });
    return c.json({ run }, 201);
  });
  app.get('/api/ai-runs/:id', async c => c.json(await getRun(live(c), c.req.param('id'))));
  app.delete('/api/ai-runs/:id', async c => {
    const identity = c.get('identity');
    const id = c.req.param('id');
    if (!await deleteRun(live(c), id)) return c.json({ error: 'Partida no encontrada.' }, 404);
    await deps.audit(c.env, identity, null, 'ai_run_deleted', { runId: id });
    return c.json({ deleted: true });
  });
  app.post('/api/ai-runs/:id/next', async c => {
    await deps.readJson(c, true);
    const gateResponse = await limited(c);
    if (gateResponse) return gateResponse;
    return c.json(await nextStep(live(c), c.req.param('id')));
  });
  app.post('/api/ai-runs/:id/answer', async c => {
    const request = parseAnswerRequest(await deps.readJson(c));
    const gateResponse = await limited(c);
    if (gateResponse) return gateResponse;
    return c.json(await answer(live(c), c.req.param('id'), request));
  });
}

async function gate(c: Context<AuthContext>, next: () => Promise<void>): Promise<Response | void> {
  if (!flags(c.env).ai_live_demo) return c.json({ error: 'Ruta no encontrada.' }, 404);
  if (c.get('identity')?.role !== 'instructor') return c.json({ error: 'El modo IA en vivo está reservado al instructor.' }, 403);
  c.header('cache-control', 'private, no-store');
  await next();
}

/** Respuesta JSON de un AiServiceError (lo usa app.onError). */
export function aiErrorResponse(c: Context<AuthContext>, error: AiServiceError): Response {
  return c.json({ error: error.message, code: error.code }, error.status);
}
