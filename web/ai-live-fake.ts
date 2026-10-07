/**
 * Emulación del modo IA en vivo para la demo en navegador (VITE_STANDALONE=1): colecciones y documentos en
 * localStorage y una simulación enlatada de tres situaciones. No hay IA ni Soniox: la voz usa el navegador.
 */
import { shortOption, normalizeSpeech } from './voice-mobile';
import type { AiSituation, AiSummary, KnowledgeCollection, KnowledgeDocument } from './ai-live-types';
import type { DraftInput } from '../shared/ai-draft';
import type { ChoiceQuality } from '../shared/simulation';

type Store = { collections: KnowledgeCollection[]; documents: Record<string, KnowledgeDocument[]>; runs: Record<string, { collectionId: string; total: number; index: number; answers: number[]; pending: number | null; focus: string | null; done: boolean; createdAt?: string }> };
const KEY = 'ufv-ia-en-vivo-demo-v1';

function load(): Store {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw) as Store; } catch { /* vacío */ }
  return { collections: [], documents: {}, runs: {} };
}
function save(store: Store) { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* sin almacenamiento */ } }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const id = (prefix: string) => `${prefix}-${crypto.getRandomValues(new Uint32Array(2)).join('').slice(0, 12)}`;
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const SITUATIONS: Omit<AiSituation, 'index'>[] = [
  {
    id: 'demo-1', title: 'Un trabajo con ayuda de la IA',
    narration: 'Una alumna te entrega un trabajo excelente. Al revisarlo, sospechas que gran parte del texto lo ha generado una IA, aunque la guía de la asignatura permite usarla si se declara. Ella no lo ha declarado. ¿Qué harías?',
    options: [
      { label: 'Hablar con ella, preguntarle cómo ha trabajado y recordarle la obligación de declararlo', quality: 'best', consequence: 'La alumna explica su proceso, reconoce el olvido y declara el uso. Aprende la norma sin sentirse acusada.', rationale: 'La guía pide transparencia y proporcionalidad.' },
      { label: 'Suspender el trabajo directamente por plagio', quality: 'poor', consequence: 'La alumna recurre: la guía no considera plagio el uso declarado y no hay pruebas concluyentes.', rationale: 'Los detectores no son prueba suficiente.' },
      { label: 'Pasar un detector de IA y decidir según el porcentaje', quality: 'poor', consequence: 'El detector da un 62 %. No sabes qué significa ese número y la decisión queda sin fundamento.', rationale: 'Los detectores tienen falsos positivos.' },
      { label: 'Aceptar el trabajo y comentar en clase, en general, la norma de declaración', quality: 'acceptable', consequence: 'El grupo recuerda la norma, pero la alumna no recibe una respuesta a su caso.', rationale: 'Útil, aunque insuficiente para el caso concreto.' }
    ],
    sources: [{ id: 's1', document: 'Guía de uso de IA en la docencia.pdf', excerpt: 'El uso de herramientas de IA generativa está permitido siempre que el estudiante declare qué herramienta ha usado y para qué.' }, { id: 's2', document: 'Normativa de evaluación.docx', excerpt: 'Los resultados de detectores automáticos no constituyen por sí solos prueba de fraude académico.' }]
  },
  {
    id: 'demo-2', title: 'Datos personales en un chat de IA',
    narration: 'Un compañero del departamento quiere pegar en un chatbot público las notas y los comentarios de sus estudiantes, con nombres y apellidos, para que le redacte los informes de evaluación. Te pide opinión. ¿Qué le dices?',
    options: [
      { label: 'Que adelante, así ahorra tiempo', quality: 'poor', consequence: 'Los datos personales salen a un proveedor sin contrato ni base jurídica. Es un incidente de protección de datos.', rationale: 'RGPD: no se comparten datos personales con servicios no autorizados.' },
      { label: 'Que anonimice los datos y use solo las herramientas autorizadas por la universidad', quality: 'best', consequence: 'Prepara plantillas sin nombres y usa la herramienta institucional. Ahorra tiempo sin exponer a nadie.', rationale: 'Minimización de datos y herramientas con contrato.' },
      { label: 'Que lo consulte antes con el delegado de protección de datos', quality: 'acceptable', consequence: 'El DPO le orienta, aunque el informe se retrasa una semana.', rationale: 'Prudente, pero la respuesta ya estaba en la guía.' },
      { label: 'Que use solo las iniciales de cada estudiante', quality: 'acceptable', consequence: 'Reduce el riesgo, pero las iniciales y las notas siguen permitiendo identificar a algunos estudiantes.', rationale: 'La seudonimización parcial no basta.' }
    ],
    sources: [{ id: 's3', document: 'Guía de uso de IA en la docencia.pdf', excerpt: 'No introduzcas datos personales de estudiantes en herramientas de IA que no hayan sido aprobadas por la universidad.' }]
  },
  {
    id: 'demo-3', title: 'Una respuesta inventada',
    narration: 'Preparando una clase, la IA te da una cita textual de un autor con su referencia completa. Suena perfecta, pero no encuentras la obra en la biblioteca. La clase es mañana. ¿Qué haces?',
    options: [
      { label: 'Usarla igualmente: la IA suele acertar', quality: 'poor', consequence: 'Un estudiante busca la cita y no existe. Tu credibilidad se resiente.', rationale: 'Las IA generativas pueden inventar referencias.' },
      { label: 'Descartar la cita y buscar una fuente verificada', quality: 'best', consequence: 'Encuentras una cita real del mismo autor. La clase gana rigor.', rationale: 'Verificar siempre las fuentes primarias.' },
      { label: 'Usarla advirtiendo que no está verificada', quality: 'acceptable', consequence: 'Eres transparente, pero transmites un contenido dudoso.', rationale: 'Mejor no usar lo que no se puede verificar.' },
      { label: 'Pedirle a la IA que confirme que la cita es real', quality: 'poor', consequence: 'La IA confirma con seguridad. Sigue siendo falsa.', rationale: 'La IA no es una fuente de verificación.' }
    ],
    sources: [{ id: 's4', document: 'Guía de uso de IA en la docencia.pdf', excerpt: 'Verifica siempre la exactitud de los contenidos generados: las herramientas pueden producir información falsa con apariencia verosímil.' }]
  }
];

