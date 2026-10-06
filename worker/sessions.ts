import type { Identity } from './auth';
import type { Env } from './types';

export const SESSION_NAME_MAX = 80;
export const SESSION_NAME_INVALID = `El nombre de la sesión debe tener entre 1 y ${SESSION_NAME_MAX} caracteres.`;
const COPY_SUFFIX = ' (copia)';

export type SessionStatus = 'active' | 'paused' | 'complete';

/** Fila del listado de sesiones (GET /api/sessions, PATCH, POST y duplicar). */
export interface SessionRow {
  id: string;
  name: string | null;
  scenarioId: string;
  /** Título de la versión del escenario de la sesión; si esa versión ya no está en D1, su id. */
  scenarioTitle: string;
  scenarioVersion: number;
  status: SessionStatus;
  createdAt: string;
  completedAt: string | null;
  instructorId: string;
  /** Nombre visible del instructor creador; null si ya no es miembro de la organización. */
  instructorName: string | null;
  /** La sesión la creó quien pregunta. */
  mine: boolean;
  /** Solo instructor: personas distintas unidas (eventos participant_joined en D1, sin los simulados). */
  participantCount?: number;
  /** Solo instructor: participantes simulados que se han unido alguna vez (incluye los ya retirados). */
  simulatedCount?: number;
  /** Fase actual según los eventos phase_advanced de D1 (0 si aún no se ha avanzado); null sin escenario. */
  phaseIndex: number | null;
  phaseCount: number | null;
}

/**
 * Nombre de sesión: texto recortado de 1 a 80 caracteres, sin caracteres de control. Sin `required`, un valor
 * ausente o null es «sin nombre» (null). Cualquier otro valor no válido lanza el error de la constante.
 */
export function parseSessionName(value: unknown, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) throw new SessionNameError();
    return null;
  }
  if (typeof value !== 'string') throw new SessionNameError();
  const name = value.trim();
  // eslint-disable-next-line no-control-regex
  if (!name || name.length > SESSION_NAME_MAX || /[\u0000-\u001f\u007f]/.test(name)) throw new SessionNameError();
  return name;
}

export class SessionNameError extends Error {
  constructor() { super(SESSION_NAME_INVALID); }
}

/** Nombre de la copia: «<nombre o título del escenario> (copia)», recortando el original para no pasar de 80. */
export function copyName(base: string): string {
  return `${base.trim().slice(0, SESSION_NAME_MAX - COPY_SUFFIX.length).trimEnd()}${COPY_SUFFIX}`;
}

const SIMULATED = "substr(e.actor_id, 1, 4) = 'sim-'";

/**
 * Filas del listado en una sola consulta (sin llamadas a los Durable Objects):
 * - Recuentos por los eventos `participant_joined` ya persistidos en D1 (la unión se escribe también desde la API,
 *   así que es inmediata). Los IDs `sim-` son de la clase simulada.
 * - Fase actual: el último `phase_advanced` en D1 (la API lo escribe al avanzar), buscada en la definición
 *   versionada del escenario; `phaseCount` sale de esa misma definición.
 * Instructor: todas las sesiones de su organización. Participante: solo aquellas a las que se ha unido (con
 * `allForParticipant`, todas: modo demo local) y sin recuentos de la clase.
 * Orden: activas y pausadas primero; dentro de cada grupo, las más recientes. Máximo 200.
 */
