import { getCookie, setCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AuthContext, Identity } from './auth';
import type { Env } from './types';
import { COOKIE, hashSecret, randomSecret } from './access-codes';

/**
 * Acceso invitado (unión tipo «código de sala»): quien está en el aula escanea el QR o teclea el PIN de seis cifras
 * de una sesión y un alias, y entra como participante de esa sesión, sin cuenta ni correo.
 * - El PIN se guarda en claro (el instructor lo vuelve a ver y proyectar) y solo vale mientras la sesión no ha
 *   finalizado: se revoca al finalizarla (persist.ts) y se borra con la sesión (purgeSession).
 * - La identidad de invitado usa la misma cookie de sesión que el acceso con código (`axyro_session`, HttpOnly,
 *   SameSite=Lax); en D1 solo queda el hash del token. Unirse sustituye siempre la cookie anterior.
 * - Ámbito: solo su sesión (ver `guestAllowed`); id seudónimo `guest-<uuid>`; el alias solo es el nombre visible
 *   del participante en el estado de la sesión, como el de cualquier participante. Nunca sale a la cola ni a la auditoría.
 */
export const GUEST_SCOPE_ERROR = 'Acceso de invitado limitado a su sesión.';
export const PIN_INVALID = 'Código de sesión no válido o caducado.';
export const ALIAS_INVALID = 'El alias debe tener entre 2 y 30 caracteres: letras, números, espacios, punto, guion o guion bajo.';
export const JOIN_BLOCKED = 'Demasiados intentos. Espera unos minutos.';
export const GUEST_PREFIX = 'guest-';
export const GUEST_HOURS = 12;
/** Tras finalizar la sesión, el invitado puede seguir leyendo su informe (solo lectura) durante este margen. */
export const GUEST_REPORT_GRACE_MS = 2 * 3600_000;
/** Fallos de PIN por IP en la ventana. Holgado: en un aula toda la clase suele compartir la IP de salida (NAT). */
export const JOIN_FAILURE_LIMIT = 30;
export const JOIN_FAILURE_WINDOW_MS = 10 * 60_000;

export const isGuestId = (id: string) => id.startsWith(GUEST_PREFIX);

// ---------------------------------------------------------------------------------------------
// PIN de la sesión
// ---------------------------------------------------------------------------------------------
function randomPin(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
}

export async function activePin(env: Pick<Env, 'DB'>, tenantId: string, sessionId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT pin FROM session_pins WHERE tenant_id = ? AND session_id = ? AND revoked_at IS NULL')
    .bind(tenantId, sessionId).first<{ pin: string }>();
  return row?.pin ?? null;
}

/**
 * PIN activo de la sesión; lo crea si no hay ninguno. Con `regenerate`, revoca el anterior y crea uno nuevo.
 * Los índices únicos parciales garantizan un PIN activo por sesión y PIN activos distintos entre sesiones.
 */
export async function ensurePin(env: Pick<Env, 'DB'>, tenantId: string, sessionId: string, regenerate: boolean): Promise<string> {
  for (let attempt = 0; attempt < 30; attempt++) {
    if (!regenerate) {
      const current = await activePin(env, tenantId, sessionId);
      if (current) return current;
    }
    const pin = randomPin();
    const now = new Date().toISOString();
    try {
      const statements = [];
      if (regenerate) statements.push(env.DB.prepare('UPDATE session_pins SET revoked_at = ? WHERE tenant_id = ? AND session_id = ? AND revoked_at IS NULL').bind(now, tenantId, sessionId));
      statements.push(env.DB.prepare('INSERT INTO session_pins (pin,tenant_id,session_id,created_at) VALUES (?,?,?,?)').bind(pin, tenantId, sessionId, now));
      await env.DB.batch(statements);
      return pin;
    } catch (error) {
      // Colisión con otro PIN activo (se reintenta con otras cifras) o creación simultánea para la misma sesión
      // (la siguiente vuelta devuelve el PIN que ganó).
      if (!String(error).includes('UNIQUE')) throw error;
      if (regenerate && String(error).includes('session_id')) regenerate = false;
    }
  }
  throw new Error('No se pudo generar un PIN único.');
}

export interface PinSession { tenantId: string; sessionId: string; status: 'active' | 'paused'; name: string | null; scenarioTitle: string }

