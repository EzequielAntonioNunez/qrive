/**
 * Genera las reacciones de VictorIA tras cada decisión (scripts/tts/reactions.json, creado con
 * export-reactions.mjs) con la misma voz y ajustes que las locuciones de situación: Soniox TTS RT v2,
 * voz española Carmen, WAV PCM 16 bits a 48 kHz. Solo se envía a Soniox texto público del escenario.
 *
 * Uso:
 *   node scripts/tts/export-reactions.mjs
 *   SONIOX_API_KEY=... node scripts/tts/generate_reactions.mjs [--only <file,...>] [--install] [--reuse]
 *
 * Sin --install se escribe en .local-state/tts/reacciones. Con --install se copian:
 *   - a Unity: Assets/AXYRO/Audio/Reacciones/Resources/Reacciones/<idFase>__<idOpcion>.wav
 *     (Resources.Load<AudioClip>("Reacciones/<idFase>__<idOpcion>"); .meta con Decompress On Load en WebGL);
 *   - a la vista móvil: web/public/voz/reacciones/<idFase>__<idOpcion>.mp3 (versión comprimida).
 * --reuse no llama a Soniox y reutiliza los ficheros ya descargados.
 * Cada clip se ajusta en ganancia a la sonoridad media (RMS) de las locuciones de situación.
 */
import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const args = process.argv.slice(2);
const install = args.includes('--install');
const reuse = args.includes('--reuse');
const onlyFlag = args.indexOf('--only');
const only = onlyFlag >= 0 ? new Set((args[onlyFlag + 1] ?? '').split(',').filter(Boolean)) : null;
if (!reuse && !process.env.SONIOX_API_KEY) {
  console.error('Falta SONIOX_API_KEY en el entorno.');
  process.exit(2);
}

const reactions = JSON.parse(await readFile(path.join(root, 'scripts/tts/reactions.json'), 'utf8'))
  .filter(item => !only || only.has(item.file));
if (!reactions.length) {
  console.error('No hay reacciones que generar (ejecuta antes export-reactions.mjs).');
  process.exit(2);
}

const unityAudio = path.join(root, 'unity/AXYRO.Simulation/Assets/AXYRO/Audio');
const unityTarget = path.join(unityAudio, 'Reacciones/Resources/Reacciones');
const webTarget = path.join(root, 'web/public/voz/reacciones');
const out = path.join(root, '.local-state/tts/reacciones');
await mkdir(out, { recursive: true });

function standardWav(input) {
  // Soniox emite un WAV de streaming con RIFF y data de tamaño 0xffffffff; Unity necesita las longitudes reales.
  let format;
  let audio;
  for (let at = 12; at + 8 <= input.length;) {
    const id = input.toString('ascii', at, at + 4);
    const length = input.readUInt32LE(at + 4);
    const start = at + 8;
    const end = length === 0xffffffff ? input.length : Math.min(input.length, start + length);
    if (id === 'fmt ') format = input.subarray(start, end);
    if (id === 'data') { audio = input.subarray(start, end - ((end - start) % 2)); break; }
    at = end + (length % 2);
  }
  if (!format || !audio || format.length < 16 || format.readUInt16LE(0) !== 1 || format.readUInt16LE(14) !== 16) {
    throw new Error('Soniox no devolvió PCM de 16 bits.');
  }
  return { channels: format.readUInt16LE(2), sampleRate: format.readUInt32LE(4), pcm: Buffer.from(audio) };
}

function encodeWav({ channels, sampleRate, pcm }) {
  const wav = Buffer.alloc(44 + pcm.length);
  wav.write('RIFF', 0, 'ascii');
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8, 'ascii');
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36, 'ascii');
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}

function stats({ channels, sampleRate, pcm }) {
  let peak = 0;
  let sum = 0;
  let voiced = 0;
  const count = pcm.length / 2;
  for (let i = 0; i < count; i++) {
    const value = Math.abs(pcm.readInt16LE(i * 2)) / 32768;
    peak = Math.max(peak, value);
    sum += value * value;
    if (value > 0.01) voiced++;
  }
  const db = value => (value > 0 ? 20 * Math.log10(value) : -Infinity);
  return { seconds: count / channels / sampleRate, peakDb: db(peak), rmsDb: db(Math.sqrt(sum / count)), voiced: voiced / count, peak };
}

function applyGain(clip, gain) {
  const pcm = Buffer.from(clip.pcm);
  for (let i = 0; i < pcm.length; i += 2) pcm.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(pcm.readInt16LE(i) * gain))), i);
  return { ...clip, pcm };
}

// Referencia de sonoridad: RMS medio de las locuciones de situación ya incluidas en Unity.
const references = [];
for (const name of await readdir(unityAudio)) {
  if (!name.endsWith('.wav')) continue;
  references.push(stats(standardWav(await readFile(path.join(unityAudio, name)))));
}
const targetRms = references.reduce((sum, item) => sum + item.rmsDb, 0) / references.length;
const referencePeak = Math.max(...references.map(item => item.peakDb));
console.log(`Referencia (${references.length} locuciones): RMS medio ${targetRms.toFixed(1)} dBFS, pico máximo ${referencePeak.toFixed(1)} dBFS`);