export async function sessionRows(env: Pick<Env, 'DB'>, identity: Pick<Identity, 'id' | 'role' | 'tenantId'>, options: { id?: string; allForParticipant?: boolean } = {}): Promise<SessionRow[]> {
  const instructor = identity.role === 'instructor';
  const filters = ['s.tenant_id = ?'];
  const args: unknown[] = [identity.tenantId];
  if (options.id !== undefined) { filters.push('s.id = ?'); args.push(options.id); }
  if (!instructor && !options.allForParticipant) {
    filters.push(`EXISTS (SELECT 1 FROM simulation_events j WHERE j.tenant_id = s.tenant_id AND j.session_id = s.id
      AND j.type = 'participant_joined' AND j.actor_id = ?)`);
    args.push(identity.id);
  }
  const order = "CASE WHEN status = 'complete' THEN 1 ELSE 0 END, createdAt DESC";
  const rows = await env.DB.prepare(`WITH base AS (
      SELECT s.id, s.name, s.scenario_id AS scenarioId, s.scenario_version AS scenarioVersion, s.status,
        s.created_at AS createdAt, s.completed_at AS completedAt, s.instructor_id AS instructorId, u.display_name AS instructorName,
        sc.title AS scenarioTitle, sc.definition_json AS definition,
        (SELECT COUNT(DISTINCT e.actor_id) FROM simulation_events e WHERE e.tenant_id = s.tenant_id AND e.session_id = s.id
          AND e.type = 'participant_joined' AND NOT (${SIMULATED})) AS participantCount,
        (SELECT COUNT(DISTINCT e.actor_id) FROM simulation_events e WHERE e.tenant_id = s.tenant_id AND e.session_id = s.id
          AND e.type = 'participant_joined' AND ${SIMULATED}) AS simulatedCount,
        (SELECT json_extract(e.detail_json, '$.phaseId') FROM simulation_events e WHERE e.tenant_id = s.tenant_id AND e.session_id = s.id
          AND e.type = 'phase_advanced' ORDER BY e.seq DESC LIMIT 1) AS lastPhaseId
      FROM sessions s
      LEFT JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.instructor_id
      LEFT JOIN users u ON u.id = m.user_id
      LEFT JOIN scenarios sc ON sc.id = s.scenario_id AND sc.version = s.scenario_version AND (sc.tenant_id IS NULL OR sc.tenant_id = s.tenant_id)
      WHERE ${filters.join(' AND ')}
      ORDER BY CASE WHEN s.status = 'complete' THEN 1 ELSE 0 END, s.created_at DESC LIMIT 200)
    SELECT id, name, scenarioId, scenarioVersion, status, createdAt, completedAt, instructorId, instructorName, scenarioTitle,
      participantCount, simulatedCount, lastPhaseId,
      json_array_length(definition, '$.phases') AS phaseCount,
      (SELECT CAST(p.key AS INTEGER) FROM json_each(definition, '$.phases') p WHERE json_extract(p.value, '$.id') = lastPhaseId) AS phaseIndex
    FROM base ORDER BY ${order}`).bind(...args).all<Record<string, unknown>>();
  return rows.results.map(row => {
    const phaseCount = typeof row.phaseCount === 'number' ? row.phaseCount : null;
    const phaseIndex = phaseCount === null ? null
      : row.lastPhaseId == null ? 0
        : typeof row.phaseIndex === 'number' ? row.phaseIndex : null;
    const item: SessionRow = {
      id: String(row.id),
      name: typeof row.name === 'string' ? row.name : null,
      scenarioId: String(row.scenarioId),
      scenarioTitle: typeof row.scenarioTitle === 'string' ? row.scenarioTitle : String(row.scenarioId),
      scenarioVersion: Number(row.scenarioVersion),
      status: (row.status === 'paused' || row.status === 'complete' ? row.status : 'active') as SessionStatus,
      createdAt: String(row.createdAt),
      completedAt: typeof row.completedAt === 'string' ? row.completedAt : null,
      instructorId: String(row.instructorId),
      instructorName: typeof row.instructorName === 'string' ? row.instructorName : null,
      mine: instructor && row.instructorId === identity.id,
      phaseIndex,
      phaseCount
    };
    if (instructor) {
      item.participantCount = Number(row.participantCount ?? 0);
      item.simulatedCount = Number(row.simulatedCount ?? 0);
    }
    return item;
  });
}

export async function sessionRow(env: Pick<Env, 'DB'>, identity: Pick<Identity, 'id' | 'role' | 'tenantId'>, id: string): Promise<SessionRow | null> {
  return (await sessionRows(env, identity, { id }))[0] ?? null;
}