/** Sesión no finalizada de un PIN activo; null si el PIN no existe, está revocado o la sesión ha terminado. */
export async function sessionByPin(env: Pick<Env, 'DB'>, pin: unknown): Promise<PinSession | null> {
  if (typeof pin !== 'string' || !/^\d{6}$/.test(pin.trim())) return null;
  return env.DB.prepare(`SELECT p.tenant_id AS tenantId, p.session_id AS sessionId, s.status, s.name,
      COALESCE((SELECT sc.title FROM scenarios sc WHERE sc.id = s.scenario_id AND sc.version = s.scenario_version
        AND (sc.tenant_id IS NULL OR sc.tenant_id = s.tenant_id)), s.scenario_id) AS scenarioTitle
    FROM session_pins p JOIN sessions s ON s.id = p.session_id AND s.tenant_id = p.tenant_id
    WHERE p.pin = ? AND p.revoked_at IS NULL AND s.status <> 'complete'`).bind(pin.trim()).first<PinSession>();
}

/** Sentencias que revocan el PIN y acortan la vida de los invitados al finalizar la sesión (persist.ts). */
export function completionStatements(env: Pick<Env, 'DB'>, tenantId: string, sessionId: string, completedAt: string): D1PreparedStatement[] {
  const graceEnd = new Date(Date.parse(completedAt) + GUEST_REPORT_GRACE_MS).toISOString();
  return [
    env.DB.prepare('UPDATE session_pins SET revoked_at = ? WHERE tenant_id = ? AND session_id = ? AND revoked_at IS NULL').bind(completedAt, tenantId, sessionId),
    env.DB.prepare('UPDATE guests SET expires_at = ? WHERE tenant_id = ? AND session_id = ? AND expires_at > ?').bind(graceEnd, tenantId, sessionId, graceEnd)
  ];
}

/** Sentencias que borran PIN e invitados de una sesión (borrado RGPD o retención). */
export function purgeStatements(env: Pick<Env, 'DB'>, tenantId: string, sessionId: string): D1PreparedStatement[] {
  return [
    env.DB.prepare('DELETE FROM guests WHERE tenant_id = ? AND session_id = ?').bind(tenantId, sessionId),
    env.DB.prepare('DELETE FROM session_pins WHERE tenant_id = ? AND session_id = ?').bind(tenantId, sessionId)
  ];
}

/** Cron diario: invitados caducados y PIN revocados hace más de un día. */
export async function pruneGuests(env: Pick<Env, 'DB'>, now = new Date()): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM guests WHERE expires_at < ?').bind(now.toISOString()),
    env.DB.prepare('DELETE FROM session_pins WHERE revoked_at IS NOT NULL AND revoked_at < ?').bind(new Date(now.getTime() - 86400000).toISOString())
  ]);
}

// ---------------------------------------------------------------------------------------------
// Fuerza bruta: fallos de PIN por IP en una ventana de 10 minutos (D1, atómico; el limitador de borde aparte).
// ---------------------------------------------------------------------------------------------
const failureKey = (ip: string) => hashSecret(`guest-join-ip:${ip}`);

export async function joinBlocked(env: Pick<Env, 'DB'>, ip: string, now = new Date()): Promise<boolean> {
  const row = await env.DB.prepare('SELECT window_start AS windowStart, attempts FROM access_login_limits WHERE key_hash = ?')
    .bind(await failureKey(ip)).first<{ windowStart: string; attempts: number }>();
  if (!row) return false;
  return Date.parse(row.windowStart) > now.getTime() - JOIN_FAILURE_WINDOW_MS && row.attempts >= JOIN_FAILURE_LIMIT;
}

export async function recordJoinFailure(env: Pick<Env, 'DB'>, ip: string, now = new Date()): Promise<void> {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - JOIN_FAILURE_WINDOW_MS).toISOString();
  await env.DB.prepare(`INSERT INTO access_login_limits (key_hash,window_start,attempts) VALUES (?,?,1)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
      window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END`).bind(await failureKey(ip), at, cutoff, cutoff, at).run();
}

// ---------------------------------------------------------------------------------------------
// Alias
// ---------------------------------------------------------------------------------------------
/** Alias recortado (espacios internos colapsados) de 2 a 30 caracteres: letras, números, espacios, «.», «-», «_». Sin correos ni URL. */
export function parseAlias(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const alias = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  if (alias.length < 2 || alias.length > 30) return null;
  if (!/^[\p{L}\p{M}\p{N} ._-]+$/u.test(alias)) return null;
  // «@» y «/» ya no pasan; se rechazan además dominios y prefijos web escritos con puntos.
  if (/^www\.|\.(com|es|net|org|io|dev|edu|info|app)\b/i.test(alias)) return null;
  if (!/[\p{L}\p{N}]/u.test(alias)) return null;
  return alias;
}

