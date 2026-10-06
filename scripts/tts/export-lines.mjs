// Exporta las frases del personaje de los escenarios de catálogo (shared/simulation.ts) a JSON,
// con el id de fase como clave: Unity busca la locución como Assets/AXYRO/Audio/<idDeFase>.wav.
// Uso: node scripts/tts/export-lines.mjs .local-state/tts/lines.json
import { writeFileSync } from 'node:fs';
import { catalogScenarios } from '../../shared/simulation.ts';

const lines = {};
for (const scenario of catalogScenarios) for (const phase of scenario.phases) lines[phase.id] = phase.characterLine;
const target = process.argv[2] ?? '.local-state/tts/lines.json';
writeFileSync(target, JSON.stringify(lines, null, 2));
console.log(`${Object.keys(lines).length} frases en ${target}`);
