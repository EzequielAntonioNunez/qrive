import { catalogScenarios, type Scenario, type ScenarioOrigin } from '../shared/simulation';
import { ScenarioError, validateScenario } from '../shared/scenario';
import type { Env } from './types';

const UNAVAILABLE_ID = 'Ese identificador no está disponible.';

/**
 * `origin`: 'ai' si se publicó desde un borrador del modo IA en vivo. `publishedBy`: nombre del docente que publicó
 * esa versión (solo escenarios propios de la organización; null en el catálogo o si ya no es miembro).
 */
export interface ScenarioSummary {
  id: string; version: number; title: string; summary: string; phases: number; catalog: boolean;
  origin: 'ai' | null; publishedBy: string | null; publishedAt: string | null;
}

/** Publica los escenarios de catálogo incluidos en el código si esa versión aún no existe en D1. */
export async function ensureCatalog(env: Env): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.batch(catalogScenarios.map(item => {
    const scenario = validateScenario(item);
    return env.DB.prepare('INSERT OR IGNORE INTO scenarios (id,version,tenant_id,title,definition_json,created_by,created_at) VALUES (?,?,NULL,?,?,?,?)')
      .bind(scenario.id, scenario.version, scenario.title, JSON.stringify(scenario), 'system', now);
  }));
}

/** Última versión de cada escenario visible para la organización (catálogo + propios). */
export async function listScenarios(env: Env, tenantId: string): Promise<ScenarioSummary[]> {
  await ensureCatalog(env);
  // El nombre de quien publicó solo se busca entre los miembros de la propia organización.
  const rows = await env.DB.prepare(`SELECT s.id, s.version, s.tenant_id AS tenantId, s.definition_json AS json, s.created_at AS createdAt,
      CASE WHEN s.tenant_id IS NULL THEN NULL ELSE u.display_name END AS publishedBy
    FROM scenarios s
    LEFT JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.created_by
    LEFT JOIN users u ON u.id = m.user_id
    WHERE (s.tenant_id IS NULL OR s.tenant_id = ?) AND s.version = (
      SELECT MAX(v.version) FROM scenarios v WHERE v.id = s.id AND (v.tenant_id IS NULL OR v.tenant_id = ?))
    ORDER BY s.title`).bind(tenantId, tenantId).all<{ id: string; version: number; tenantId: string | null; json: string; createdAt: string; publishedBy: string | null }>();
  return rows.results.map(row => {
    const scenario = JSON.parse(row.json) as Scenario;
    const catalog = row.tenantId === null;
    return {
      id: row.id, version: row.version, title: scenario.title, summary: scenario.summary, phases: scenario.phases.length, catalog,
      origin: scenario.origin?.kind === 'ai' ? 'ai' : null, publishedBy: catalog ? null : row.publishedBy ?? null, publishedAt: catalog ? null : row.createdAt
    };
  });
}

export async function getScenario(env: Env, tenantId: string, id: string): Promise<Scenario | null> {
  await ensureCatalog(env);
  const row = await env.DB.prepare('SELECT definition_json AS json FROM scenarios WHERE id = ? AND (tenant_id IS NULL OR tenant_id = ?) ORDER BY version DESC LIMIT 1')
    .bind(id, tenantId).first<{ json: string }>();
  return row ? validateScenario(JSON.parse(row.json)) : null;
}

/** Una versión concreta de un escenario visible para la organización (para duplicar una sesión tal cual). */
export async function getScenarioVersion(env: Env, tenantId: string, id: string, version: number): Promise<Scenario | null> {
  await ensureCatalog(env);
  const row = await env.DB.prepare('SELECT definition_json AS json FROM scenarios WHERE id = ? AND version = ? AND (tenant_id IS NULL OR tenant_id = ?)')
    .bind(id, version, tenantId).first<{ json: string }>();
  return row ? validateScenario(JSON.parse(row.json)) : null;
}

/**
 * Publica una versión nueva de un escenario propio de la organización.
 * Las versiones son inmutables y deben crecer; los IDs del catálogo están reservados.
 */
export async function publishScenario(env: Env, tenantId: string, actorId: string, value: unknown, options: { origin?: ScenarioOrigin } = {}): Promise<Scenario> {
  // La procedencia nunca la decide el cliente: se descarta la recibida y solo se pone la que fija el servidor.
  const input = value && typeof value === 'object' ? { ...(value as Record<string, unknown>) } : value;
  if (input && typeof input === 'object') {
    delete (input as Record<string, unknown>).origin;
    if (options.origin) (input as Record<string, unknown>).origin = options.origin;
  }
  const scenario = validateScenario(input);
  // El catálogo se publica antes de comprobar: un ID de catálogo está reservado aunque aún no esté en D1.
  // El mensaje es el mismo para catálogo y otras organizaciones, para no revelar qué IDs usan otros tenants.
  await ensureCatalog(env);
  if (catalogScenarios.some(item => item.id === scenario.id)) throw new ScenarioError(UNAVAILABLE_ID);
  const owners = await env.DB.prepare('SELECT DISTINCT tenant_id AS tenantId FROM scenarios WHERE id = ?').bind(scenario.id).all<{ tenantId: string | null }>();
  if (owners.results.some(row => row.tenantId !== tenantId)) throw new ScenarioError(UNAVAILABLE_ID);
  const latest = await env.DB.prepare('SELECT MAX(version) AS version FROM scenarios WHERE id = ? AND tenant_id = ?').bind(scenario.id, tenantId).first<{ version: number | null }>();
  if (latest?.version && scenario.version <= latest.version) throw new ScenarioError(`version: debe ser mayor que ${latest.version}.`);
  await env.DB.prepare('INSERT INTO scenarios (id,version,tenant_id,title,definition_json,created_by,created_at) VALUES (?,?,?,?,?,?,?)')
    .bind(scenario.id, scenario.version, tenantId, scenario.title, JSON.stringify(scenario), actorId, new Date().toISOString()).run();
  return scenario;
}

/** Última versión publicada por la organización con ese id (null si no hay ninguna). */
export async function latestOwnVersion(env: Env, tenantId: string, id: string): Promise<number | null> {
  const row = await env.DB.prepare('SELECT MAX(version) AS version FROM scenarios WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<{ version: number | null }>();
  return row?.version ? Number(row.version) : null;
}
