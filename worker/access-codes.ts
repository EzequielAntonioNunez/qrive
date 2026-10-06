import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Context } from 'hono';
import type { AuthContext, Identity } from './auth';
import type { Env } from './types';
import { normalizeEmail } from './auth';

const COOKIE = 'axyro_session';
const SESSION_HOURS = 24;

function randomSecret(bytes: number): string {
  const data = crypto.getRandomValues(new Uint8Array(bytes));
  return btoa(String.fromCharCode(...data)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function hashSecret(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** HMAC con secreto fuera de D1: seis cifras no deben ser comprobables sin el Worker. */
export async function hashAccessCode(env: Pick<Env, 'ACCESS_CODE_PEPPER'>, code: string): Promise<string> {
  if (!env.ACCESS_CODE_PEPPER || env.ACCESS_CODE_PEPPER.length < 32) throw new Error('ACCESS_CODE_PEPPER sin configurar.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ACCESS_CODE_PEPPER), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(code));
  return [...new Uint8Array(signature)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Ventana de 60 segundos en D1: cada incremento es atómico incluso con peticiones simultáneas. */
export async function consumeLoginAttempt(env: Env, email: string, ip: string, now = new Date()): Promise<boolean> {
  const at = now.toISOString();
  const cutoff = new Date(now.getTime() - 60_000).toISOString();
  const consume = async (scope: string): Promise<number> => {
    const keyHash = await hashAccessCode(env, scope);
    const row = await env.DB.prepare(`INSERT INTO access_login_limits (key_hash,window_start,attempts) VALUES (?,?,1)
      ON CONFLICT(key_hash) DO UPDATE SET
        attempts = CASE WHEN window_start <= ? THEN 1 ELSE attempts + 1 END,
        window_start = CASE WHEN window_start <= ? THEN ? ELSE window_start END
      RETURNING attempts`).bind(keyHash, at, cutoff, cutoff, at).first<{ attempts: number }>();
    if (!row) throw new Error('No se pudo contar el intento de acceso.');
    return row.attempts;
  };
  const emailAttempts = await consume(`email:${email}`);
  if (emailAttempts > 5) return false;
  return (await consume(`ip:${ip}`)) <= 120;
}

/** Solo se muestra una vez al docente. La base de datos recibe únicamente el hash. */
export async function issueCode(env: Env, tenantId: string, userId: string): Promise<{ code: string; id: string }> {
  for (let attempt = 0; attempt < 20; attempt++) {
    const digits = crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000;
    const code = String(digits).padStart(6, '0');
    const codeHash = await hashAccessCode(env, code);
    if (await env.DB.prepare('SELECT id FROM access_codes WHERE code_hash = ?').bind(codeHash).first()) continue;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await env.DB.batch([
        env.DB.prepare('UPDATE access_codes SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL').bind(now, tenantId, userId),
        env.DB.prepare('INSERT INTO access_codes (id,tenant_id,user_id,code_hash,created_at) VALUES (?,?,?,?,?)').bind(id, tenantId, userId, codeHash, now),
        env.DB.prepare('DELETE FROM access_sessions WHERE tenant_id = ? AND user_id = ?').bind(tenantId, userId)
      ]);
      return { code, id };
    } catch (error) {
      // Una alta concurrente puede haber elegido las mismas cifras; reintenta solo en ese caso.
      if (!String(error).includes('UNIQUE constraint failed: access_codes.code_hash')) throw error;
    }
  }
  throw new Error('No se pudo generar un código único.');
}

export async function revokeCodes(env: Env, tenantId: string, userId: string): Promise<void> {
  await env.DB.batch([
    env.DB.prepare('UPDATE access_codes SET revoked_at = ? WHERE tenant_id = ? AND user_id = ? AND revoked_at IS NULL').bind(new Date().toISOString(), tenantId, userId),
    env.DB.prepare('DELETE FROM access_sessions WHERE tenant_id = ? AND user_id = ?').bind(tenantId, userId)
  ]);
}

type CodeRow = { id: string; tenantId: string; userId: string; revokedAt: string | null; name: string; email: string; role: Identity['role'] };

export async function signInWithCode(c: Context<AuthContext>, emailInput: unknown, submitted: unknown): Promise<'ok' | 'invalid'> {
  const email = normalizeEmail(emailInput);
  if (!email || typeof submitted !== 'string' || !/^\d{6}$/.test(submitted.trim())) return 'invalid';
  const row = await c.env.DB.prepare(`SELECT ac.id, ac.tenant_id AS tenantId, ac.user_id AS userId, ac.revoked_at AS revokedAt,
    u.display_name AS name, u.email, m.role FROM access_codes ac
    JOIN users u ON u.id = ac.user_id JOIN memberships m ON m.tenant_id = ac.tenant_id AND m.user_id = ac.user_id
    WHERE ac.code_hash = ? AND u.email = ?`).bind(await hashAccessCode(c.env, submitted.trim()), email).first<CodeRow>();
  if (!row) return 'invalid';
  const now = new Date();
  const accepted = !row.revokedAt;
  const statements = [c.env.DB.prepare('INSERT INTO access_code_uses (id,code_id,tenant_id,user_id,at,outcome) VALUES (?,?,?,?,?,?)')
    .bind(crypto.randomUUID(), row.id, row.tenantId, row.userId, now.toISOString(), accepted ? 'accepted' : 'revoked')];
  let sessionToken = '';
  if (accepted) {
    sessionToken = randomSecret(32);
    statements.push(c.env.DB.prepare('INSERT INTO access_sessions (token_hash,code_id,tenant_id,user_id,created_at,expires_at) VALUES (?,?,?,?,?,?)')
      .bind(await hashSecret(sessionToken), row.id, row.tenantId, row.userId, now.toISOString(), new Date(now.getTime() + SESSION_HOURS * 3600000).toISOString()));
  }
  await c.env.DB.batch(statements);
  if (!accepted) return 'invalid';
  setCookie(c, COOKIE, sessionToken, {
    httpOnly: true, secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax', path: '/',
    maxAge: SESSION_HOURS * 3600
  });
  return 'ok';
}

export async function identityFromSession(c: Context<AuthContext>): Promise<Identity | null> {
  const token = getCookie(c, COOKIE);
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await c.env.DB.prepare(`SELECT u.id, u.email, u.display_name AS name, m.role, m.tenant_id AS tenantId
    FROM access_sessions s JOIN access_codes ac ON ac.id = s.code_id AND ac.revoked_at IS NULL
    JOIN memberships m ON m.tenant_id = s.tenant_id AND m.user_id = s.user_id
    JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await hashSecret(token), new Date().toISOString()).first<Identity>();
  return row ?? null;
}

export async function signOut(c: Context<AuthContext>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM access_sessions WHERE token_hash = ?').bind(await hashSecret(token)).run();
  deleteCookie(c, COOKIE, { path: '/', secure: new URL(c.req.url).protocol === 'https:', sameSite: 'Lax' });
}

export async function codeSummaries(env: Env, tenantId: string): Promise<unknown[]> {
  const rows = await env.DB.prepare(`SELECT ac.id, ac.user_id AS userId, ac.created_at AS createdAt,
    (SELECT COUNT(*) FROM access_code_uses uses WHERE uses.code_id = ac.id AND uses.outcome = 'accepted') AS uses,
    (SELECT MAX(at) FROM access_code_uses uses WHERE uses.code_id = ac.id AND uses.outcome = 'accepted') AS lastUsedAt
    FROM access_codes ac WHERE ac.tenant_id = ? AND ac.revoked_at IS NULL ORDER BY ac.created_at DESC`).bind(tenantId).all();
  return rows.results;
}

export async function pruneAuth(env: Env, now = new Date()): Promise<void> {
  const auditDays = Math.max(1, Number.parseInt(env.AUDIT_RETENTION_DAYS ?? '730', 10) || 730);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM access_sessions WHERE expires_at < ?').bind(now.toISOString()),
    env.DB.prepare('DELETE FROM access_code_uses WHERE at < ?').bind(new Date(now.getTime() - auditDays * 86400000).toISOString()),
    env.DB.prepare('DELETE FROM access_login_limits WHERE window_start < ?').bind(new Date(now.getTime() - 86400000).toISOString())
  ]);
}