async function soniox(text, id, format) {
  const response = await fetch('https://tts-rt.soniox.com/tts', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.SONIOX_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'tts-rt-v2', language: 'es', voice: 'Carmen', audio_format: format, sample_rate: 48000, speed: 1.0,
      text, client_reference_id: `axyro-reaction-${id}`
    }),
    signal: AbortSignal.timeout(120000)
  });
  if (!response.ok) throw new Error(`Soniox rechazó ${id} (${format}): HTTP ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

const problems = [];
for (const item of reactions) {
  const raw = reuse ? await readFile(path.join(out, `${item.file}.raw.wav`)) : await soniox(item.speech, item.file, 'wav');
  if (!reuse) await writeFile(path.join(out, `${item.file}.raw.wav`), raw);
  if (raw.length < 44 || raw.toString('ascii', 0, 4) !== 'RIFF' || raw.toString('ascii', 8, 12) !== 'WAVE') throw new Error(`WAV inválido: ${item.file}`);
  const clip = standardWav(raw);
  const before = stats(clip);
  // Ganancia hacia el RMS de referencia, sin superar el pico de -1 dBFS.
  const gain = Math.min(10 ** ((targetRms - before.rmsDb) / 20), 10 ** (-1 / 20) / Math.max(before.peak, 1e-6));
  const leveled = applyGain(clip, gain);
  const after = stats(leveled);
  await writeFile(path.join(out, `${item.file}.wav`), encodeWav(leveled));
  // Versión comprimida para la vista móvil (misma voz y texto, generada por Soniox en MP3).
  const mp3Path = path.join(out, `${item.file}.mp3`);
  if (!reuse || !existsSync(mp3Path)) {
    if (reuse && !process.env.SONIOX_API_KEY) problems.push(`${item.file}: sin MP3 (falta SONIOX_API_KEY)`);
    else await writeFile(mp3Path, await soniox(item.speech, item.file, 'mp3'));
  }
  if (after.seconds < 2 || after.seconds > 25) problems.push(`${item.file}: duración ${after.seconds.toFixed(1)} s`);
  if (after.voiced < 0.2) problems.push(`${item.file}: casi silencio (${(after.voiced * 100).toFixed(0)} % de muestras con señal)`);
  if (before.peakDb > -0.1) problems.push(`${item.file}: posible saturación en origen (pico ${before.peakDb.toFixed(2)} dBFS)`);
  console.log(`${item.file}: ${after.seconds.toFixed(1)} s · ${clip.sampleRate} Hz · RMS ${before.rmsDb.toFixed(1)} → ${after.rmsDb.toFixed(1)} dBFS · pico ${after.peakDb.toFixed(1)} dBFS`);
}

const meta = guid => `fileFormatVersion: 2
guid: ${guid}
AudioImporter:
  externalObjects: {}
  serializedVersion: 8
  defaultSettings:
    serializedVersion: 2
    loadType: 0
    sampleRateSetting: 0
    sampleRateOverride: 44100
    compressionFormat: 1
    quality: 1
    conversionMode: 0
    preloadAudioData: 0
  platformSettingOverrides:
    WebGL:
      serializedVersion: 2
      loadType: 0
      sampleRateSetting: 2
      sampleRateOverride: 44100
      compressionFormat: 7
      quality: 1
      conversionMode: 0
      preloadAudioData: 0
  forceToMono: 0
  normalize: 1
  loadInBackground: 0
  ambisonic: 0
  3D: 1
  userData:
  assetBundleName:
  assetBundleVariant:
`;
const folderMeta = guid => `fileFormatVersion: 2
guid: ${guid}
folderAsset: yes
DefaultImporter:
  externalObjects: {}
  userData:
  assetBundleName:
  assetBundleVariant:
`;
const newGuid = () => randomBytes(16).toString('hex');

if (install) {
  // Carpetas con su .meta (se conserva el GUID si ya existe).
  for (const folder of ['Reacciones', 'Reacciones/Resources', 'Reacciones/Resources/Reacciones']) {
    await mkdir(path.join(unityAudio, folder), { recursive: true });
    const metaPath = path.join(unityAudio, `${folder}.meta`);
    if (!existsSync(metaPath)) await writeFile(metaPath, folderMeta(newGuid()));
  }
  await mkdir(webTarget, { recursive: true });
  for (const item of reactions) {
    const wav = path.join(unityTarget, `${item.file}.wav`);
    await copyFile(path.join(out, `${item.file}.wav`), wav);
    if (!existsSync(`${wav}.meta`)) await writeFile(`${wav}.meta`, meta(newGuid()));
    const mp3 = path.join(out, `${item.file}.mp3`);
    if (existsSync(mp3)) await copyFile(mp3, path.join(webTarget, `${item.file}.mp3`));
  }
  console.log(`Instaladas ${reactions.length} reacciones en Unity y en la vista móvil.`);
}
if (problems.length) {
  console.error(`Revisar:\n- ${problems.join('\n- ')}`);
  process.exitCode = 1;
}
console.log(`Voz Carmen: ${reactions.length} reacción(es) en ${out}`);
