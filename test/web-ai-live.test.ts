import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../unity/AXYRO.Simulation/Assets/WebGLTemplates/UFV/ai-live.js', import.meta.url), 'utf8');

type Call = { method: string; value: string };
type Request = { url: string; method: string; body: unknown };

/** Voz falsa: cada locución queda pendiente hasta que se termina (finish) o se corta (stop). */
function fakeSpeaker() {
  const speaker = {
    said: [] as string[],
    stops: 0,
    pending: null as null | ((result: string) => void),
    auto: true,
    unlock: async () => undefined,
    speak(text: string) {
      // Como SonioxSpeaker: una locución nueva corta la anterior.
      const previous = speaker.pending; speaker.pending = null; previous?.('stopped');
      speaker.said.push(text);
      if (speaker.auto) return Promise.resolve('done');
      return new Promise<string>(resolve => { speaker.pending = resolve; });
    },
    finish() { const done = speaker.pending; speaker.pending = null; done?.('done'); },
    stop() { speaker.stops++; const done = speaker.pending; speaker.pending = null; done?.('stopped'); },
    speaking: () => speaker.pending !== null,
    level: () => 0.5,
    viseme: () => 0,
    progress: () => null,
    dispose: () => undefined
  };
  return speaker;
}

function setup(routes: Record<string, unknown[]>) {
  const window = {} as { axyroAiLive?: any };
  const requests: Request[] = [];
  const fetch = async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    requests.push({ url, method, body: init.body ? JSON.parse(String(init.body)) : null });
    const queue = routes[`${method} ${url}`];
    const reply = queue?.length ? queue.shift() : undefined;
    if (reply === undefined) return new Response(JSON.stringify({ error: 'No encontrado.' }), { status: 404 });
    if (reply instanceof Response) return reply;
    return new Response(JSON.stringify(reply), { status: 200 });
  };
  runInNewContext(source, { window, fetch, location: { href: 'https://axyro.test/simulador/?ia=run-12345678' }, URL, setTimeout, clearTimeout, performance, navigator: {}, Promise });
  const live = window.axyroAiLive!;
  const calls: Call[] = [];
  const speaker = fakeSpeaker();
  live.createSpeaker = () => speaker;
  live.wait = () => Promise.resolve();
  const unity = { SendMessage: (_target: string, method: string, value: string) => calls.push({ method, value }) };
  return { live, calls, requests, speaker, unity };
}

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
const situation = (index: number) => ({
  id: `s${index}`, index, title: `Situación ${index + 1}`, narration: `Narración ${index + 1}. ¿Qué harías?`,
  options: [{ label: 'Opción uno', quality: 'poor', consequence: 'Mal.' }, { label: 'Opción dos', quality: 'best', consequence: 'Bien.' }],
  sources: [{ id: 'c1', document: 'Guía docente.pdf', excerpt: '…' }, { id: 'c2', document: 'Guía docente.pdf', excerpt: '…' }]
});
const RUN = { run: { id: 'run-12345678', collectionId: 'col-1', situationsTotal: 2, index: 0, status: 'active' }, current: null, summary: null };
const of = (calls: Call[], method: string) => calls.filter(call => call.method === method).map(call => call.value);
const states = (calls: Call[]) => of(calls, 'AiState').map(value => JSON.parse(value).phase);

describe('Modo IA en 3D (ai-live.js): utilidades', () => {
  it('reconoce órdenes cortas, eco e interrupciones como la consola', () => {
    const { live } = setup({});
    const h = live.helpers;
    expect(h.shortOption('la dos', 4)).toBe(1);
    expect(h.shortOption('Opción B', 4)).toBe(1);
    expect(h.shortOption('cuarta', 2)).toBeNull();
    expect(h.shortOption('primero quitaría los datos personales del documento', 4)).toBeNull();
    expect(h.looksLikeEcho('tengo las notas de todos los alumnos', 'Tengo las notas de todos los alumnos en una hoja')).toBe(true);
    expect(h.looksLikeEcho('sí', 'sí, claro')).toBe(false);
    expect(h.isBargeIn('espera un momento', 'Tengo las notas de todos los alumnos')).toBe(true);
    expect(h.isBargeIn('notas', 'Tengo las notas de todos los alumnos')).toBe(false);
    expect(h.splitSentences('Hola. Esto es una frase bastante larga para que no se una con la anterior. Fin.')).toHaveLength(1);
  });

  it('aproxima el visema por el espectro: silencio en reposo, grave en U y agudo en I', () => {
    const { live } = setup({});
    const bins = (peakHz: number) => { const out = new Uint8Array(512); const bin = Math.round(peakHz / (48000 / 1024)); for (let i = bin - 2; i <= bin + 2; i++) out[i] = 220; return out; };
    expect(live.helpers.visemeFromSpectrum(new Uint8Array(512), 48000, 1024)).toBe(5);
    expect(live.helpers.visemeFromSpectrum(bins(400), 48000, 1024)).toBe(2);
    expect(live.helpers.visemeFromSpectrum(bins(1100), 48000, 1024)).toBe(0);
    expect(live.helpers.visemeFromSpectrum(bins(2600), 48000, 1024)).toBe(1);
  });
});