const REACTIONS: Record<string, string> = {
  best: 'Muy buena decisión.',
  acceptable: 'Es una opción razonable, aunque se puede afinar.',
  poor: 'Cuidado con esta decisión.'
};

/**
 * Datos de la partida para «Convertir en escenario para clase» (los usa standalone.ts, que guarda los escenarios
 * publicados): solo las situaciones ya mostradas, como el Worker, que usa solo las generadas.
 */
export function fakeDraftInput(runId: string): DraftInput | null {
  const store = load();
  const run = store.runs[runId];
  if (!run) return null;
  const generated = run.done ? run.total : Math.max(0, Math.min(run.total, run.index + 1));
  return {
    runId, collectionId: run.collectionId, collectionName: store.collections.find(item => item.id === run.collectionId)?.name ?? 'Colección',
    focus: run.focus, total: run.total,
    situations: SITUATIONS.slice(0, generated).map(item => ({
      title: item.title, narration: item.narration, sources: item.sources.map(source => ({ document: source.document })),
      options: item.options.map(option => ({ label: option.label, quality: (option.quality ?? 'acceptable') as ChoiceQuality, consequence: option.consequence ?? '', rationale: option.rationale ?? '' }))
    }))
  };
}

export async function handleAiLive(path: string, init: RequestInit | undefined, role: 'instructor' | 'participant'): Promise<Response | null> {
  const isOurs = path.startsWith('/knowledge') || path.startsWith('/ai-runs') || path === '/voice/tts-key';
  if (!isOurs) return null;
  // Borrador y publicación los atiende standalone.ts (allí viven los escenarios publicados).
  if (/^\/ai-runs\/[^/]+\/(draft|publish)$/.test(path)) return null;
  if (role !== 'instructor') return json({ error: 'Acción reservada al docente.' }, 403);
  if (path === '/voice/tts-key') return json({ error: 'La voz en tiempo real no está disponible en la demo sin conexión.' }, 503);
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const store = load();

  if (path === '/knowledge/collections') {
    if (method === 'POST') {
      const name = String(body.name ?? '').trim().slice(0, 80);
      if (!name) return json({ error: 'Pon un nombre a la colección.' }, 400);
      const collection: KnowledgeCollection = { id: id('col'), name, documentCount: 0, chunkCount: 0, createdAt: new Date().toISOString() };
      store.collections.unshift(collection); store.documents[collection.id] = []; save(store);
      return json({ collection }, 201);
    }
    return json({ collections: store.collections });
  }
  const collectionMatch = path.match(/^\/knowledge\/collections\/([^/]+)(\/documents)?$/);
  if (collectionMatch) {
    const collectionId = decodeURIComponent(collectionMatch[1]);
    const collection = store.collections.find(item => item.id === collectionId);
    if (!collection) return json({ error: 'Colección no encontrada.' }, 404);
    if (!collectionMatch[2] && method === 'DELETE') {
      store.collections = store.collections.filter(item => item.id !== collectionId); delete store.documents[collectionId]; save(store);
      return json({ deleted: true });
    }
    if (collectionMatch[2] && method === 'POST') {
      await wait(900);
      const name = String(body.name ?? 'Documento').slice(0, 120);
      let chars = 0; let status: KnowledgeDocument['status'] = 'ready'; let error: string | null = null; let bytes = 0;
      if (typeof body.text === 'string') { chars = body.text.trim().length; bytes = new Blob([body.text]).size; }
      else if (typeof body.dataBase64 === 'string') {
        bytes = Math.floor(body.dataBase64.length * 3 / 4);
        chars = /text|markdown/.test(String(body.mime)) ? (() => { try { return new TextDecoder().decode(Uint8Array.from(atob(body.dataBase64), c => c.charCodeAt(0))).trim().length; } catch { return 0; } })() : Math.round(bytes * 0.35);
      }
      if (chars < 20) { status = 'error'; error = 'No se ha podido extraer texto suficiente del documento.'; }
      const document: KnowledgeDocument = { id: id('doc'), name, mime: String(body.mime ?? 'text/plain'), bytes, chars, status, error, createdAt: new Date().toISOString() };
      store.documents[collectionId] = [document, ...(store.documents[collectionId] ?? [])];
      collection.documentCount = store.documents[collectionId].length;
      collection.chunkCount = store.documents[collectionId].reduce((sum, item) => sum + (item.status === 'ready' ? Math.ceil(item.chars / 1200) : 0), 0);
      save(store);
      return json({ document }, 201);
    }
    if (collectionMatch[2]) return json({ documents: store.documents[collectionId] ?? [] });
  }
  const documentMatch = path.match(/^\/knowledge\/documents\/([^/]+)$/);
  if (documentMatch && method === 'DELETE') {
    const docId = decodeURIComponent(documentMatch[1]);
    for (const collection of store.collections) {
      const list = store.documents[collection.id] ?? [];
      if (list.some(item => item.id === docId)) {
        store.documents[collection.id] = list.filter(item => item.id !== docId);
        collection.documentCount = store.documents[collection.id].length;
        collection.chunkCount = store.documents[collection.id].reduce((sum, item) => sum + (item.status === 'ready' ? Math.ceil(item.chars / 1200) : 0), 0);
      }
    }
    save(store);
    return json({ deleted: true });
  }

  if (path.split('?')[0] === '/ai-runs' && method === 'GET') {
    const collectionId = new URLSearchParams(path.split('?')[1] ?? '').get('collectionId');
    const runs = Object.entries(store.runs)
      .filter(([, run]) => !collectionId || run.collectionId === collectionId)
      .map(([runId, run]) => ({
        id: runId, collectionId: run.collectionId, situationsTotal: run.total, index: run.index, status: run.done ? 'complete' : 'active', focus: run.focus,
        createdAt: run.createdAt ?? new Date(0).toISOString(), generated: run.done ? run.total : Math.max(0, run.index + 1), answered: run.answers.filter(answer => answer !== undefined && answer !== null).length
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
    return json({ runs });
  }
  if (path === '/ai-runs' && method === 'POST') {
    const collection = store.collections.find(item => item.id === body.collectionId);
    if (!collection) return json({ error: 'Colección no encontrada.' }, 404);
    const runId = id('run');
    store.runs[runId] = { collectionId: collection.id, total: SITUATIONS.length, index: -1, answers: [], pending: null, focus: typeof body.focus === 'string' && body.focus.trim() ? body.focus.trim() : null, done: false, createdAt: new Date().toISOString() };
    save(store);
    return json({ run: { id: runId, collectionId: collection.id, situationsTotal: SITUATIONS.length, index: -1, status: 'active' } }, 201);
  }
  const runMatch = path.match(/^\/ai-runs\/([^/]+)(\/next|\/answer)?$/);
  if (runMatch) {
    const runId = decodeURIComponent(runMatch[1]);
    const run = store.runs[runId];
    if (!run) return json({ error: 'Simulación no encontrada.' }, 404);
    const runInfo = { id: runId, collectionId: run.collectionId, situationsTotal: run.total, index: run.index, status: run.done ? 'complete' : 'active', focus: run.focus };
    const summary = (): AiSummary => {
      const optimal = run.answers.filter((answer, i) => SITUATIONS[i]?.options[answer]?.quality === 'best').length;
      return { spoken: `Hemos terminado. Has elegido la mejor opción en ${optimal} de ${run.total} situaciones. Recuerda: transparencia al usar la IA, nada de datos personales en herramientas no autorizadas y verificar siempre las fuentes.`, takeaways: ['Declara siempre el uso de IA y pide lo mismo a tus estudiantes.', 'No introduzcas datos personales en herramientas no autorizadas.', 'Verifica las referencias: la IA puede inventarlas.'], optimalCount: optimal, total: run.total };
    };
    if (!runMatch[2]) {
      const current = run.index >= 0 && run.index < run.total && run.answers.length <= run.index ? { ...SITUATIONS[run.index], index: run.index } : null;
      return json({ run: runInfo, current, history: [], summary: run.done ? summary() : null });
    }
    if (runMatch[2] === '/next') {
      await wait(run.index < 0 ? 2200 : 1400);
      run.index = Math.max(run.index + 1, run.answers.length);
      run.pending = null;
      if (run.index >= run.total) { run.done = true; save(store); return json({ done: true, summary: summary() }); }
      save(store);
      return json({ situation: { ...SITUATIONS[run.index], index: run.index } });
    }
    const situation = SITUATIONS[run.index];
    if (!situation) return json({ error: 'No hay ninguna situación abierta.' }, 409);
    await wait(500);
    const decide = (optionIndex: number) => {
      run.answers[run.index] = optionIndex; run.pending = null; save(store);
      const option = situation.options[optionIndex];
      return json({ kind: 'decision', optionIndex, reaction: { spoken: `${REACTIONS[option.quality ?? 'acceptable']} ${option.consequence}`, quality: option.quality, sources: situation.sources.slice(0, 1) } });
    };
    if (typeof body.optionIndex === 'number') return decide(body.optionIndex);
    const phrase = String(body.phrase ?? '');
    const text = normalizeSpeech(phrase);
    if (run.pending != null) {
      if (/^(si|vale|correcto|exacto|eso|confirmo|claro)\b/.test(text)) return decide(run.pending);
      if (/^no\b/.test(text)) { run.pending = null; save(store); return json({ kind: 'unclear', spoken: 'De acuerdo. Dime qué harías tú.' }); }
    }
    const direct = shortOption(phrase, situation.options.length);
    if (direct !== null) return decide(direct);
    if (/\b(repite|repetir|otra vez|no te he oido)\b/.test(text)) return json({ kind: 'repeat' });
    if (/\b(siguiente|saltar|salta|pasa)\b/.test(text)) return json({ kind: 'next' });
    if (/^(que|como|por que|cual|cuando|donde|quien)\b/.test(text) || phrase.trim().endsWith('?')) return json({ kind: 'answer', spoken: `Según tus documentos: ${situation.sources[0].excerpt}`, sources: situation.sources });
    const words = text.split(' ').filter(word => word.length > 3);
    let best = -1; let bestScore = 0;
    situation.options.forEach((option, i) => { const label = normalizeSpeech(option.label); const score = words.filter(word => label.includes(word)).length; if (score > bestScore) { best = i; bestScore = score; } });
    if (best >= 0) { run.pending = best; save(store); return json({ kind: 'confirm', optionIndex: best, prompt: `¿Te refieres a la opción ${String.fromCharCode(65 + best)}: ${situation.options[best].label}?` }); }
    return json({ kind: 'unclear', spoken: 'No te he entendido bien. Dime qué harías con tus palabras o di la letra de la opción.' });
  }
  return json({ error: 'Ruta no encontrada.' }, 404);
}
