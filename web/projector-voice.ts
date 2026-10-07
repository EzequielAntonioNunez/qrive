/**
 * VictorIA comenta en el proyector: frases de PLANTILLA (sin IA generativa) con los agregados reales de la clase,
 * leídas con la voz en tiempo real (Soniox, tts-stream.ts) y mostradas como subtítulo.
 *
 * - Solo datos de grupo («la clase», «un 20 %»): nunca personas. `quality` valora la opción, no a quien la elige.
 * - Sin voz (demo sin conexión, sin servicio de voz SONIOX_API_KEY, error de Soniox): solo el subtítulo. No depende
 *   del modo IA en vivo (bandera ai_live_demo). En el proyector no se
 *   usa la síntesis del navegador.
 * - El AudioContext se crea dentro de un gesto del docente (primer clic o tecla en el proyector).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Phase } from '../shared/simulation';
import { SonioxSpeaker, splitSentences, type SpeakResult, type TtsGrant } from './tts-stream';

export const VOICE_PREF_KEY = 'ufv.projector.voice';
export const MAX_WORDS = 35;

/** Acorta una etiqueta en un límite de palabra, con «…» (≤ max caracteres) y sin el punto final. */
export function shortLabel(label: string, max = 60): string {
  const clean = label.replace(/\s+/g, ' ').trim().replace(/[.;:,]+$/, '');
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.5 ? cut.slice(0, space) : cut).replace(/[\s.,;:]+$/, '')}…`;
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const pct = (count: number, total: number) => total > 0 ? Math.round((100 * count) / total) : 0;

type Facts = { p: number; best: string; q: number; other: string | null };
type Template = { lead: (f: Facts) => string; other: (f: Facts) => string };

/** Tres variantes por tono; se elige por el índice de la situación (determinista). */
const MAJORITY: Template[] = [
  { lead: f => `El ${f.p} % de la clase ha elegido «${f.best}». Bien visto: es la opción más acertada.`, other: f => `Ojo: un ${f.q} % se ha inclinado por «${f.other}».` },
  { lead: f => `Mayoría clara: un ${f.p} % ha optado por «${f.best}», la mejor decisión en esta situación.`, other: f => `Aun así, un ${f.q} % eligió «${f.other}».` },
  { lead: f => `Buena lectura de la situación: el ${f.p} % ha ido a «${f.best}».`, other: f => `Un ${f.q} % prefirió «${f.other}»; merece la pena comentar por qué.` }
];
const SPLIT: Template[] = [
  { lead: f => `La clase está dividida: un ${f.p} % ha elegido «${f.best}», que es la opción más acertada.`, other: f => `Un ${f.q} % se ha decantado por «${f.other}».` },
  { lead: f => `Resultado repartido: un ${f.p} % de la clase ha acertado con «${f.best}».`, other: f => `El ${f.q} % ha preferido «${f.other}»: buen momento para debatirlo.` },
  { lead: f => `Un ${f.p} % ha optado por «${f.best}», la mejor opción aquí.`, other: f => `Pero un ${f.q} % eligió «${f.other}»; conviene revisar el matiz.` }
];
const MINORITY: Template[] = [
  { lead: f => `Esta situación tenía trampa: un ${f.p} % ha elegido «${f.best}», que era la opción más acertada.`, other: f => `La más votada fue «${f.other}», con un ${f.q} %.` },
  { lead: f => `Situación exigente: la mejor opción era «${f.best}» y la ha elegido un ${f.p} % de la clase.`, other: f => `Un ${f.q} % se ha inclinado por «${f.other}».` },
  { lead: f => `Aquí la clase ha dudado: solo un ${f.p} % fue a «${f.best}», la decisión más sólida.`, other: f => `Un ${f.q} % eligió «${f.other}»; veamos qué riesgo tiene.` }
];
const NONE: Template[] = [
  { lead: f => `Esta situación tenía trampa: la opción más acertada era «${f.best}» y nadie la ha elegido.`, other: f => `La más votada fue «${f.other}», con un ${f.q} %.` }
];

/**
 * Comentario de la situación revelada. `null` si no hay votos o la situación no define una mejor opción.
 * ≤ 35 palabras: si se pasa, se acortan las etiquetas y, si aún se pasa, se omite la segunda frase.
 */
export function revealComment(phase: Phase, counts: number[], phaseIndex: number): string | null {
  const total = counts.reduce((sum, value) => sum + (value || 0), 0);
  if (total <= 0) return null;
  const bestIndexes = phase.options.flatMap((option, i) => option.quality === 'best' ? [i] : []);
  if (!bestIndexes.length) return null;
  const bestIndex = [...bestIndexes].sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0))[0];
  const bestCount = bestIndexes.reduce((sum, i) => sum + (counts[i] ?? 0), 0);
  const p = pct(bestCount, total);
  const others = phase.options.map((_, i) => i).filter(i => !bestIndexes.includes(i) && (counts[i] ?? 0) > 0)
    .sort((a, b) => (counts[b] ?? 0) - (counts[a] ?? 0));
  const otherIndex = others[0];
  const q = otherIndex === undefined ? 0 : pct(counts[otherIndex] ?? 0, total);
  const withOther = otherIndex !== undefined && q >= 15;
  const pool = p === 0 ? NONE : p >= 60 ? MAJORITY : p >= 40 ? SPLIT : MINORITY;
  const template = pool[Math.abs(phaseIndex) % pool.length];
  const build = (max: number, other: boolean) => {
    const facts: Facts = { p, best: shortLabel(phase.options[bestIndex].label, max), q, other: withOther ? shortLabel(phase.options[otherIndex].label, max) : null };
    return other && withOther ? `${template.lead(facts)} ${template.other(facts)}` : template.lead(facts);
  };
  for (const [max, other] of [[60, true], [48, true], [38, true], [30, true], [60, false], [42, false]] as const) {
    const text = build(max, other);
    if (words(text) <= MAX_WORDS) return text;
  }
  return build(30, false);
}

export type BenchmarkView = {
  session: { decisions: number; optimalRate: number | null };
  organization: { sessions: number; decisions: number; optimalRate: number | null };
  includeSimulated: boolean;
};

/** Frase neutra de la comparación (de grupo; nunca de personas). */
export function benchmarkSentence(sessionRate: number | null, orgRate: number | null): string {
  if (sessionRate === null) return 'Aún no hay decisiones valoradas en esta sesión para comparar.';
  if (orgRate === null) return 'Primera sesión de la organización: aún no hay media con la que comparar.';
  const diff = Math.round(sessionRate * 100) - Math.round(orgRate * 100);
  if (diff >= 5) return 'La clase queda por encima de la media de la organización.';
  if (diff <= -5) return 'La clase queda por debajo de la media: buen punto de partida para repasar las situaciones más difíciles.';
  return 'La clase está en línea con la media de la organización.';
}

/** Lo que dice VictorIA al abrir la comparación. */
export function benchmarkComment(sessionRate: number | null, orgRate: number | null): string {
  if (sessionRate === null) return benchmarkSentence(sessionRate, orgRate);
  if (orgRate === null) return `Vuestra clase ha tomado un ${Math.round(sessionRate * 100)} % de decisiones óptimas. Es la primera sesión con datos de la organización: con las próximas podréis compararla con la media.`;
  return `Vuestra clase ha tomado un ${Math.round(sessionRate * 100)} % de decisiones óptimas, frente a un ${Math.round(orgRate * 100)} % de media en la organización. ${benchmarkSentence(sessionRate, orgRate)}`;
}

function readPref(): boolean {
  try { return localStorage.getItem(VOICE_PREF_KEY) !== 'off'; } catch { return true; }
}
function writePref(on: boolean) {
  try { localStorage.setItem(VOICE_PREF_KEY, on ? 'on' : 'off'); } catch { /* sin almacenamiento: solo esta vista */ }
}

export type Caption = { id: number; text: string; kind: 'reveal' | 'benchmark' };

export type ProjectorVoice = {
  /** Hay voz en tiempo real (servicio de voz, docente, con API y sin fallo). */
  available: boolean;
  enabled: boolean;
  toggle: () => void;
  speaking: boolean;
  caption: Caption | null;
  /** Desbloquea el audio: llamar dentro de un gesto del docente. */
  unlock: () => void;
  /** Muestra el subtítulo y, con la voz activa, lo lee. `queue` espera a que acabe lo que suena. */
  say: (text: string, kind: Caption['kind'], options?: { queue?: boolean }) => void;
  /** Corta la voz (Esc, cambio de situación). */
  stop: () => void;
  dismiss: () => void;
  level: () => number;
};

/** Voz y subtítulo de VictorIA en el proyector. `fetchGrant` null → solo subtítulo. */
export function useProjectorVoice(fetchGrant: (() => Promise<TtsGrant>) | null): ProjectorVoice {
  const [enabled, setEnabled] = useState(readPref);
  const [failed, setFailed] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [caption, setCaption] = useState<Caption | null>(null);
  const speaker = useRef<SonioxSpeaker | null>(null);
  const unlocked = useRef(false);
  const counter = useRef(0);
  const chain = useRef<Promise<unknown>>(Promise.resolve());
  const available = !!fetchGrant && !failed;
  const live = useRef({ available, enabled });
  live.current = { available, enabled };
  const grantRef = useRef(fetchGrant);
  grantRef.current = fetchGrant;

  const ensureSpeaker = useCallback(() => {
    if (!speaker.current && grantRef.current) {
      speaker.current = new SonioxSpeaker(() => grantRef.current!(), message => {
        // Un fallo de una frase («Voz: …») no apaga la voz; uno de conexión o credencial, sí (solo subtítulo).
        if (!message.startsWith('Voz:')) setFailed(true);
      });
    }
    return speaker.current;
  }, []);

  const unlock = useCallback(() => {
    if (unlocked.current || !live.current.available || !live.current.enabled) return;
    const engine = ensureSpeaker();
    if (!engine) return;
    unlocked.current = true;
    void engine.unlock().catch(() => setFailed(true));
  }, [ensureSpeaker]);

  const stop = useCallback(() => {
    counter.current++;
    chain.current = Promise.resolve();
    speaker.current?.stop();
    setSpeaking(false);
  }, []);

  const say = useCallback((text: string, kind: Caption['kind'], options?: { queue?: boolean }) => {
    if (!options?.queue) stop();
    const generation = counter.current;
    const run = async () => {
      if (generation !== counter.current) return;
      const id = Date.now() + Math.random();
      setCaption({ id, text, kind });
      const { available: canSpeak, enabled: on } = live.current;
      const engine = canSpeak && on ? ensureSpeaker() : null;
      if (!engine) return;
      if (!unlocked.current) { unlocked.current = true; await engine.unlock().catch(() => undefined); }
      setSpeaking(true);
      // La credencial temporal de Soniox es de un solo uso y solo admite un stream: cada frase va por su propia
      // conexión (frase a frase, en orden). Un fallo deja el subtítulo, que ya está en pantalla.
      for (const sentence of splitSentences(text)) {
        if (generation !== counter.current || !live.current.enabled || !live.current.available) break;
        let result: SpeakResult = 'done';
        try { result = await engine.speak(sentence); } catch { /* solo subtítulo */ }
        engine.closeConnection();
        if (result === 'stopped') break;
      }
      if (generation === counter.current) setSpeaking(false);
    };
    chain.current = chain.current.then(run, run);
  }, [ensureSpeaker, stop]);

  const toggle = useCallback(() => {
    setEnabled(current => {
      const next = !current;
      writePref(next);
      if (!next) { speaker.current?.stop(); setSpeaking(false); }
      return next;
    });
  }, []);

  const dismiss = useCallback(() => { stop(); setCaption(null); }, [stop]);
  const level = useCallback(() => speaker.current?.level() ?? 0, []);

  useEffect(() => () => { speaker.current?.dispose(); speaker.current = null; unlocked.current = false; }, []);

  return { available, enabled, toggle, speaking, caption, unlock, say, stop, dismiss, level };
}
