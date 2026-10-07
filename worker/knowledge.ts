import { AiServiceError, runAi } from './ai-common';
import type { Env } from './types';

/**
 * Colecciones de conocimiento del modo IA en vivo (flag ai_live_demo): extracción, fragmentación, embeddings y
 * recuperación por similitud coseno en el propio Worker (colecciones pequeñas, sin Vectorize).
 *
 * - Originales en R2: knowledge/<tenant>/<colección>/<documento>. Vectores: el mismo prefijo + «.vec» (Float32
 *   normalizados, uno por fragmento en orden `ord`). Leer un binario por documento cuesta muy poca CPU; D1
 *   devolvería cada BLOB como un array de números.
 * - PDF y DOCX se convierten con Workers AI `toMarkdown` (fuera de la CPU del Worker); TXT y MD se leen tal cual.
 * - El texto de los documentos nunca se escribe en logs.
 */
export const EMBEDDING_MODEL = '@cf/baai/bge-m3';
export const KNOWLEDGE_LIMITS = {
  maxFileBytes: 20 * 1024 * 1024,
  maxDocumentsPerCollection: 10,
  maxChunksPerCollection: 1500,
  maxCharsPerDocument: 300_000,
  minCharsPerDocument: 40,
  maxCollectionsPerTenant: 50,
  chunkChars: 900,
  overlapChars: 150,
  embedBatch: 50
} as const;

export const MIME = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown'
} as const;

export type KnowledgeMime = typeof MIME[keyof typeof MIME];

export interface CollectionRow { id: string; name: string; documentCount: number; chunkCount: number; createdAt: string }
export interface DocumentRow { id: string; name: string; mime: string; bytes: number; chars: number; status: 'processing' | 'ready' | 'error'; error: string | null; createdAt: string }
export interface Chunk { ord: number; hint: string | null; text: string }
export interface RetrievedChunk { documentId: string; documentName: string; ord: number; hint: string | null; text: string; score: number }

const ID = /^[\w-]{8,80}$/;
export const validId = (value: unknown): value is string => typeof value === 'string' && ID.test(value);

export const objectKey = (tenantId: string, collectionId: string, documentId: string) => `knowledge/${tenantId}/${collectionId}/${documentId}`;
const vectorKey = (tenantId: string, collectionId: string, documentId: string) => `${objectKey(tenantId, collectionId, documentId)}.vec`;

// ---------------------------------------------------------------------------------------------
// Colecciones y documentos (D1, siempre filtrado por tenant_id)
// ---------------------------------------------------------------------------------------------
export function parseCollectionName(value: unknown): string {
  const name = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  if (!name || name.length > 80) throw new AiServiceError(400, 'INVALID_NAME', 'El nombre de la colección debe tener entre 1 y 80 caracteres.');
  return name;
}

export async function listCollections(env: Env, tenantId: string): Promise<CollectionRow[]> {
  const rows = await env.DB.prepare(`SELECT c.id, c.name, c.created_at AS createdAt,
      (SELECT COUNT(*) FROM knowledge_documents d WHERE d.tenant_id = c.tenant_id AND d.collection_id = c.id) AS documentCount,
      (SELECT COALESCE(SUM(d.chunk_count), 0) FROM knowledge_documents d WHERE d.tenant_id = c.tenant_id AND d.collection_id = c.id AND d.status = 'ready') AS chunkCount
    FROM knowledge_collections c WHERE c.tenant_id = ? ORDER BY c.created_at DESC`).bind(tenantId).all<CollectionRow>();
  return rows.results.map(row => ({ ...row, documentCount: Number(row.documentCount), chunkCount: Number(row.chunkCount) }));
}

export async function collectionFor(env: Env, tenantId: string, id: string): Promise<CollectionRow | null> {
  if (!validId(id)) return null;
  return (await listCollections(env, tenantId)).find(row => row.id === id) ?? null;
}

