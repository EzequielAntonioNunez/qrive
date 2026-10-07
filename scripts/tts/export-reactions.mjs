// Guion de las reacciones de VictorIA tras cada decisión, derivado de los escenarios de catálogo
// (shared/simulation.ts) sin modificarlos: una entrada breve según la valoración de la DECISIÓN
// (nunca de la persona) + la consecuencia de la opción + la primera frase de la explicación si cabe.
// Solo se incluyen las fases con locución de situación (Assets/AXYRO/Audio/<idDeFase>.wav) y cuyo
// personaje es VictorIA: en la negociación el personaje es el propio proveedor y la consecuencia
// está narrada en tercera persona.
//
// Uso: node scripts/tts/export-reactions.mjs            → scripts/tts/reactions.json
// Cada entrada: { file: "<idFase>__<idOpcion>", quality, text (subtítulo), speech (texto enviado al TTS) }.
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { catalogScenarios } from '../../shared/simulation.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const unityAudio = path.join(root, 'unity/AXYRO.Simulation/Assets/AXYRO/Audio');

// Entradas por valoración de la decisión. Se alternan en orden fijo para que no suene repetitivo.
const openers = {
  best: ['Buena decisión.', 'Bien visto.', 'Muy bien planteado.'],
  acceptable: ['Es un paso, pero se puede hacer mejor.', 'Es una opción prudente, aunque tiene un coste.', 'No es un error, pero había una opción mejor.'],
  poor: ['Cuidado.', 'Ojo con esta decisión.', 'Esta decisión tiene riesgos.']
};
// Límite para que la reacción sea breve (unos 15 segundos de locución como máximo).
const MAX_CHARS = 230;

// Solo para la locución: siglas que el TTS leería letra a letra.
const spoken = [[/\bel RGPD\b/g, 'el reglamento de protección de datos'], [/\bRGPD\b/g, 'reglamento de protección de datos']];
const toSpeech = text => spoken.reduce((value, [pattern, replacement]) => value.replace(pattern, replacement), text);

function firstSentence(text) {
  const match = /^.+?[.!?](?=\s|$)/.exec(text ?? '');
  return match ? match[0] : '';
}

// La explicación solo se añade si aporta algo: si repite palabras de la consecuencia o de la entrada, se omite.
function repeats(sentence, before) {
  const words = text => (text.toLowerCase().match(/[\p{L}]{5,}/gu) ?? []);
  const seen = new Set(words(before));
  const list = words(sentence);
  return list.length === 0 || list.filter(word => seen.has(word)).length / list.length >= 0.3;
}

const used = { best: 0, acceptable: 0, poor: 0 };
const reactions = [];
const skipped = [];
for (const scenario of catalogScenarios) {
  for (const phase of scenario.phases) {
    const voiced = existsSync(path.join(unityAudio, `${phase.id}.wav`));
    if (!voiced || scenario.character.name !== 'VictorIA') {
      skipped.push(`${scenario.id}/${phase.id}`);
      continue;
    }
    for (const option of phase.options) {
      const quality = option.quality ?? 'acceptable';
      const opener = openers[quality][used[quality]++ % openers[quality].length];
      let text = `${opener} ${option.consequence}`;
      const why = firstSentence(option.rationale);
      if (why && !repeats(why, text) && text.length + why.length + 1 <= MAX_CHARS) text += ` ${why}`;
      reactions.push({
        file: `${phase.id}__${option.id}`, scenario: scenario.id, phaseId: phase.id, phaseTitle: phase.title, optionId: option.id,
        label: option.label, consequence: option.consequence, rationale: option.rationale ?? '', quality, text, speech: toSpeech(text)
      });
    }
  }
}
const target = path.join(root, 'scripts/tts/reactions.json');
writeFileSync(target, JSON.stringify(reactions, null, 2) + '\n');
console.log(`${reactions.length} reacciones en ${path.relative(root, target)}`);

// Copia para Unity (Resources/Reacciones/reacciones.json): subtítulo de cada reacción y opciones de la demo
// sin sesión. JsonUtility no lee arrays en la raíz, por eso va envuelto en { items }.
const unityFolder = path.join(unityAudio, 'Reacciones/Resources/Reacciones');
mkdirSync(unityFolder, { recursive: true });
const unityItems = reactions.map(({ file, phaseId, phaseTitle, optionId, label, consequence, rationale, quality, text }) =>
  ({ file, phaseId, phaseTitle, optionId, label, consequence, rationale, quality, text }));
const unityJson = path.join(unityFolder, 'reacciones.json');
writeFileSync(unityJson, JSON.stringify({ items: unityItems }, null, 2) + '\n');
if (!existsSync(`${unityJson}.meta`)) {
  writeFileSync(`${unityJson}.meta`, `fileFormatVersion: 2\nguid: ${randomBytes(16).toString('hex')}\nTextScriptImporter:\n  externalObjects: {}\n  userData: \n  assetBundleName: \n  assetBundleVariant: \n`);
}
console.log(`Catálogo de Unity en ${path.relative(root, unityJson)}`);
if (skipped.length) console.log(`Sin reacción (sin locución o sin VictorIA): ${skipped.join(', ')}`);
