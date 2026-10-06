const base = process.env.AXYRO_API_URL ?? 'http://127.0.0.1:8787';
const runs = Number(process.env.SMOKE_RUNS ?? '5');
if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new Error('SMOKE_RUNS debe estar entre 1 y 100');

async function api(path, role = 'instructor', body, tenant = 'demo') {
  const response = await fetch(`${base}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-demo-user': role, 'x-demo-tenant': tenant },
    body: body ? JSON.stringify(body) : undefined
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${path}: ${data.error ?? 'sin detalle'}`);
  return data;
}

async function command(id, role, type, extra = {}) {
  return api(`/sessions/${id}/commands`, role, { id: crypto.randomUUID(), type, ...extra });
}

async function oneRun() {
  const created = await api('/sessions', 'instructor', {});
  const id = created.state.id;
  try {
    await api(`/sessions/${id}`, 'instructor', undefined, 'other');
    throw new Error(`Aislamiento entre organizaciones roto en ${id}`);
  } catch (error) {
    if (!String(error).includes('404')) throw error;
  }
  await command(id, 'participant', 'join');
  // Escenario por defecto: «Uso responsable de la IA en la universidad».
  await command(id, 'participant', 'decide', { optionId: 'anonimizar' });
  await command(id, 'instructor', 'advance');
  await command(id, 'participant', 'decide', { optionId: 'contrastar' });
  await command(id, 'instructor', 'advance');
  await command(id, 'participant', 'decide', { optionId: 'dialogar' });
  const completed = await command(id, 'instructor', 'complete');
  if (completed.state.status !== 'complete' || completed.report.decisions !== 3 || completed.report.score < 60) throw new Error(`Resultado incorrecto en ${id}`);
  const readBack = await api(`/sessions/${id}`);
  if (readBack.state.events.length !== 8) throw new Error(`Eventos incompletos en ${id}: ${readBack.state.events.length}`);
  return id;
}

await api('/health');
let completed = 0;
for (let offset = 0; offset < runs; offset += 5) {
  const batch = Array.from({ length: Math.min(5, runs - offset) }, () => oneRun());
  await Promise.all(batch);
  completed += batch.length;
  console.log(`${completed}/${runs} simulaciones completas`);
}
async function listedStatus(id, expected) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { sessions } = await api('/sessions');
    if (sessions.find(item => item.id === id)?.status === expected) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`El listado no refleja el estado ${expected} en ${id}`);
}
const paused = await api('/sessions', 'instructor', {});
await command(paused.state.id, 'instructor', 'pause');
await listedStatus(paused.state.id, 'paused');
await command(paused.state.id, 'instructor', 'resume');
await listedStatus(paused.state.id, 'active');
console.log('OK: el listado refleja pausa y reanudación');

const { scenario: catalog } = await api('/scenarios/supplier-negotiation');
const customId = `smoke-${Date.now()}`;
const custom = { ...catalog, id: customId, version: 1, title: 'Escenario de prueba', phases: [catalog.phases[0], catalog.phases[2]] };
await api('/scenarios', 'instructor', custom);
try {
  await api('/scenarios', 'instructor', custom);
  throw new Error('Se aceptó una versión repetida');
} catch (error) { if (!String(error).includes('400')) throw error; }
const visibleElsewhere = (await api('/scenarios', 'instructor', undefined, 'other')).scenarios.some(item => item.id === customId);
if (visibleElsewhere) throw new Error('Un escenario propio es visible para otra organización');
const customSession = await api('/sessions', 'instructor', { scenarioId: customId });
if (customSession.state.scenario.id !== customId || customSession.state.scenario.phases.length !== 2) throw new Error('La sesión no usa el escenario publicado');
try {
  await api('/sessions', 'instructor', { scenarioId: customId }, 'other');
  throw new Error('Otra organización pudo usar un escenario ajeno');
} catch (error) { if (!String(error).includes('404')) throw error; }
console.log('OK: escenarios versionados y aislados por organización');

const exported = await api(`/sessions/${customSession.state.id}/export`);
if (exported.session?.id !== customSession.state.id) throw new Error('La exportación no contiene la sesión');
async function remove(id, tenant = 'demo') {
  const response = await fetch(`${base}/api/sessions/${id}`, { method: 'DELETE', headers: { 'x-demo-user': 'instructor', 'x-demo-tenant': tenant } });
  return response.status;
}
if (await remove(customSession.state.id, 'other') !== 404) throw new Error('Otra organización pudo borrar una sesión ajena');
if (await remove(customSession.state.id) !== 200) throw new Error('No se pudo borrar la sesión');
try { await api(`/sessions/${customSession.state.id}`); throw new Error('La sesión borrada sigue accesible'); }
catch (error) { if (!String(error).includes('404')) throw error; }
console.log('OK: exportación y borrado RGPD');

// Recorre cada escenario visible (catálogo y propios) eligiendo la mejor opción de cada fase.
async function playScenario(scenarioId) {
  const created = await api('/sessions', 'instructor', { scenarioId });
  const id = created.state.id;
  if (created.state.scenario.id !== scenarioId) throw new Error(`La sesión ${id} no usa el escenario ${scenarioId}`);
  const phases = created.state.scenario.phases.length;
  let current = await command(id, 'participant', 'join');
  for (let index = 0; index < phases; index++) {
    if (current.state.phaseIndex !== index) throw new Error(`Fase inesperada en ${scenarioId}: ${current.state.phaseIndex} en lugar de ${index}`);
    const { options } = current.state.scenario.phases[index];
    const option = options.find(item => item.quality === 'best') ?? options[0];
    current = await command(id, 'participant', 'decide', { optionId: option.id });
    if (index < phases - 1) current = await command(id, 'instructor', 'advance');
  }
  const completed = await command(id, 'instructor', 'complete');
  const { report } = completed;
  if (completed.state.status !== 'complete') throw new Error(`La sesión de ${scenarioId} no terminó`);
  if (report.decisions !== phases) throw new Error(`Informe incorrecto en ${scenarioId}: ${report.decisions} decisiones para ${phases} fases`);
  if (report.correctDecisionsPct !== null && report.correctDecisionsPct !== 100) throw new Error(`Decisiones correctas en ${scenarioId}: ${report.correctDecisionsPct} %`);
  if (report.criticalDecisions !== 0) throw new Error(`Decisiones críticas inesperadas en ${scenarioId}: ${report.criticalDecisions}`);
  return phases;
}
const { scenarios } = await api('/scenarios');
if (!scenarios.length) throw new Error('No hay escenarios publicados');
let scenarioPhases = 0;
for (const scenario of scenarios) scenarioPhases += await playScenario(scenario.id);
console.log(`OK: ${scenarios.length} escenarios recorridos con la mejor opción (${scenarioPhases} fases)`);

console.log(`OK: ${runs} simulaciones consecutivas sin error crítico`);
