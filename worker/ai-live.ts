import { AiServiceError, inBackground, runAi } from './ai-common';
import {
  ANSWER_SCHEMA, SITUATION_SCHEMA, SUMMARY_SCHEMA, UNKNOWN_ANSWER, answerPrompt, clip, generateJson, situationPrompt, summaryPrompt,
  validateAnswer, validateSituation, validateSummary, type Excerpt, type GeneratedSituation, type GeneratedSummary, type Quality, type SummaryTurn
} from './ai-live-prompts';
import { CLEF_MODEL, CONFIRM_CONFIDENCE, CONFIRM_THRESHOLD, DECIDE_THRESHOLD, MAX_PHRASE_LENGTH } from './voice-intent';
import { chunkTexts, collectionFor, embed, loadIndex, rank, refAt, search, validId, vectorOf, type ChunkRef, type RetrievedChunk } from './knowledge';
import type { Env } from './types';

/**
 * «Modo IA en vivo (demo)»: partidas generadas con IA sobre una colección de conocimiento del instructor.
 * Cada situación sale SOLO de fragmentos recuperados de la colección (RAG); la frase dicha se interpreta con atajos
 * locales y, si no, con Clef; las preguntas se responden con los fragmentos más parecidos. No se guarda la frase.
 */
export const SITUATIONS = { min: 3, max: 6, default: 4 } as const;
export const MAX_FOCUS = 200;
const EXCERPTS_PER_SITUATION = 5;
const EXCERPTS_PER_ANSWER = 5;
const SITUATION_MAX_TOKENS = 2200;
const ANSWER_MAX_TOKENS = 700;
const SUMMARY_MAX_TOKENS = 900;
/** Una generación «colgada» (isolate reciclado) se puede reclamar pasado este tiempo. */
const CLAIM_STALE_MS = 75_000;
/** Espera a que otra petición termine la situación: sondeo cada 2 s (pocas consultas a D1), hasta 60 s. */
const WAIT_POLL_MS = 2_000;
const WAIT_LIMIT_MS = 60_000;

export interface RunPublic { id: string; collectionId: string; situationsTotal: number; index: number; status: 'active' | 'complete'; focus: string | null; createdAt: string }
export interface SourcePublic { id: string; document: string; location: string | null; excerpt: string }
export interface OptionPublic { label: string; quality: Quality; consequence: string; rationale: string; sources: string[] }
export interface SituationPublic { id: string; index: number; title: string; narration: string; options: OptionPublic[]; sources: SourcePublic[] }
export interface Reaction { spoken: string; quality: Quality | null; sources: string[] }
export interface Summary { spoken: string; takeaways: string[]; optimalCount: number; total: number }
interface StoredSituation { situation: SituationPublic; reactions: string[] }
interface RunState { focus: string | null; anchors: ChunkRef[]; pendingConfirm: number | null }
interface RunRow { id: string; collectionId: string; createdBy: string; createdAt: string; status: 'active' | 'complete'; total: number; index: number; stateJson: string; summaryJson: string | null }

export type AnswerResult =
  | { kind: 'decision'; optionIndex: number; reaction: Reaction }
  | { kind: 'confirm'; optionIndex: number; prompt: string }
  | { kind: 'answer'; spoken: string; sources: SourcePublic[] }
  | { kind: 'repeat' }
  | { kind: 'next' }
  | { kind: 'unclear'; spoken: string };

export interface LiveContext { env: Env; tenantId: string; userId: string; requestId?: string; waitUntil: ((promise: Promise<unknown>) => void) | null }

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// Partidas
// ---------------------------------------------------------------------------------------------
function toPublic(row: RunRow): RunPublic {
  const state = JSON.parse(row.stateJson) as RunState;
  return { id: row.id, collectionId: row.collectionId, situationsTotal: Number(row.total), index: Number(row.index), status: row.status, focus: state.focus, createdAt: row.createdAt };
}

/** Partida de la persona (solo quien la creó, en su organización); null si no existe para ella. */
async function runRow(ctx: LiveContext, id: string): Promise<RunRow | null> {
  if (!validId(id)) return null;
  return ctx.env.DB.prepare(`SELECT id, collection_id AS collectionId, created_by AS createdBy, created_at AS createdAt, status,
      situations_total AS total, current_index AS "index", state_json AS stateJson, summary_json AS summaryJson
    FROM ai_runs WHERE tenant_id = ? AND id = ? AND created_by = ?`).bind(ctx.tenantId, id, ctx.userId).first<RunRow>();
}