/** «Ana» si está libre; si no, «Ana 2», «Ana 3»... (sin pasar de 30 caracteres). */
export function dedupeAlias(alias: string, taken: Iterable<string>): string {
  const used = new Set([...taken].map(item => item.toLowerCase()));
  if (!used.has(alias.toLowerCase())) return alias;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = `${alias.slice(0, 30 - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// ---------------------------------------------------------------------------------------------
// Identidad de invitado
// ---------------------------------------------------------------------------------------------
export function guestIdentity(row: { id: string; name: string; tenantId: string; sessionId: string }): Identity {
  return { id: row.id, name: row.name, role: 'participant', tenantId: row.tenantId, email: '', guest: { sessionId: row.sessionId } };
}

/** Invitado de la cookie: no caducado y con su sesión existente (no finalizada, o finalizada hace menos del margen). */
export async function guestFromCookie(c: Context<AuthContext>, now = new Date()): Promise<Identity | null> {
  const token = getCookie(c, COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await c.env.DB.prepare(`SELECT g.id, g.alias AS name, g.tenant_id AS tenantId, g.session_id AS sessionId
    FROM guests g JOIN sessions s ON s.id = g.session_id AND s.tenant_id = g.tenant_id
    WHERE g.token_hash = ? AND g.expires_at > ? AND (s.status <> 'complete' OR COALESCE(s.completed_at, s.created_at) > ?)`)
    .bind(await hashSecret(token), now.toISOString(), new Date(now.getTime() - GUEST_REPORT_GRACE_MS).toISOString())
    .first<{ id: string; name: string; tenantId: string; sessionId: string }>();
  return row ? guestIdentity(row) : null;
}

/**
 * Crea la fila del invitado con un alias libre en la sesión (el índice único resuelve las uniones simultáneas).
 * Devuelve la identidad y el token de la cookie, que todavía no se ha enviado.
 */
export async function createGuest(env: Pick<Env, 'DB'>, session: Pick<PinSession, 'tenantId' | 'sessionId'>, alias: string, now = new Date()): Promise<{ identity: Identity; token: string }> {
  const token = randomSecret(32);
  const tokenHash = await hashSecret(token);
  const id = `${GUEST_PREFIX}${crypto.randomUUID()}`;
  const expiresAt = new Date(now.getTime() + GUEST_HOURS * 3600_000).toISOString();
  for (let attempt = 0; attempt < 10; attempt++) {
    const rows = await env.DB.prepare('SELECT alias FROM guests WHERE tenant_id = ? AND session_id = ?').bind(session.tenantId, session.sessionId).all<{ alias: string }>();
    const name = dedupeAlias(alias, rows.results.map(row => row.alias));
    try {
      await env.DB.prepare('INSERT INTO guests (id,tenant_id,session_id,alias,token_hash,created_at,expires_at) VALUES (?,?,?,?,?,?,?)')
        .bind(id, session.tenantId, session.sessionId, name, tokenHash, now.toISOString(), expiresAt).run();
      return { identity: guestIdentity({ id, name, tenantId: session.tenantId, sessionId: session.sessionId }), token };
    } catch (error) {
      if (!String(error).includes('UNIQUE')) throw error;
    }
  }
  throw new Error('No se pudo reservar el alias.');
}

/** Cookie del invitado: misma cookie y atributos que el acceso con código; vida máxima de 12 horas. */
export function setGuestCookie(c: Context<AuthContext>, token: string): void {
  setCookie(c, COOKIE, token, {
    httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/', maxAge: GUEST_HOURS * 3600
  });
}

/** Cierra la sesión de la cookie actual (miembro o invitado) en D1 sin tocar la cookie, que se va a sustituir. */
export async function dropCurrentSession(c: Context<AuthContext>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return;
  const hash = await hashSecret(token);
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM access_sessions WHERE token_hash = ?').bind(hash),
    c.env.DB.prepare('DELETE FROM guests WHERE token_hash = ?').bind(hash)
  ]);
}

/**
 * Rutas que puede llamar un invitado (el resto: 403 GUEST_SCOPE_ERROR). Las de voz comprueban además en su
 * manejador que el `sessionId` del cuerpo es el suyo; los comandos, que el tipo es join o decide.
 */
export function guestAllowed(method: string, path: string, sessionId: string): boolean {
  const read = method === 'GET' || method === 'HEAD';
  if (path === '/api/me' || path === '/api/voice/config') return read;
  if (path === '/api/voice/temporary-key' || path === '/api/voice/interpret' || path === '/api/auth/logout') return method === 'POST';
  const match = /^\/api\/sessions\/([^/]+)(\/live|\/commands)?\/?$/.exec(path);
  if (!match || match[1] !== sessionId) return false;
  return match[2] === '/commands' ? method === 'POST' : read;
}