export async function createCollection(env: Env, tenantId: string, userId: string, name: string): Promise<CollectionRow> {
  const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM knowledge_collections WHERE tenant_id = ?').bind(tenantId).first<{ n: number }>();
  if (Number(count?.n ?? 0) >= KNOWLEDGE_LIMITS.maxCollectionsPerTenant)
    throw new AiServiceError(409, 'LIMIT_COLLECTIONS', `Se ha alcanzado el máximo de ${KNOWLEDGE_LIMITS.maxCollectionsPerTenant} colecciones. Borra alguna antes de crear otra.`);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO knowledge_collections (id,tenant_id,name,created_by,created_at) VALUES (?,?,?,?,?)').bind(id, tenantId, name, userId, createdAt).run();
  return { id, name, documentCount: 0, chunkCount: 0, createdAt };
}

const DOCUMENT_COLUMNS = 'id, name, mime, bytes, chars, status, error, created_at AS createdAt';

export async function listDocuments(env: Env, tenantId: string, collectionId: string): Promise<DocumentRow[]> {
  const rows = await env.DB.prepare(`SELECT ${DOCUMENT_COLUMNS} FROM knowledge_documents WHERE tenant_id = ? AND collection_id = ? ORDER BY created_at, id`)
    .bind(tenantId, collectionId).all<DocumentRow>();
  return rows.results.map(row => ({ ...row, bytes: Number(row.bytes), chars: Number(row.chars), error: row.error ?? null }));
}

async function documentRow(env: Env, tenantId: string, id: string): Promise<DocumentRow | null> {
  const row = await env.DB.prepare(`SELECT ${DOCUMENT_COLUMNS} FROM knowledge_documents WHERE tenant_id = ? AND id = ?`).bind(tenantId, id).first<DocumentRow>();
  return row ? { ...row, bytes: Number(row.bytes), chars: Number(row.chars), error: row.error ?? null } : null;
}

/** Borra una colección: objetos de R2, fragmentos, documentos, partidas y la propia colección. */
export async function deleteCollection(env: Env, tenantId: string, collectionId: string): Promise<boolean> {
  const exists = await env.DB.prepare('SELECT 1 AS found FROM knowledge_collections WHERE tenant_id = ? AND id = ?').bind(tenantId, collectionId).first();
  if (!exists) return false;
  await deletePrefix(env, `knowledge/${tenantId}/${collectionId}/`);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_turns WHERE tenant_id = ? AND run_id IN (SELECT id FROM ai_runs WHERE tenant_id = ? AND collection_id = ?)').bind(tenantId, tenantId, collectionId),
    env.DB.prepare('DELETE FROM ai_runs WHERE tenant_id = ? AND collection_id = ?').bind(tenantId, collectionId),
    env.DB.prepare('DELETE FROM knowledge_chunks WHERE tenant_id = ? AND collection_id = ?').bind(tenantId, collectionId),
    env.DB.prepare('DELETE FROM knowledge_documents WHERE tenant_id = ? AND collection_id = ?').bind(tenantId, collectionId),
    env.DB.prepare('DELETE FROM knowledge_collections WHERE tenant_id = ? AND id = ?').bind(tenantId, collectionId)
  ]);
  forgetVectors(collectionId);
  return true;
}

/** Borra un documento (original, vectores y fragmentos). Devuelve la colección a la que pertenecía, o null. */
export async function deleteDocument(env: Env, tenantId: string, documentId: string): Promise<string | null> {
  if (!validId(documentId)) return null;
  const row = await env.DB.prepare('SELECT collection_id AS collectionId FROM knowledge_documents WHERE tenant_id = ? AND id = ?').bind(tenantId, documentId).first<{ collectionId: string }>();
  if (!row) return null;
  await env.FILES.delete([objectKey(tenantId, row.collectionId, documentId), vectorKey(tenantId, row.collectionId, documentId)]);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM knowledge_chunks WHERE tenant_id = ? AND document_id = ?').bind(tenantId, documentId),
    env.DB.prepare('DELETE FROM knowledge_documents WHERE tenant_id = ? AND id = ?').bind(tenantId, documentId)
  ]);
  forgetVectors(row.collectionId);
  return row.collectionId;
}