export async function ownsRun(env: Env, tenantId: string, userId: string, id: string): Promise<boolean> {
  return Boolean(await runRow({ env, tenantId, userId, waitUntil: null }, id));
}

export function parseRunRequest(body: unknown): { collectionId: string; situations: number; focus: string | null } {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!validId(data.collectionId)) throw new AiServiceError(400, 'INVALID_COLLECTION', 'Indica la colección (collectionId).');
  const situations = data.situations === undefined ? SITUATIONS.default : data.situations;
  if (typeof situations !== 'number' || !Number.isInteger(situations) || situations < SITUATIONS.min || situations > SITUATIONS.max)
    throw new AiServiceError(400, 'INVALID_SITUATIONS', `El número de situaciones debe estar entre ${SITUATIONS.min} y ${SITUATIONS.max}.`);
  let focus: string | null = null;
  if (data.focus !== undefined && data.focus !== null) {
    if (typeof data.focus !== 'string') throw new AiServiceError(400, 'INVALID_FOCUS', 'El tema debe ser un texto.');
    focus = data.focus.replace(/\s+/g, ' ').trim() || null;
    if (focus && focus.length > MAX_FOCUS) throw new AiServiceError(400, 'INVALID_FOCUS', `El tema admite como máximo ${MAX_FOCUS} caracteres.`);
  }
  return { collectionId: data.collectionId, situations, focus };
}

/**
 * Crea la partida y elige un fragmento «ancla» por situación: repartidos por toda la colección o, con tema,
 * los más parecidos al tema sin repetir casi lo mismo. Genera la primera situación en segundo plano.
 */
export async function createRun(ctx: LiveContext, request: ReturnType<typeof parseRunRequest>): Promise<RunPublic> {
  const collection = await collectionFor(ctx.env, ctx.tenantId, request.collectionId);
  if (!collection) throw new AiServiceError(404, 'NOT_FOUND', 'Colección no encontrada.');
  const index = await loadIndex(ctx.env, ctx.tenantId, request.collectionId);
  if (!index.total) throw new AiServiceError(409, 'EMPTY_COLLECTION', 'La colección no tiene documentos listos. Sube al menos un documento.');
  const anchors: ChunkRef[] = [];
  if (request.focus) {
    const [query] = await embed(ctx.env, [request.focus], ctx.requestId);
    const candidates = rank(index, query, Math.min(index.total, request.situations * 4));
    for (const candidate of candidates) {
      if (anchors.length >= request.situations) break;
      const vector = vectorOf(index, candidate)!;
      const similar = anchors.some(anchor => { const other = vectorOf(index, anchor)!; let dot = 0; for (let d = 0; d < vector.length; d++) dot += vector[d] * other[d]; return dot > 0.9; });
      if (!similar) anchors.push({ documentId: candidate.documentId, ord: candidate.ord });
    }
    for (let i = 0; anchors.length < request.situations && candidates.length; i++) anchors.push({ documentId: candidates[i % candidates.length].documentId, ord: candidates[i % candidates.length].ord });
  } else {
    for (let i = 0; i < request.situations; i++) anchors.push(refAt(index, Math.floor(((i + 0.5) * index.total) / request.situations) % index.total)!);
  }
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const state: RunState = { focus: request.focus, anchors, pendingConfirm: null };
  await ctx.env.DB.prepare(`INSERT INTO ai_runs (id,tenant_id,collection_id,created_by,created_at,status,situations_total,current_index,state_json)
    VALUES (?,?,?,?,?,'active',?,0,?)`).bind(id, ctx.tenantId, request.collectionId, ctx.userId, createdAt, request.situations, JSON.stringify(state)).run();
  inBackground(ctx.waitUntil, () => ensureSituation(ctx, id, 0));
  return { id, collectionId: request.collectionId, situationsTotal: request.situations, index: 0, status: 'active', focus: request.focus, createdAt };
}

