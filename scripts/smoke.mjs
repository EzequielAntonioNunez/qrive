const base = process.env.AXYRO_API_URL ?? 'http://127.0.0.1:8787';
const runs = Number(process.env.SMOKE_RUNS ?? '5');
if (!Number.isInteger(runs) || runs < 1 || runs > 100) throw new Error('SMOKE_RUNS debe estar entre 1 y 100');

async function api(path, role = 'instructor', body) {
  const response = await fetch(`${base}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', 'x-demo-user': role },
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
  await command(id, 'participant', 'join');
  await command(id, 'participant', 'decide', { optionId: 'ask-data' });
  await command(id, 'instructor', 'advance');
  await command(id, 'participant', 'decide', { optionId: 'three-year-eight' });
  await command(id, 'instructor', 'advance');
  await command(id, 'participant', 'decide', { optionId: 'milestones' });
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
console.log(`OK: ${runs} simulaciones consecutivas sin error crítico`);