describe('Modo IA en 3D (ai-live.js): conversación', () => {
  it('narra la situación, muestra las opciones al terminar y decide con la tarjeta de Unity hasta el resumen', async () => {
    const summary = { spoken: 'Buen trabajo.', takeaways: ['Contrasta las fuentes.'], optimalCount: 1, total: 1 };
    const { live, calls, requests, speaker, unity } = setup({
      'GET /api/voice/config': [{ enabled: false }],
      'GET /api/ai-runs/run-12345678': [RUN],
      'POST /api/ai-runs/run-12345678/next': [{ situation: situation(0) }, { done: true, summary }],
      'POST /api/ai-runs/run-12345678/answer': [{ kind: 'decision', optionIndex: 1, reaction: { spoken: 'Muy bien visto.', quality: 'best' } }]
    });
    await live.attach(unity, 'run-12345678');
    expect(live.phase).toBe('intro');
    await live.begin(false);
    const sent = JSON.parse(of(calls, 'AiSituation')[0]);
    expect(sent).toEqual({ index: 0, total: 2, title: 'Situación 1', narration: 'Narración 1. ¿Qué harías?', options: ['Opción uno', 'Opción dos'], sources: ['Guía docente.pdf'] });
    expect(speaker.said).toEqual(['Narración 1. ¿Qué harías?']);
    expect(states(calls).slice(-2)).toEqual(['speaking', 'listening']);
    expect(of(calls, 'AiSpeaking')).toEqual(['1', '0']);

    live.command('choose:1');
    await flush(); await flush(); await flush();
    expect(requests.find(request => request.url.endsWith('/answer'))?.body).toEqual({ optionIndex: 1 });
    expect(JSON.parse(of(calls, 'AiReaction')[0])).toEqual({ optionIndex: 1, quality: 'best', label: 'Opción dos', consequence: 'Bien.' });
    expect(of(calls, 'AiSpeaking')).toContain('2');
    expect(JSON.parse(of(calls, 'AiSummary')[0])).toEqual({ optimalCount: 1, total: 1, takeaways: ['Contrasta las fuentes.'] });
    expect(live.phase).toBe('summary');
    expect(speaker.said.at(-1)).toBe('Buen trabajo.');
    // Ninguna petición lleva claves ni sale del propio origen.
    expect(requests.every(request => request.url.startsWith('/api/'))).toBe(true);
  });

  it('confirma con «¿Te refieres a…?» y decide al oír «sí»; las órdenes fuera de turno se ignoran', async () => {
    const { live, calls, requests, unity } = setup({
      'GET /api/ai-runs/run-12345678': [{ ...RUN, current: situation(0) }],
      'POST /api/ai-runs/run-12345678/answer': [
        { kind: 'confirm', optionIndex: 0, prompt: '¿Te refieres a la opción uno?' },
        { kind: 'decision', optionIndex: 0, reaction: { spoken: 'Cuidado con los datos.', quality: 'poor' } }
      ],
      'POST /api/ai-runs/run-12345678/next': [{ situation: situation(1) }]
    });
    await live.attach(unity, 'run-12345678');
    live.command('choose:0');
    expect(requests.some(request => request.url.endsWith('/answer'))).toBe(false);
    await live.begin(false);
    live.handlePhrase('Yo pegaría la hoja tal cual en el chat');
    await flush(); await flush();
    expect(requests.find(request => request.url.endsWith('/answer'))?.body).toEqual({ phrase: 'Yo pegaría la hoja tal cual en el chat' });
    expect(live.phase).toBe('confirm');
    expect(JSON.parse(of(calls, 'AiState').at(-1)!)).toMatchObject({ phase: 'confirm', pending: 0 });
    live.handlePhrase('Sí');
    await flush(); await flush(); await flush();
    expect(requests.filter(request => request.url.endsWith('/answer')).at(-1)?.body).toEqual({ optionIndex: 0 });
    expect(JSON.parse(of(calls, 'AiReaction')[0])).toMatchObject({ optionIndex: 0, quality: 'poor' });
    expect(JSON.parse(of(calls, 'AiSituation').at(-1)!).index).toBe(1);
  });

  it('la interrupción por voz corta a VictorIA y cierra la boca; una locución sustituida no la cierra', async () => {
    const { live, calls, speaker, unity } = setup({ 'GET /api/ai-runs/run-12345678': [{ ...RUN, current: situation(0) }] });
    await live.attach(unity, 'run-12345678');
    speaker.auto = false;
    const narrating = live.begin(false);
    await flush(); await flush();
    expect(speaker.speaking()).toBe(true);
    // Otra locución sustituye a la anterior: la boca sigue abierta (no se envía «0» de la primera).
    const before = of(calls, 'AiSpeaking').length;
    const answer = live.say('Te lo explico.');
    expect(of(calls, 'AiSpeaking').slice(before)).toEqual(['1']);
    await flush();
    // Eco de lo que dice VictorIA: no interrumpe. Palabras propias: sí.
    live.onPartial('te lo explico');
    expect(speaker.speaking()).toBe(true);
    live.onPartial('espera una cosa');
    expect(speaker.speaking()).toBe(false);
    await answer; await narrating;
    expect(of(calls, 'AiSpeaking').at(-1)).toBe('0');
    expect(of(calls, 'AiLip').at(-1)).toBe('0,5');
  });

  it('sin acceso a la partida muestra el error en Unity y en la página', async () => {
    const { live, calls, unity } = setup({ 'GET /api/ai-runs/run-12345678': [new Response(JSON.stringify({ error: 'El modo IA en vivo está reservado al instructor.' }), { status: 403 })] });
    await live.attach(unity, 'run-12345678');
    expect(live.phase).toBe('error');
    expect(of(calls, 'AiError')[0]).toContain('reservado al docente');
    const bad = setup({});
    await bad.live.attach(bad.unity, '../otra');
    expect(bad.live.phase).toBe('error');
  });
});