export async function getRun(ctx: LiveContext, id: string) {
  const row = await runRow(ctx, id);
  if (!row) throw new AiServiceError(404, 'NOT_FOUND', 'Partida no encontrada.');
  const turns = await ctx.env.DB.prepare(`SELECT idx, situation_json AS situationJson, answered, chosen, reaction_json AS reactionJson
    FROM ai_turns WHERE tenant_id = ? AND run_id = ? AND status = 'ready' ORDER BY idx`).bind(ctx.tenantId, id)
    .all<{ idx: number; situationJson: string; answered: number; chosen: number | null; reactionJson: string | null }>();
  const history = turns.results.filter(turn => turn.answered).map(turn => ({
    situation: (JSON.parse(turn.situationJson) as StoredSituation).situation,
    chosen: turn.chosen === null ? null : Number(turn.chosen),
    reaction: turn.reactionJson ? JSON.parse(turn.reactionJson) as Reaction : null
  }));
  const currentTurn = row.status === 'active' ? turns.results.find(turn => Number(turn.idx) === Number(row.index) && !turn.answered) : undefined;
  return {
    run: toPublic(row),
    current: currentTurn ? (JSON.parse(currentTurn.situationJson) as StoredSituation).situation : null,
    history,
    summary: row.summaryJson ? JSON.parse(row.summaryJson) as Summary : null
  };
}

export async function deleteRun(ctx: LiveContext, id: string): Promise<boolean> {
  if (!await runRow(ctx, id)) return false;
  await ctx.env.DB.batch([
    ctx.env.DB.prepare('DELETE FROM ai_turns WHERE tenant_id = ? AND run_id = ?').bind(ctx.tenantId, id),
    ctx.env.DB.prepare('DELETE FROM ai_runs WHERE tenant_id = ? AND id = ?').bind(ctx.tenantId, id)
  ]);
  return true;
}

// ---------------------------------------------------------------------------------------------
// Situaciones: generación con reclamación en D1 (una sola generación por situación)
// ---------------------------------------------------------------------------------------------
type TurnRow = { status: 'generating' | 'ready' | 'error'; claimedAt: string; situationJson: string | null; answered: number; chosen: number | null };

async function turnRow(ctx: LiveContext, runId: string, idx: number): Promise<TurnRow | null> {
  return ctx.env.DB.prepare(`SELECT status, claimed_at AS claimedAt, situation_json AS situationJson, answered, chosen
    FROM ai_turns WHERE tenant_id = ? AND run_id = ? AND idx = ?`).bind(ctx.tenantId, runId, idx).first<TurnRow>();
}

