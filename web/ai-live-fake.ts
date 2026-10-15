/**
 * Emulación del modo IA en vivo para la demo en navegador (VITE_STANDALONE=1): colecciones y documentos en
 * localStorage y una simulación enlatada de tres situaciones. No hay IA ni Soniox: la voz usa el navegador.
 */
import { shortOption, normalizeSpeech } from './voice-mobile';
import type { AiSituation, AiSummary, KnowledgeCollection, KnowledgeDocument } from './ai-live-types';
import type { DraftInput } from '../shared/ai-draft';
import type { ChoiceQuality } from '../shared/simulation';

type Store = { collections: KnowledgeCollection[]; documents: Record<string, KnowledgeDocument[]>; runs: Record<string, { collectionId: string; total: number; index: number; answers: number[]; pending: number | null; focus: string | null; done: boolean; createdAt?: string }> };
const KEY = 'axyro-ia-en-vivo-demo-v1';

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
    id: 'demo-1', title: 'Un escrito redactado con IA',
    narration: 'Un asociado junior te entrega un recurso muy bien escrito. Al revisarlo, sospechas que buena parte lo ha redactado una IA, aunque la política del despacho permite usarla si se declara y se revisa. Él no lo ha declarado. ¿Qué haces?',
    options: [
      { label: 'Hablar con él, preguntarle cómo lo ha preparado y recordarle la obligación de declararlo y revisarlo', quality: 'best', consequence: 'Explica su proceso, reconoce el olvido y revisáis juntos las citas antes de presentar el recurso.', rationale: 'La política pide transparencia y revisión humana.' },
      { label: 'Rechazar el escrito y abrirle un expediente', quality: 'poor', consequence: 'La política no prohíbe el uso declarado y no hay pruebas concluyentes. El equipo pierde confianza.', rationale: 'Respuesta desproporcionada y sin fundamento.' },
      { label: 'Pasar un detector de IA y decidir según el porcentaje', quality: 'poor', consequence: 'El detector da un 62 %. No sabes qué significa ese número y la decisión queda sin fundamento.', rationale: 'Los detectores tienen falsos positivos.' },
      { label: 'Presentar el recurso y recordar en la próxima reunión, en general, la norma de declaración', quality: 'acceptable', consequence: 'El equipo recuerda la norma, pero el escrito sale sin una revisión específica.', rationale: 'Útil, aunque insuficiente para el caso concreto.' }
    ],
    sources: [{ id: 's1', document: 'Política de uso de IA del despacho.pdf', excerpt: 'El uso de herramientas de IA generativa está permitido siempre que se declare y que un abogado revise el resultado antes de enviarlo.' }, { id: 's2', document: 'Protocolo de calidad.docx', excerpt: 'Los resultados de detectores automáticos no constituyen por sí solos prueba de un uso indebido.' }]
  },
  {
    id: 'demo-2', title: 'Datos de clientes en un chat de IA',
    narration: 'Una compañera quiere pegar en un chatbot público el expediente completo de un cliente, con nombres y datos de salud, para que le resuma los hechos. Te pide opinión. ¿Qué le dices?',
    options: [
      { label: 'Que adelante, así ahorra tiempo', quality: 'poor', consequence: 'Los datos del cliente salen a un proveedor sin contrato ni base jurídica. Es una brecha del secreto profesional y de protección de datos.', rationale: 'Secreto profesional y RGPD: no se comparten datos con servicios no autorizados.' },
      { label: 'Que anonimice los datos y use solo las herramientas autorizadas por el despacho', quality: 'best', consequence: 'Prepara un resumen sin datos identificativos con la herramienta contratada. Ahorra tiempo sin exponer al cliente.', rationale: 'Minimización de datos y herramientas con contrato.' },
      { label: 'Que lo consulte antes con el delegado de protección de datos', quality: 'acceptable', consequence: 'El DPD le orienta, aunque el resumen se retrasa varios días.', rationale: 'Prudente, pero la respuesta ya estaba en la política.' },
      { label: 'Que use solo las iniciales del cliente', quality: 'acceptable', consequence: 'Reduce el riesgo, pero las iniciales y los hechos siguen permitiendo identificar al cliente.', rationale: 'La seudonimización parcial no basta.' }
    ],
    sources: [{ id: 's3', document: 'Política de uso de IA del despacho.pdf', excerpt: 'No introduzcas datos de clientes en herramientas de IA que no hayan sido aprobadas por el despacho.' }]
  },
  {
    id: 'demo-3', title: 'Una sentencia inventada',
    narration: 'Preparando una demanda, la IA te da una sentencia del Tribunal Supremo con número y fecha que encaja perfectamente con tu argumento. No la encuentras en ninguna base de datos. El plazo vence mañana. ¿Qué haces?',
    options: [
      { label: 'Citarla igualmente: la IA suele acertar', quality: 'poor', consequence: 'La parte contraria señala que la sentencia no existe. Tu credibilidad ante el tribunal se resiente.', rationale: 'Las IA generativas pueden inventar jurisprudencia.' },
      { label: 'Descartarla y buscar jurisprudencia verificada en una base de datos oficial', quality: 'best', consequence: 'Encuentras una sentencia real con la misma doctrina. El escrito gana solidez.', rationale: 'Verificar siempre las fuentes primarias.' },
      { label: 'Citarla advirtiendo que no está verificada', quality: 'acceptable', consequence: 'Eres transparente, pero presentas un argumento dudoso.', rationale: 'Mejor no usar lo que no se puede verificar.' },
      { label: 'Pedirle a la IA que confirme que la sentencia es real', quality: 'poor', consequence: 'La IA confirma con seguridad. Sigue sin existir.', rationale: 'La IA no es una fuente de verificación.' }
    ],
    sources: [{ id: 's4', document: 'Política de uso de IA del despacho.pdf', excerpt: 'Verifica siempre la exactitud de los contenidos generados: las herramientas pueden producir citas y referencias falsas con apariencia verosímil.' }]
  }
];

const REACTIONS: Record<string, string> = {
  best: 'Muy buena decisión.',
  acceptable: 'Es una opción razonable, aunque se puede afinar.',
  poor: 'Cuidado con esta decisión.'
};

/**
 * Datos de la partida para «Convertir en escenario para sesiones» (los usa standalone.ts, que guarda los escenarios
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
  if (role !== 'instructor') return json({ error: 'Acción reservada al formador.' }, 403);
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
      return { spoken: `Hemos terminado. Has elegido la mejor opción en ${optimal} de ${run.total} situaciones. Recuerda: transparencia al usar la IA, nada de datos de clientes en herramientas no autorizadas y verificar siempre las fuentes.`, takeaways: ['Declara siempre el uso de IA y revisa lo que genera antes de enviarlo.', 'No introduzcas datos de clientes en herramientas no autorizadas.', 'Verifica la jurisprudencia: la IA puede inventarla.'], optimalCount: optimal, total: run.total };
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
