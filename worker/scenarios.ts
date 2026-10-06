import { negotiationScenario, type Scenario } from '../shared/simulation';
import { ScenarioError, validateScenario } from '../shared/scenario';
import type { Env } from './types';

export interface ScenarioSummary { id: string; version: number; title: string; summary: string; phases: number; catalog: boolean }

/** Publica el escenario de catálogo incluido en el código si esa versión aún no existe en D1. */
export async function ensureCatalog(env: Env): Promise<void> {
  const scenario = validateScenario(negotiationScenario);
  await env.DB.prepare('INSERT OR IGNORE INTO scenarios (id,version,tenant_id,title,definition_json,created_by,created_at) VALUES (?,?,NULL,?,?,?,?)')
    .bind(scenario.id, scenario.version, scenario.title, JSON.stringify(scenario), 'system', new Date().toISOString()).run();
}

/** Última versión de cada escenario visible para la organización (catálogo + propios). */
export async function listScenarios(env: Env, tenantId: string): Promise<ScenarioSummary[]> {
  await ensureCatalog(env);
  const rows = await env.DB.prepare(`SELECT s.id, s.version, s.tenant_id AS tenantId, s.definition_json AS json FROM scenarios s
    WHERE (s.tenant_id IS NULL OR s.tenant_id = ?) AND s.version = (
      SELECT MAX(v.version) FROM scenarios v WHERE v.id = s.id AND (v.tenant_id IS NULL OR v.tenant_id = ?))
    ORDER BY s.title`).bind(tenantId, tenantId).all<{ id: string; version: number; tenantId: string | null; json: string }>();
  return rows.results.map(row => {
    const scenario = JSON.parse(row.json) as Scenario;
    return { id: row.id, version: row.version, title: scenario.title, summary: scenario.summary, phases: scenario.phases.length, catalog: row.tenantId === null };
  });
}

export async function getScenario(env: Env, tenantId: string, id: string): Promise<Scenario | null> {
  await ensureCatalog(env);
  const row = await env.DB.prepare('SELECT definition_json AS json FROM scenarios WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?) ORDER BY version DESC LIMIT 1')
    .bind(id, tenantId).first<{ json: string }>();
  return row ? validateScenario(JSON.parse(row.json)) : null;
}

/**
 * Publica una versión nueva de un escenario propio de la organización.
 * Las versiones son inmutables y deben crecer; los IDs del catálogo están reservados.
 */
export async function publishScenario(env: Env, tenantId: string, actorId: string, value: unknown): Promise<Scenario> {
  const scenario = validateScenario(value);
  const owners = await env.DB.prepare('SELECT DISTINCT tenant_id AS tenantId FROM scenarios WHERE id = ?').bind(scenario.id).all<{ tenantId: string | null }>();
  if (owners.results.some(row => row.tenantId !== tenantId)) throw new ScenarioError('id: ya existe en otra organización o en el catálogo; usa otro identificador.');
  const latest = await env.DB.prepare('SELECT MAX(version) AS version FROM scenarios WHERE id = ? AND tenant_id = ?').bind(scenario.id, tenantId).first<{ version: number | null }>();
  if (latest?.version && scenario.version <= latest.version) throw new ScenarioError(`version: debe ser mayor que ${latest.version}.`);
  await env.DB.prepare('INSERT INTO scenarios (id,version,tenant_id,title,definition_json,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(scenario.id, scenario.version, tenantId, scenario.title, JSON.stringify(scenario), actorId, new Date().toISOString()).run();
  return scenario;
}
