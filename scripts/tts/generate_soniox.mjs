/**
 * Genera las locuciones del guion de AXYRO con la voz española Carmen de Soniox.
 * Solo envía frases públicas del escenario; nunca voz ni datos de participantes.
 *
 * Uso:
 *   SONIOX_API_KEY=... node scripts/tts/generate_soniox.mjs --phase datos-personales
 *   SONIOX_API_KEY=... node scripts/tts/generate_soniox.mjs --all --install
 *
 * Sin --install se escribe en .local-state/tts/soniox-preview. Con --install se
 * actualizan los WAV de Unity conservando sus ficheros .meta y GUID.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const install = args.includes('--install');
const reuse = args.includes('--reuse');
const all = args.includes('--all');
const phaseFlag = args.indexOf('--phase');
const phaseId = phaseFlag >= 0 ? args[phaseFlag + 1] : undefined;
if ((!all && !phaseId) || (all && phaseId) || (phaseFlag >= 0 && !phaseId)) {
  console.error('Indica --phase <id> para una muestra o --all [--install] para todas las locuciones.');
  process.exit(2);
}
if (!reuse && !process.env.SONIOX_API_KEY) {
  console.error('Falta SONIOX_API_KEY en el entorno.');
  process.exit(2);
}

const source = await readFile(path.join(root, 'shared/simulation.ts'), 'utf8');
// En este catálogo, las fases tienen `id` y `characterLine` al mismo nivel de indentación.
// El patrón queda deliberadamente limitado a ese formato para no tomar IDs de opciones.
const lines = [...source.matchAll(/^      id: '([^']+)',[\s\S]*?^      characterLine: '([^']+)',/gm)]
  .map(([, id, text]) => ({ id, text }));
const selected = all ? lines : lines.filter(line => line.id === phaseId);
if (selected.length === 0) {
  console.error(`No existe la fase «${phaseId}».`);
  process.exit(2);
}
if (new Set(lines.map(line => line.id)).size !== lines.length) {
  console.error('Hay IDs de fase duplicados en los escenarios.');
  process.exit(2);
}

const out = path.join(root, '.local-state/tts/soniox-preview');
await mkdir(out, { recursive: true });

function standardWav(input) {
  // Soniox emite un WAV de streaming con RIFF y data de tamaño 0xffffffff.
  // Unity AudioImporter necesita las longitudes reales en una cabecera PCM estándar.
  let format;
  let audio;
  for (let at = 12; at + 8 <= input.length;) {
    const id = input.toString('ascii', at, at + 4);
    const length = input.readUInt32LE(at + 4);
    const start = at + 8;
    const end = length === 0xffffffff ? input.length : start + length;
    if (end > input.length) throw new Error('WAV truncado.');
    if (id === 'fmt ') format = input.subarray(start, end);
    if (id === 'data') { audio = input.subarray(start, end); break; }
    at = end + (length % 2);
  }
  if (!format || !audio || format.length < 16 || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) {
    throw new Error('Soniox no devolvió PCM de 16 bits.');
  }
  const wav = Buffer.alloc(44 + audio.length);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  format.copy(wav, 20, 0, 16);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(audio.length, 40);
  audio.copy(wav, 44);
  return wav;
}

for (const line of selected) {
  let audio;
  if (reuse) {
    audio = await readFile(path.join(out, `${line.id}.wav`));
  } else {
    const response = await fetch('https://tts-rt.soniox.com/tts', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${process.env.SONIOX_API_KEY}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({
        model: 'tts-rt-v2',
        language: 'es',
        voice: 'Carmen',
        audio_format: 'wav',
        sample_rate: 48000,
        speed: 1.0,
        text: line.text,
        client_reference_id: `axyro-script-${line.id}`
      }),
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) {
      console.error(`Soniox rechazó ${line.id}: HTTP ${response.status}`);
      process.exit(1);
    }
    audio = Buffer.from(await response.arrayBuffer());
  }
  if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`WAV inválido: ${line.id}`);
  audio = standardWav(audio);
  const destination = path.join(out, `${line.id}.wav`);
  await writeFile(destination, audio);
  console.log(`${line.id}: ${(audio.length / 1024).toFixed(1)} KiB`);
}
if (install) {
  const unityAudio = path.join(root, 'unity/AXYRO.Simulation/Assets/AXYRO/Audio');
  for (const line of selected) await copyFile(path.join(out, `${line.id}.wav`), path.join(unityAudio, `${line.id}.wav`));
  console.log(`Instaladas ${selected.length} locuciones en Unity.`);
}
console.log(`Voz Carmen: ${selected.length} locución(es) generada(s) en ${out}`);