async function deletePrefix(env: Env, prefix: string): Promise<void> {
  let cursor: string | undefined;
  do {
    const listed = await env.FILES.list({ prefix, cursor });
    const keys = listed.objects.map(object => object.key);
    if (keys.length) await env.FILES.delete(keys);
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}

// ---------------------------------------------------------------------------------------------
// Subida: validación, extracción, fragmentación y embeddings
// ---------------------------------------------------------------------------------------------
export interface UploadInput { name: string; mime: KnowledgeMime; bytes: Uint8Array }

const MIME_BY_EXTENSION: Record<string, KnowledgeMime> = { pdf: MIME.pdf, docx: MIME.docx, txt: MIME.txt, md: MIME.md, markdown: MIME.md };

function decodeBase64(value: string): Uint8Array {
  const clean = value.replace(/^data:[^,]*,/, '').replace(/\s+/g, '');
  const native = (Uint8Array as unknown as { fromBase64?: (text: string) => Uint8Array }).fromBase64;
  if (native) return native(clean);
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Valida el cuerpo de la subida: `{ name, mime, dataBase64 }` (fichero) o `{ name, text }` (texto pegado). */
export function parseUpload(body: unknown): UploadInput {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const rawName = typeof data.name === 'string' ? data.name.replace(/[\u0000-\u001f]/g, '').trim() : '';
  if (!rawName || rawName.length > 120) throw new AiServiceError(400, 'INVALID_NAME', 'El nombre del documento debe tener entre 1 y 120 caracteres.');
  if (typeof data.text === 'string') {
    const text = data.text.trim();
    if (text.length < KNOWLEDGE_LIMITS.minCharsPerDocument) throw new AiServiceError(400, 'TEXT_TOO_SHORT', 'El texto pegado es demasiado corto.');
    if (text.length > KNOWLEDGE_LIMITS.maxCharsPerDocument) throw new AiServiceError(413, 'TEXT_TOO_LONG', `El texto supera el máximo de ${KNOWLEDGE_LIMITS.maxCharsPerDocument.toLocaleString('es-ES')} caracteres.`);
    return { name: rawName, mime: MIME.txt, bytes: new TextEncoder().encode(text) };
  }
  if (typeof data.dataBase64 !== 'string' || !data.dataBase64) throw new AiServiceError(400, 'INVALID_DOCUMENT', 'Envía el fichero en base64 (dataBase64) o el texto pegado (text).');
  // Tamaño aproximado antes de decodificar: no se decodifica nada que ya exceda el límite.
  if (data.dataBase64.length * 0.75 > KNOWLEDGE_LIMITS.maxFileBytes + 4)
    throw new AiServiceError(413, 'FILE_TOO_LARGE', 'El fichero supera el máximo de 20 MB.');
  const extension = rawName.toLowerCase().split('.').pop() ?? '';
  const declared = typeof data.mime === 'string' ? data.mime.split(';')[0].trim().toLowerCase() : '';
  const mime = (Object.values(MIME) as string[]).includes(declared) ? declared as KnowledgeMime
    : declared === 'text/x-markdown' ? MIME.md : MIME_BY_EXTENSION[extension];
  if (!mime) throw new AiServiceError(415, 'UNSUPPORTED_TYPE', 'Formato no admitido. Sube PDF, DOCX, TXT o MD.');
  let bytes: Uint8Array;
  try { bytes = decodeBase64(data.dataBase64); } catch { throw new AiServiceError(400, 'INVALID_BASE64', 'El fichero no está bien codificado en base64.'); }
  if (!bytes.length) throw new AiServiceError(400, 'EMPTY_FILE', 'El fichero está vacío.');
  if (bytes.length > KNOWLEDGE_LIMITS.maxFileBytes) throw new AiServiceError(413, 'FILE_TOO_LARGE', 'El fichero supera el máximo de 20 MB.');
  // Firma del contenido: un PDF empieza por «%PDF» y un DOCX es un ZIP («PK»).
  if (mime === MIME.pdf && !(bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46))
    throw new AiServiceError(400, 'INVALID_PDF', 'El fichero no es un PDF válido.');
  if (mime === MIME.docx && !(bytes[0] === 0x50 && bytes[1] === 0x4b))
    throw new AiServiceError(400, 'INVALID_DOCX', 'El fichero no es un DOCX válido.');
  return { name: rawName, mime, bytes };
}

/** Error de procesamiento que se guarda en el documento (status «error») y se muestra a la persona. */
class ExtractionError extends Error {}

/** Texto del documento. PDF y DOCX: Workers AI toMarkdown. Exportada para los tests. */
export async function extractText(env: Env, input: UploadInput): Promise<string> {
  let text: string;
  if (input.mime === MIME.txt || input.mime === MIME.md) {
    text = new TextDecoder('utf-8').decode(input.bytes).replace(/^﻿/, '');
  } else {
    if (!env.AI?.toMarkdown) throw new ExtractionError('La conversión de PDF y DOCX no está disponible en este entorno. Sube el texto en TXT o MD.');
    let results: Awaited<ReturnType<NonNullable<NonNullable<Env['AI']>['toMarkdown']>>>;
    try {
      results = await env.AI.toMarkdown([{ name: input.name, blob: new Blob([input.bytes as BlobPart], { type: input.mime }) }]);
    } catch (error) {
      console.warn(JSON.stringify({ code: 'KNOWLEDGE_TOMARKDOWN_FAILED', mime: input.mime, message: String(error).slice(0, 200) }));
      throw new ExtractionError('No se ha podido leer el documento. Comprueba que no esté protegido o dañado.');
    }
    const result = results?.[0];
    if (!result || result.format === 'error' || typeof result.data !== 'string')
      throw new ExtractionError('No se ha podido leer el documento. Comprueba que no esté protegido o dañado.');
    text = cleanMarkdown(result.data);
  }
  text = text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').replace(/\n{3,}/g, '\n\n').trim();
  const letters = (text.match(/\p{L}/gu) ?? []).length;
  if (letters < KNOWLEDGE_LIMITS.minCharsPerDocument) {
    throw new ExtractionError(input.mime === MIME.pdf
      ? 'El PDF no contiene texto seleccionable (parece escaneado). Sube una versión con texto o pega el contenido.'
      : 'El documento no contiene texto suficiente.');
  }
  if (text.length > KNOWLEDGE_LIMITS.maxCharsPerDocument)
    throw new ExtractionError(`El documento supera el máximo de ${KNOWLEDGE_LIMITS.maxCharsPerDocument.toLocaleString('es-ES')} caracteres de texto. Divídelo en partes.`);
  return text;
}

/** Quita de la salida de toMarkdown la cabecera de metadatos del fichero (autor, fechas, programa), que no es contenido. */
export function cleanMarkdown(markdown: string): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let inMetadata = false;
  // toMarkdown abre con «# <nombre del fichero>»: no es contenido.
  if (/^#\s+\S+\.(pdf|docx)\s*$/i.test(lines[0]?.trim() ?? '')) lines.shift();
  for (const line of lines) {
    if (/^#{1,6}\s*metadata\s*$/i.test(line.trim())) { inMetadata = true; continue; }
    if (inMetadata) {
      if (/^#{1,6}\s+/.test(line.trim()) && !/^#{1,6}\s*metadata/i.test(line.trim())) inMetadata = false;
      else continue;
    }
    if (/^#{1,6}\s*contents?\s*$/i.test(line.trim())) continue;
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Fragmentos de ~900 caracteres con ~150 de solapamiento, sin cortar palabras. Cada fragmento conserva una pista de
 * cita: la página («p. 3», si el texto marca páginas) o el último encabezado Markdown.
 */
export function chunkText(text: string, size: number = KNOWLEDGE_LIMITS.chunkChars, overlap: number = KNOWLEDGE_LIMITS.overlapChars): Chunk[] {
  type Piece = { hint: string | null; text: string };
  const pieces: Piece[] = [];
  let page: string | null = null;
  let section: string | null = null;
  for (const block of text.split(/\n\s*\n/)) {
    const kept: string[] = [];
    for (const rawLine of block.split('\n')) {
      const line = rawLine.trim();
      // Marcas de página de toMarkdown («### Page 3»): fijan la pista y no son contenido.
      const pageMark = /^(?:#{1,6}\s*)?(?:page|p[aá]gina)\s+(\d{1,4})\s*$/i.exec(line);
      if (pageMark) { page = `p. ${pageMark[1]}`; continue; }
      const heading = /^#{1,6}\s+(.+)$/.exec(line);
      if (heading) {
        section = heading[1].replace(/[*_`#]/g, '').trim().slice(0, 80) || section;
        if (section) kept.push(`${section}:`);
        continue;
      }
      if (line) kept.push(line);
    }
    const hint = page && section ? `${page}, ${section}` : page ?? section;
    const clean = kept.join(' ').replace(/\s+/g, ' ').trim();
    if (!clean) continue;
    // Párrafos más largos que el fragmento: se parten por frases y, si hace falta, por palabras.
    if (clean.length <= size) { pieces.push({ hint, text: clean }); continue; }
    let current = '';
    for (const sentence of clean.split(/(?<=[.!?;:])\s+/)) {
      if (sentence.length > size) {
        for (const word of sentence.split(' ')) {
          if (current && current.length + word.length + 1 > size) { pieces.push({ hint, text: current }); current = ''; }
          current = current ? `${current} ${word}` : word.slice(0, size);
        }
        continue;
      }
      if (current && current.length + sentence.length + 1 > size) { pieces.push({ hint, text: current }); current = ''; }
      current = current ? `${current} ${sentence}` : sentence;
    }
    if (current) pieces.push({ hint, text: current });
  }
  const chunks: Chunk[] = [];
  let buffer = '';
  let bufferHint: string | null = null;
  // `fresh`: el búfer contiene texto nuevo (no solo el solapamiento del fragmento anterior).
  let fresh = false;
  for (const piece of pieces) {
    if (fresh && buffer.length + piece.text.length + 1 > size) {
      chunks.push({ ord: chunks.length, hint: bufferHint, text: buffer.trim() });
      // Solapamiento: las últimas palabras (≤ overlap caracteres) abren el fragmento siguiente.
      const tail = buffer.slice(-overlap);
      const cut = tail.indexOf(' ');
      buffer = buffer.length > overlap && cut >= 0 ? tail.slice(cut + 1) : '';
      fresh = false;
    }
    if (!fresh) bufferHint = piece.hint;
    buffer = buffer ? `${buffer}\n${piece.text}` : piece.text;
    fresh = true;
  }
  if (fresh && buffer.trim()) chunks.push({ ord: chunks.length, hint: bufferHint, text: buffer.trim() });
  return chunks;
}

/** Normaliza a norma 1: la similitud coseno pasa a ser un producto escalar. */
function normalize(vector: ArrayLike<number>): Float32Array {
  const out = new Float32Array(vector.length);
  let norm = 0;
  for (let index = 0; index < vector.length; index++) { const value = Number(vector[index]) || 0; out[index] = value; norm += value * value; }
  norm = Math.sqrt(norm) || 1;
  for (let index = 0; index < out.length; index++) out[index] /= norm;
  return out;
}

/** bge-m3: `{ text: string[] }` → `{ shape: [n, 1024], data: number[][] }`. Devuelve vectores normalizados. */
export async function embed(env: Env, texts: string[], requestId?: string): Promise<Float32Array[]> {
  const vectors: Float32Array[] = [];
  for (let start = 0; start < texts.length; start += KNOWLEDGE_LIMITS.embedBatch) {
    const batch = texts.slice(start, start + KNOWLEDGE_LIMITS.embedBatch);
    const result = await runAi(env, EMBEDDING_MODEL, { text: batch }, requestId, 'embedding') as { data?: unknown };
    const data = Array.isArray(result?.data) ? result.data as unknown[] : [];
    if (data.length !== batch.length || !data.every(row => Array.isArray(row) && row.length > 0))
      throw new AiServiceError(502, 'AI_EMBEDDING_INVALID', 'El servicio de IA no ha devuelto los vectores del documento.');
    for (const row of data) vectors.push(normalize(row as number[]));
  }
  return vectors;
}

/**
 * Procesa una subida de principio a fin dentro de la petición: fila «processing», original en R2, texto, fragmentos,
 * vectores (R2) y fragmentos (D1), y «ready». Un fallo de contenido queda en el documento como «error» con un
 * mensaje para la persona; uno de cuota (AI_QUOTA) se propaga para que el cliente lo muestre.
 */
export async function addDocument(env: Env, tenantId: string, collectionId: string, input: UploadInput, requestId?: string): Promise<DocumentRow> {
  const counts = await env.DB.prepare(`SELECT COUNT(*) AS documents, COALESCE(SUM(CASE WHEN status = 'ready' THEN chunk_count ELSE 0 END), 0) AS chunks
    FROM knowledge_documents WHERE tenant_id = ? AND collection_id = ?`).bind(tenantId, collectionId).first<{ documents: number; chunks: number }>();
  if (Number(counts?.documents ?? 0) >= KNOWLEDGE_LIMITS.maxDocumentsPerCollection)
    throw new AiServiceError(409, 'LIMIT_DOCUMENTS', `Una colección admite como máximo ${KNOWLEDGE_LIMITS.maxDocumentsPerCollection} documentos.`);
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.DB.prepare('INSERT INTO knowledge_documents (id,tenant_id,collection_id,name,mime,bytes,chars,status,created_at) VALUES (?,?,?,?,?,?,0,?,?)')
    .bind(id, tenantId, collectionId, input.name, input.mime, input.bytes.length, 'processing', createdAt).run();
  const fail = async (message: string) => {
    await env.FILES.delete([objectKey(tenantId, collectionId, id), vectorKey(tenantId, collectionId, id)]);
    await env.DB.batch([
      env.DB.prepare('DELETE FROM knowledge_chunks WHERE tenant_id = ? AND document_id = ?').bind(tenantId, id),
      env.DB.prepare("UPDATE knowledge_documents SET status = 'error', error = ? WHERE tenant_id = ? AND id = ?").bind(message, tenantId, id)
    ]);
  };
  try {
    await env.FILES.put(objectKey(tenantId, collectionId, id), input.bytes, { httpMetadata: { contentType: input.mime } });
    const text = await extractText(env, input);
    const chunks = chunkText(text);
    if (Number(counts?.chunks ?? 0) + chunks.length > KNOWLEDGE_LIMITS.maxChunksPerCollection)
      throw new ExtractionError(`La colección superaría el máximo de ${KNOWLEDGE_LIMITS.maxChunksPerCollection} fragmentos (unos ${Math.round(KNOWLEDGE_LIMITS.maxChunksPerCollection * 0.75)} 000 caracteres). Usa documentos más cortos o crea otra colección.`);
    const vectors = await embed(env, chunks.map(chunk => chunk.hint ? `${chunk.hint}\n${chunk.text}` : chunk.text), requestId);
    const dims = vectors[0].length;
    const packed = new Float32Array(vectors.length * dims);
    vectors.forEach((vector, index) => packed.set(vector, index * dims));
    await env.FILES.put(vectorKey(tenantId, collectionId, id), packed.buffer, { customMetadata: { dims: String(dims), count: String(vectors.length) } });
    // Inserción por lotes con json_each: un parámetro por sentencia (D1 limita a 100 parámetros por consulta).
    const rows = chunks.map(chunk => ({ id: crypto.randomUUID(), ord: chunk.ord, hint: chunk.hint, text: chunk.text }));
    const statements: D1PreparedStatement[] = [];
    for (let start = 0; start < rows.length; start += 200) {
      statements.push(env.DB.prepare(`INSERT INTO knowledge_chunks (id,tenant_id,collection_id,document_id,ord,hint,text)
        SELECT json_extract(value,'$.id'), ?, ?, ?, json_extract(value,'$.ord'), json_extract(value,'$.hint'), json_extract(value,'$.text') FROM json_each(?)`)
        .bind(tenantId, collectionId, id, JSON.stringify(rows.slice(start, start + 200))));
    }
    statements.push(env.DB.prepare("UPDATE knowledge_documents SET status = 'ready', chars = ?, chunk_count = ?, error = NULL WHERE tenant_id = ? AND id = ?")
      .bind(text.length, chunks.length, tenantId, id));
    await env.DB.batch(statements);
    forgetVectors(collectionId);
    console.log(JSON.stringify({ code: 'KNOWLEDGE_DOCUMENT_READY', requestId, documentId: id, mime: input.mime, bytes: input.bytes.length, chars: text.length, chunks: chunks.length }));
  } catch (error) {
    if (error instanceof ExtractionError) await fail(error.message);
    else {
      await fail(error instanceof AiServiceError && error.code === 'AI_QUOTA' ? error.message : 'No se ha podido procesar el documento. Inténtalo de nuevo.');
      console.warn(JSON.stringify({ code: 'KNOWLEDGE_DOCUMENT_FAILED', requestId, documentId: id, message: String((error as Error)?.message ?? error).slice(0, 200) }));
      if (error instanceof AiServiceError) throw error;
    }
  }
  return (await documentRow(env, tenantId, id))!;
}

// ---------------------------------------------------------------------------------------------
// Recuperación
// ---------------------------------------------------------------------------------------------
interface IndexedDocument { id: string; name: string; count: number; dims: number; vectors: Float32Array }
export interface CollectionIndex { documents: IndexedDocument[]; total: number }

/** Caché por isolate de los vectores de cada documento (inmutables una vez «ready»). */
const vectorCache = new Map<string, { collectionId: string; doc: IndexedDocument }>();
const VECTOR_CACHE_LIMIT = 40;

function forgetVectors(collectionId: string): void {
  for (const [key, value] of vectorCache) if (value.collectionId === collectionId) vectorCache.delete(key);
}

export async function loadIndex(env: Env, tenantId: string, collectionId: string): Promise<CollectionIndex> {
  const rows = await env.DB.prepare(`SELECT id, name, chunk_count AS count FROM knowledge_documents
    WHERE tenant_id = ? AND collection_id = ? AND status = 'ready' ORDER BY created_at, id`).bind(tenantId, collectionId).all<{ id: string; name: string; count: number }>();
  const documents: IndexedDocument[] = [];
  for (const row of rows.results) {
    const cacheKey = `${tenantId}:${row.id}`;
    let doc = vectorCache.get(cacheKey)?.doc;
    if (!doc) {
      const object = await env.FILES.get(vectorKey(tenantId, collectionId, row.id));
      if (!object) continue;
      const vectors = new Float32Array(await object.arrayBuffer());
      const count = Number(row.count);
      if (!count || vectors.length % count) continue;
      doc = { id: row.id, name: row.name, count, dims: vectors.length / count, vectors };
      if (vectorCache.size >= VECTOR_CACHE_LIMIT) vectorCache.delete(vectorCache.keys().next().value!);
      vectorCache.set(cacheKey, { collectionId, doc });
    }
    documents.push(doc);
  }
  return { documents, total: documents.reduce((sum, doc) => sum + doc.count, 0) };
}

export interface ChunkRef { documentId: string; ord: number }

export function vectorOf(index: CollectionIndex, ref: ChunkRef): Float32Array | null {
  const doc = index.documents.find(item => item.id === ref.documentId);
  if (!doc || ref.ord < 0 || ref.ord >= doc.count) return null;
  return doc.vectors.subarray(ref.ord * doc.dims, (ref.ord + 1) * doc.dims);
}

/** Fragmento en la posición global `position` (documentos concatenados en orden de subida). */
export function refAt(index: CollectionIndex, position: number): ChunkRef | null {
  let offset = position;
  for (const doc of index.documents) {
    if (offset < doc.count) return { documentId: doc.id, ord: offset };
    offset -= doc.count;
  }
  return null;
}

/** Los `k` fragmentos más similares a `query` (coseno sobre vectores normalizados), sin los excluidos. */
export function rank(index: CollectionIndex, query: Float32Array, k: number, exclude: Set<string> = new Set()): (ChunkRef & { score: number })[] {
  const best: (ChunkRef & { score: number })[] = [];
  for (const doc of index.documents) {
    if (doc.dims !== query.length) continue;
    const { vectors, dims } = doc;
    for (let ord = 0; ord < doc.count; ord++) {
      if (exclude.size && exclude.has(`${doc.id}:${ord}`)) continue;
      let score = 0;
      const base = ord * dims;
      for (let d = 0; d < dims; d++) score += vectors[base + d] * query[d];
      if (best.length < k) { best.push({ documentId: doc.id, ord, score }); best.sort((a, b) => b.score - a.score); }
      else if (score > best[k - 1].score) { best[k - 1] = { documentId: doc.id, ord, score }; best.sort((a, b) => b.score - a.score); }
    }
  }
  return best;
}

/** Texto de los fragmentos indicados (una consulta), en el orden de `refs`. */
export async function chunkTexts(env: Env, tenantId: string, collectionId: string, refs: (ChunkRef & { score?: number })[]): Promise<RetrievedChunk[]> {
  if (!refs.length) return [];
  const keys = refs.map(ref => `${ref.documentId}:${ref.ord}`);
  const rows = await env.DB.prepare(`SELECT c.document_id AS documentId, d.name AS documentName, c.ord, c.hint, c.text
    FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id AND d.tenant_id = c.tenant_id
    WHERE c.tenant_id = ? AND c.collection_id = ? AND (c.document_id || ':' || c.ord) IN (SELECT value FROM json_each(?))`)
    .bind(tenantId, collectionId, JSON.stringify(keys)).all<Omit<RetrievedChunk, 'score'>>();
  const byKey = new Map(rows.results.map(row => [`${row.documentId}:${Number(row.ord)}`, row]));
  return refs.flatMap(ref => {
    const row = byKey.get(`${ref.documentId}:${ref.ord}`);
    return row ? [{ ...row, ord: Number(row.ord), hint: row.hint ?? null, score: ref.score ?? 0 }] : [];
  });
}

/** Búsqueda semántica de una consulta libre (pregunta o foco) en la colección. */
export async function search(env: Env, tenantId: string, collectionId: string, query: string, k: number, requestId?: string): Promise<RetrievedChunk[]> {
  const index = await loadIndex(env, tenantId, collectionId);
  if (!index.total) return [];
  const [vector] = await embed(env, [query], requestId);
  return chunkTexts(env, tenantId, collectionId, rank(index, vector, k));
}