/** Devuelve la situación `idx`, generándola si nadie lo está haciendo o esperando a quien la genera. */
export async function ensureSituation(ctx: LiveContext, runId: string, idx: number): Promise<StoredSituation> {
  const deadline = Date.now() + WAIT_LIMIT_MS;
  for (;;) {
    const row = await turnRow(ctx, runId, idx);
    if (row?.status === 'ready' && row.situationJson) return JSON.parse(row.situationJson) as StoredSituation;
    const now = new Date().toISOString();
    let claimed = false;
    if (!row) {
      const inserted = await ctx.env.DB.prepare(`INSERT OR IGNORE INTO ai_turns (run_id,tenant_id,idx,status,claimed_at) VALUES (?,?,?,'generating',?)`)
        .bind(runId, ctx.tenantId, idx, now).run();
      claimed = (inserted.meta.changes ?? 0) > 0;
    } else if (row.status === 'error' || Date.parse(row.claimedAt) < Date.now() - CLAIM_STALE_MS) {
      const updated = await ctx.env.DB.prepare(`UPDATE ai_turns SET status = 'generating', claimed_at = ? WHERE tenant_id = ? AND run_id = ? AND idx = ? AND claimed_at = ? AND status = ?`)
        .bind(now, ctx.tenantId, runId, idx, row.claimedAt, row.status).run();
      claimed = (updated.meta.changes ?? 0) > 0;
    }
    if (claimed) {
      try {
        const stored = await generateSituation(ctx, runId, idx);
        await ctx.env.DB.prepare(`UPDATE ai_turns SET status = 'ready', situation_json = ? WHERE tenant_id = ? AND run_id = ? AND idx = ?`)
          .bind(JSON.stringify(stored), ctx.tenantId, runId, idx).run();
        return stored;
      } catch (error) {
        await ctx.env.DB.prepare(`UPDATE ai_turns SET status = 'error' WHERE tenant_id = ? AND run_id = ? AND idx = ?`).bind(ctx.tenantId, runId, idx).run();
        throw error;
      }
    }
    if (row?.status === 'error') continue;
    if (Date.now() > deadline) throw new AiServiceError(503, 'AI_PENDING', 'La situación está tardando más de lo normal. Inténtalo de nuevo en unos segundos.');
    await sleep(WAIT_POLL_MS);
  }
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  const random = new Uint32Array(out.length);
  crypto.getRandomValues(random);
  for (let i = out.length - 1; i > 0; i--) { const j = random[i] % (i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}

function excerptsFrom(chunks: RetrievedChunk[], prefix = 'F'): Excerpt[] {
  return chunks.map((chunk, index) => ({ id: `${prefix}${index + 1}`, document: chunk.documentName, hint: chunk.hint, text: chunk.text }));
}

function sourcesFrom(excerpts: Excerpt[], used: Set<string>): SourcePublic[] {
  return excerpts.filter(item => used.has(item.id)).map(item => ({ id: item.id, document: item.document, location: item.hint, excerpt: clip(item.text, 240) }));
}

async function generateSituation(ctx: LiveContext, runId: string, idx: number): Promise<StoredSituation> {
  const row = await ctx.env.DB.prepare(`SELECT collection_id AS collectionId, situations_total AS total, state_json AS stateJson FROM ai_runs WHERE tenant_id = ? AND id = ?`)
    .bind(ctx.tenantId, runId).first<{ collectionId: string; total: number; stateJson: string }>();
  if (!row) throw new AiServiceError(404, 'NOT_FOUND', 'Partida no encontrada.');
  const state = JSON.parse(row.stateJson) as RunState;
  const index = await loadIndex(ctx.env, ctx.tenantId, row.collectionId);
  if (!index.total) throw new AiServiceError(409, 'EMPTY_COLLECTION', 'La colección ya no tiene documentos listos.');
  // Si el documento del ancla se borró, se usa un fragmento repartido por la colección.
  const anchor = vectorOf(index, state.anchors[idx] ?? { documentId: '', ord: -1 })
    ?? vectorOf(index, refAt(index, Math.floor(((idx + 0.5) * index.total) / Number(row.total)) % index.total)!)!;
  const chunks = await chunkTexts(ctx.env, ctx.tenantId, row.collectionId, rank(index, anchor, EXCERPTS_PER_SITUATION));
  const excerpts = excerptsFrom(chunks);
  const previous = await ctx.env.DB.prepare(`SELECT situation_json AS situationJson FROM ai_turns WHERE tenant_id = ? AND run_id = ? AND idx < ? AND status = 'ready' ORDER BY idx`)
    .bind(ctx.tenantId, runId, idx).all<{ situationJson: string }>();
  const previousTitles = previous.results.map(item => (JSON.parse(item.situationJson) as StoredSituation).situation.title);
  const generated = await generateJson<GeneratedSituation>(ctx.env,
    situationPrompt(excerpts, { index: idx, total: Number(row.total), focus: state.focus, previousTitles }),
    SITUATION_SCHEMA, SITUATION_MAX_TOKENS, value => validateSituation(value, excerpts.map(item => item.id)), ctx.requestId);
  const options = shuffle(generated.options);
  const used = new Set(options.flatMap(option => option.sources));
  return {
    situation: {
      id: `${runId}-${idx + 1}`,
      index: idx,
      title: generated.title,
      narration: generated.narration,
      options: options.map(({ label, quality, consequence, rationale, sources }) => ({ label, quality, consequence, rationale, sources })),
      sources: sourcesFrom(excerpts, used)
    },
    reactions: options.map(option => option.reaction)
  };
}

/**
 * Siguiente paso de la partida: la situación actual si aún no se ha respondido; si ya se respondió, avanza.
 * Tras la última, el resumen. Genera por adelantado solo la situación siguiente (ahorro de neuronas).
 */
export async function nextStep(ctx: LiveContext, id: string): Promise<{ situation: SituationPublic } | { done: true; summary: Summary }> {
  let row = await runRow(ctx, id);
  if (!row) throw new AiServiceError(404, 'NOT_FOUND', 'Partida no encontrada.');
  if (row.status === 'complete' && row.summaryJson) return { done: true, summary: JSON.parse(row.summaryJson) as Summary };
  const current = await turnRow(ctx, id, Number(row.index));
  if (current?.answered) {
    const state = JSON.parse(row.stateJson) as RunState;
    await ctx.env.DB.prepare('UPDATE ai_runs SET current_index = ?, state_json = ? WHERE tenant_id = ? AND id = ? AND current_index = ?')
      .bind(Number(row.index) + 1, JSON.stringify({ ...state, pendingConfirm: null }), ctx.tenantId, id, Number(row.index)).run();
    row = (await runRow(ctx, id))!;
  }
  const idx = Number(row.index);
  if (idx >= Number(row.total)) return { done: true, summary: await ensureSummary(ctx, id) };
  const stored = await ensureSituation(ctx, id, idx);
  if (idx + 1 < Number(row.total)) inBackground(ctx.waitUntil, () => ensureSituation(ctx, id, idx + 1));
  return { situation: stored.situation };
}

// ---------------------------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------------------------
export async function ensureSummary(ctx: LiveContext, id: string): Promise<Summary> {
  const row = await ctx.env.DB.prepare('SELECT summary_json AS summaryJson, situations_total AS total FROM ai_runs WHERE tenant_id = ? AND id = ?')
    .bind(ctx.tenantId, id).first<{ summaryJson: string | null; total: number }>();
  if (!row) throw new AiServiceError(404, 'NOT_FOUND', 'Partida no encontrada.');
  if (row.summaryJson) return JSON.parse(row.summaryJson) as Summary;
  const turns = await ctx.env.DB.prepare(`SELECT situation_json AS situationJson, chosen FROM ai_turns WHERE tenant_id = ? AND run_id = ? AND status = 'ready' AND answered = 1 ORDER BY idx`)
    .bind(ctx.tenantId, id).all<{ situationJson: string; chosen: number | null }>();
  const items: SummaryTurn[] = turns.results.map(turn => {
    const { situation } = JSON.parse(turn.situationJson) as StoredSituation;
    const chosen = turn.chosen === null ? null : situation.options[Number(turn.chosen)];
    const best = situation.options.find(option => option.quality === 'best')!;
    return { title: situation.title, chosen: chosen?.label ?? null, quality: chosen?.quality ?? null, best: best.label, rationale: best.rationale };
  });
  const optimalCount = items.filter(item => item.quality === 'best').length;
  const total = Number(row.total);
  let generated: GeneratedSummary;
  try {
    generated = await generateJson(ctx.env, summaryPrompt(items, optimalCount), SUMMARY_SCHEMA, SUMMARY_MAX_TOKENS, validateSummary, ctx.requestId);
  } catch (error) {
    // El cierre no debe bloquear la demo: sin IA (o sin cuota), un resumen determinista con las justificaciones.
    console.warn(JSON.stringify({ code: 'AI_SUMMARY_FALLBACK', requestId: ctx.requestId, reason: (error as AiServiceError)?.code ?? 'error' }));
    const takeaways = items.map(item => item.rationale).slice(0, 3);
    while (takeaways.length < 3) takeaways.push('Antes de decidir, comprueba qué dicen los documentos de referencia.');
    generated = {
      spoken: `Hemos terminado. Has elegido la mejor opción en ${optimalCount} de ${total} situaciones. Repasa las ideas clave que tienes en pantalla: son las que mejor resumen lo que dicen los documentos. ¡Gracias por participar!`,
      takeaways
    };
  }
  const summary: Summary = { ...generated, optimalCount, total };
  await ctx.env.DB.prepare(`UPDATE ai_runs SET summary_json = ?, status = 'complete' WHERE tenant_id = ? AND id = ? AND summary_json IS NULL`)
    .bind(JSON.stringify(summary), ctx.tenantId, id).run();
  const saved = await ctx.env.DB.prepare('SELECT summary_json AS summaryJson FROM ai_runs WHERE tenant_id = ? AND id = ?').bind(ctx.tenantId, id).first<{ summaryJson: string }>();
  return JSON.parse(saved!.summaryJson) as Summary;
}

// ---------------------------------------------------------------------------------------------
// Respuesta hablada
// ---------------------------------------------------------------------------------------------
/** Minúsculas, sin tildes ni signos: «¡La Tres!» → «la tres». */
export function normalizePhrase(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

const NUMBERS: Record<string, number> = {
  '1': 0, uno: 0, una: 0, primera: 0, primero: 0, a: 0,
  '2': 1, dos: 1, segunda: 1, segundo: 1, b: 1,
  '3': 2, tres: 2, tercera: 2, tercero: 2, c: 2,
  '4': 3, cuatro: 3, cuarta: 3, cuarto: 3, d: 3
};
const OPTION_COMMAND = /^(?:(?:elijo|escojo|prefiero|me quedo con|voy con|marco|selecciono|la respuesta es|creo que|yo diria)\s+)?(?:(?:la|el)\s+)?(?:opcion\s+)?(?:numero\s+)?(1|2|3|4|uno|una|dos|tres|cuatro|primera|primero|segunda|segundo|tercera|tercero|cuarta|cuarto|a|b|c|d)(?:\s+(?:opcion|por favor))?$/;
const REPEAT_COMMAND = /^(?:(?:puedes|podrias)\s+)?(?:repite|repitelo|repitemelo|repetir|repetirlo|otra vez|vuelve a (?:leer|decir)(?:lo)?|no te he (?:oido|entendido))(?:\s+(?:por favor|la pregunta|las opciones|la situacion))?$/;
const NEXT_COMMAND = /^(?:siguiente|la siguiente|pasa a la siguiente|continua|continuar|continuamos|adelante|sigamos|seguimos|sigue|vamos|otra|paso|salta|saltar|siguiente situacion|siguiente pregunta)(?:\s+por favor)?$/;
const YES = /^(?:si|eso|esa|exacto|correcto|claro|vale|afirmativo|efectivamente|eso es|si esa|si eso|si exacto|si por favor|si correcto|esa misma)$/;
const NO = /^(?:no|negativo|no es eso|no esa no|no eso no|otra no)$/;
const QUESTION_START = /^(?:que|como|cuando|cuanto|cuantos|cuantas|quien|quienes|donde|cual|cuales|por que|puedo|se puede|hay que|tengo que|debo|es obligatorio|existe|me puedes|explica|explicame|dime)\b/;

export type QuickIntent = { kind: 'option'; option: number } | { kind: 'repeat' } | { kind: 'next' } | { kind: 'yes' } | { kind: 'no' } | null;

/** Atajos locales (sin IA): número de opción, «repite», «siguiente», «sí» / «no». */
export function quickIntent(phrase: string): QuickIntent {
  const text = normalizePhrase(phrase);
  const option = OPTION_COMMAND.exec(text);
  if (option) return { kind: 'option', option: NUMBERS[option[1]] };
  if (REPEAT_COMMAND.test(text)) return { kind: 'repeat' };
  if (NEXT_COMMAND.test(text)) return { kind: 'next' };
  if (YES.test(text)) return { kind: 'yes' };
  if (NO.test(text)) return { kind: 'no' };
  return null;
}

export function looksLikeQuestion(phrase: string): boolean {
  return /[?¿]/.test(phrase) || QUESTION_START.test(normalizePhrase(phrase));
}

/** Clef con el conjunto ampliado del modo IA en vivo. Solo la situación, las opciones y la frase; sin identidad. */
export function liveClefRequest(situation: Pick<SituationPublic, 'title' | 'narration' | 'options'>, phrase: string) {
  const criteria: Record<string, string> = {};
  situation.options.forEach((option, index) => { criteria[`opcion_${index + 1}`] = option.label; });
  criteria.pregunta = 'La persona hace una pregunta sobre el contenido, una norma o un concepto, en lugar de elegir una opción.';
  criteria.repetir = 'Pide que se repita la situación o las opciones.';
  criteria.siguiente = 'Pide pasar a la siguiente situación o continuar.';
  criteria.ninguna = 'La frase no corresponde claramente a nada de lo anterior: duda, mezcla varias opciones o no tiene relación.';
  return {
    model: 'clef-flash',
    state: JSON.stringify({ situacion: situation.title, contexto: situation.narration, respuesta_de_la_persona: phrase }),
    questions: {
      intencion: {
        type: 'choice',
        instructions: 'Una persona responde en voz alta en una simulación formativa. ¿Qué hace su respuesta: elige una opción (¿cuál?), hace una pregunta sobre el contenido, pide repetir o pide continuar? Elige «ninguna» si no está claro.',
        criteria
      }
    }
  };
}

export type LiveIntent = { kind: 'option'; option: number; decide: boolean } | { kind: 'pregunta' | 'repetir' | 'siguiente' } | { kind: 'unclear' };

/** Mismo doble umbral que Clef en las sesiones (probabilidad de la elección y `confidence` global). */
export function interpretLiveClef(result: unknown, optionCount: number): LiveIntent {
  const answer = (result as { answers?: { intencion?: { choice?: unknown; probabilities?: Record<string, unknown>; confidence?: unknown } } } | null)?.answers?.intencion;
  const choice = typeof answer?.choice === 'string' ? answer.choice : '';
  const clamp = (value: unknown) => { const n = Number(value); return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0; };
  const probability = clamp(answer?.probabilities?.[choice]);
  const certainty = answer?.confidence === undefined ? probability : clamp(answer.confidence);
  if (probability < CONFIRM_THRESHOLD || certainty < CONFIRM_CONFIDENCE) return { kind: 'unclear' };
  const match = /^opcion_(\d)$/.exec(choice);
  if (match) {
    const option = Number(match[1]) - 1;
    if (option < 0 || option >= optionCount) return { kind: 'unclear' };
    return { kind: 'option', option, decide: Math.min(probability, certainty) >= DECIDE_THRESHOLD };
  }
  if (choice === 'pregunta' || choice === 'repetir' || choice === 'siguiente') return { kind: choice };
  return { kind: 'unclear' };
}

export function parseAnswerRequest(body: unknown): { phrase: string | null; optionIndex: number | null } {
  const data = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (data.optionIndex !== undefined && data.optionIndex !== null) {
    if (typeof data.optionIndex !== 'number' || !Number.isInteger(data.optionIndex) || data.optionIndex < 0 || data.optionIndex > 3)
      throw new AiServiceError(400, 'INVALID_OPTION', 'La opción debe ser un número entre 0 y 3.');
    return { phrase: null, optionIndex: data.optionIndex };
  }
  const phrase = typeof data.phrase === 'string' ? data.phrase.trim().slice(0, MAX_PHRASE_LENGTH) : '';
  if (!phrase) throw new AiServiceError(400, 'EMPTY_PHRASE', 'No se ha recibido ninguna frase ni opción.');
  return { phrase, optionIndex: null };
}

const ALREADY_ANSWERED = 'Ya has respondido a esta situación. Di «siguiente» para continuar o pregúntame lo que necesites.';
const UNCLEAR = 'No te he entendido bien. Puedes decir el número de la opción, pedirme que lo repita o hacerme una pregunta sobre el contenido.';

export async function answer(ctx: LiveContext, id: string, request: ReturnType<typeof parseAnswerRequest>): Promise<AnswerResult> {
  const row = await runRow(ctx, id);
  if (!row) throw new AiServiceError(404, 'NOT_FOUND', 'Partida no encontrada.');
  if (row.status !== 'active') throw new AiServiceError(409, 'RUN_COMPLETE', 'La partida ha terminado.');
  const idx = Number(row.index);
  const turn = await turnRow(ctx, id, idx);
  if (!turn || turn.status !== 'ready' || !turn.situationJson) throw new AiServiceError(409, 'NO_SITUATION', 'Todavía no hay ninguna situación en curso. Pide la siguiente.');
  const stored = JSON.parse(turn.situationJson) as StoredSituation;
  const { situation } = stored;
  const state = JSON.parse(row.stateJson) as RunState;
  const setPending = (pendingConfirm: number | null) => state.pendingConfirm === pendingConfirm ? Promise.resolve() :
    ctx.env.DB.prepare('UPDATE ai_runs SET state_json = ? WHERE tenant_id = ? AND id = ?').bind(JSON.stringify({ ...state, pendingConfirm }), ctx.tenantId, id).run().then(() => undefined);

  const decide = async (option: number): Promise<AnswerResult> => {
    await setPending(null);
    if (turn.answered) return { kind: 'unclear', spoken: ALREADY_ANSWERED };
    const chosen = situation.options[option];
    const reaction: Reaction = { spoken: stored.reactions[option], quality: chosen.quality, sources: chosen.sources };
    const updated = await ctx.env.DB.prepare('UPDATE ai_turns SET answered = 1, chosen = ?, reaction_json = ? WHERE tenant_id = ? AND run_id = ? AND idx = ? AND answered = 0')
      .bind(option, JSON.stringify(reaction), ctx.tenantId, id, idx).run();
    if (!updated.meta.changes) return { kind: 'unclear', spoken: ALREADY_ANSWERED };
    // Última situación: el resumen se prepara mientras VictorIA dice la reacción.
    if (idx + 1 >= Number(row.total)) inBackground(ctx.waitUntil, () => ensureSummary(ctx, id));
    return { kind: 'decision', optionIndex: option, reaction };
  };
  const skip = async (): Promise<AnswerResult> => {
    await setPending(null);
    if (!turn.answered) {
      await ctx.env.DB.prepare('UPDATE ai_turns SET answered = 1, chosen = NULL, reaction_json = NULL WHERE tenant_id = ? AND run_id = ? AND idx = ? AND answered = 0')
        .bind(ctx.tenantId, id, idx).run();
      if (idx + 1 >= Number(row.total)) inBackground(ctx.waitUntil, () => ensureSummary(ctx, id));
    }
    return { kind: 'next' };
  };
  const confirm = async (option: number): Promise<AnswerResult> => {
    await setPending(option);
    return { kind: 'confirm', optionIndex: option, prompt: `¿Te refieres a «${situation.options[option].label}»?` };
  };
  const ask = async (question: string): Promise<AnswerResult> => {
    const chunks = await search(ctx.env, ctx.tenantId, row.collectionId, question, EXCERPTS_PER_ANSWER, ctx.requestId);
    const excerpts = excerptsFrom(chunks, 'R');
    if (!excerpts.length) return { kind: 'answer', spoken: UNKNOWN_ANSWER, sources: [] };
    const generated = await generateJson(ctx.env, answerPrompt(excerpts, question, situation.title), ANSWER_SCHEMA, ANSWER_MAX_TOKENS,
      value => validateAnswer(value, excerpts.map(item => item.id)), ctx.requestId);
    return { kind: 'answer', spoken: generated.spoken, sources: sourcesFrom(excerpts, new Set(generated.sources)) };
  };

  if (request.optionIndex !== null) return decide(request.optionIndex);
  const phrase = request.phrase!;
  const quick = quickIntent(phrase);
  if (state.pendingConfirm !== null && quick?.kind === 'yes') return decide(state.pendingConfirm);
  if (state.pendingConfirm !== null && quick?.kind === 'no') {
    await setPending(null);
    return { kind: 'unclear', spoken: 'De acuerdo. Dime qué opción eliges o pregúntame lo que necesites.' };
  }
  if (quick?.kind === 'option') return decide(quick.option);
  if (quick?.kind === 'repeat') return { kind: 'repeat' };
  if (quick?.kind === 'next') return skip();

  const result = await runAi(ctx.env, CLEF_MODEL, liveClefRequest(situation, phrase), ctx.requestId);
  const intent = interpretLiveClef(result, situation.options.length);
  if (intent.kind === 'option') return intent.decide ? decide(intent.option) : confirm(intent.option);
  if (intent.kind === 'pregunta') return ask(phrase);
  if (intent.kind === 'repetir') return { kind: 'repeat' };
  if (intent.kind === 'siguiente') return skip();
  // Clef no está seguro, pero la frase tiene forma de pregunta: se responde con los documentos.
  if (looksLikeQuestion(phrase)) return ask(phrase);
  return { kind: 'unclear', spoken: UNCLEAR };
}

/** Borrado de partidas antiguas (retención diaria): los resultados de la demo no se conservan más de `days`. */
export async function pruneAiRuns(env: Env, days: number, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - days * 86400000).toISOString();
  const [, runs] = await env.DB.batch([
    env.DB.prepare('DELETE FROM ai_turns WHERE run_id IN (SELECT id FROM ai_runs WHERE created_at < ?)').bind(cutoff),
    env.DB.prepare('DELETE FROM ai_runs WHERE created_at < ?').bind(cutoff)
  ]);
  return runs?.meta?.changes ?? 0;
}
