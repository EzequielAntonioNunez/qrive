import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Context } from 'hono';
import type { Actor } from '../shared/engine';
import type { Env } from './types';

export interface Identity extends Actor { tenantId: string; email: string }
export interface AuthContext { Bindings: Env; Variables: { identity: Identity; requestId: string } }

type MembershipRow = { id: string; name: string; role: 'instructor' | 'participant'; tenantId: string };

function configuredDomain(value?: string): string | null {
  if (!value || value.startsWith('REPLACE_')) return null;
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// Un JWKS por dominio de equipo de Access, reutilizado entre peticiones del mismo isolate:
// jose cachea las claves y solo vuelve a descargarlas al rotar (kid desconocido) o al caducar la caché.
const jwksByDomain = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function jwksFor(domain: string): ReturnType<typeof createRemoteJWKSet> {
  let keys = jwksByDomain.get(domain);
  if (!keys) {
    keys = createRemoteJWKSet(new URL(`https://${domain}/cdn-cgi/access/certs`));
    jwksByDomain.set(domain, keys);
  }
  return keys;
}

/** Normaliza un correo; null si no tiene la forma usuario@dominio. */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254 ? email : null;
}

/** Dominios con autoalta (ALLOWED_EMAIL_DOMAINS, separados por comas). Coincidencia exacta: no incluye subdominios. */
export function allowedDomain(email: string, env: Pick<Env, 'ALLOWED_EMAIL_DOMAINS'>): boolean {
  const domains = (env.ALLOWED_EMAIL_DOMAINS ?? '').split(',').map(item => item.trim().toLowerCase().replace(/^@/, '')).filter(Boolean);
  const domain = email.slice(email.lastIndexOf('@') + 1);
  return domains.includes(domain);
}

/** Nombre visible provisional a partir del correo (ana.garcia@ufv.es → «Ana Garcia»). El instructor puede corregirlo. */
export function displayNameFromEmail(email: string): string {
  const local = email.slice(0, email.indexOf('@'));
  const words = local.split(/[._-]+/).filter(Boolean).map(word => word.charAt(0).toUpperCase() + word.slice(1));
  return (words.join(' ') || local).slice(0, 100);
}

export function isOwnerEmail(env: Pick<Env, 'BOOTSTRAP_OWNER_EMAIL'>, email: string): boolean {
  return !!env.BOOTSTRAP_OWNER_EMAIL && env.BOOTSTRAP_OWNER_EMAIL.trim().toLowerCase() === email;
}

/**
 * Membresía de un correo. Un usuario pertenece a una sola organización (POST /api/memberships lo impide),
 * pero si hubiera datos antiguos con varias, la resolución es determinista: la organización más antigua.
 */
export async function membershipFor(env: Env, email: string): Promise<MembershipRow | null> {
  const rows = await env.DB.prepare(`SELECT users.id, users.display_name AS name, memberships.role, memberships.tenant_id AS tenantId
    FROM users JOIN memberships ON memberships.user_id = users.id JOIN tenants ON tenants.id = memberships.tenant_id
    WHERE users.email = ? ORDER BY tenants.created_at, tenants.id LIMIT 2`).bind(email).all<MembershipRow>();
  if (rows.results.length > 1) console.warn(JSON.stringify({ code: 'MULTI_TENANT_USER', userId: rows.results[0].id }));
  return rows.results[0] ?? null;
}

/**
 * Organización por defecto para la autoalta por dominio:
 * 1. DEFAULT_TENANT_ID, si está configurado y existe en D1.
 * 2. Si no, la organización en la que BOOTSTRAP_OWNER_EMAIL es instructor (la más antigua si hubiera varias).
 * Si no se puede determinar (p. ej. el propietario aún no ha entrado nunca), no hay autoalta.
 */
export async function organizationTenant(env: Env): Promise<string | null> {
  if (env.DEFAULT_TENANT_ID) {
    const tenant = await env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(env.DEFAULT_TENANT_ID).first<{ id: string }>();
    return tenant?.id ?? null;
  }
  const owner = normalizeEmail(env.BOOTSTRAP_OWNER_EMAIL);
  if (!owner) return null;
  const row = await env.DB.prepare(`SELECT memberships.tenant_id AS tenantId FROM users
    JOIN memberships ON memberships.user_id = users.id JOIN tenants ON tenants.id = memberships.tenant_id
    WHERE users.email = ? AND memberships.role = 'instructor' ORDER BY tenants.created_at, tenants.id LIMIT 1`).bind(owner).first<{ tenantId: string }>();
  return row?.tenantId ?? null;
}

/** Primer acceso del propietario: se une a DEFAULT_TENANT_ID si existe o crea la organización. */
async function bootstrapOwner(env: Env, email: string): Promise<MembershipRow | null> {
  const now = new Date().toISOString();
  let tenantId = env.DEFAULT_TENANT_ID ? await organizationTenant(env) : null;
  const statements: D1PreparedStatement[] = [];
  if (!tenantId) {
    tenantId = crypto.randomUUID();
    statements.push(env.DB.prepare('INSERT INTO tenants (id,name,created_at) VALUES (?,?,?)').bind(tenantId, 'Universidad Francisco de Vitoria', now));
  }
  statements.push(
    env.DB.prepare('INSERT OR IGNORE INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), email, displayNameFromEmail(email), now),
    env.DB.prepare("INSERT OR IGNORE INTO memberships (tenant_id,user_id,role) SELECT ?, id, 'instructor' FROM users WHERE email = ?").bind(tenantId, email)
  );
  await env.DB.batch(statements);
  return membershipFor(env, email);
}

/** Autoalta por dominio: siempre como participante; nunca promueve a instructor. */
async function enrollParticipant(env: Env, email: string): Promise<MembershipRow | null> {
  const tenantId = await organizationTenant(env);
  if (!tenantId) {
    console.warn(JSON.stringify({ code: 'AUTO_ENROLL_NO_TENANT' }));
    return null;
  }
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').bind(crypto.randomUUID(), email, displayNameFromEmail(email), new Date().toISOString()),
    env.DB.prepare("INSERT OR IGNORE INTO memberships (tenant_id,user_id,role) SELECT ?, id, 'participant' FROM users WHERE email = ?").bind(tenantId, email)
  ]);
  const row = await membershipFor(env, email);
  if (row) console.log(JSON.stringify({ code: 'AUTO_ENROLLED', userId: row.id, tenantId: row.tenantId }));
  return row;
}

/** Resuelve la identidad a partir de un correo ya verificado por Access. Exportada para los tests. */
export async function resolveIdentity(env: Env, email: string): Promise<Identity | null> {
  let row = await membershipFor(env, email);
  if (!row && isOwnerEmail(env, email)) row = await bootstrapOwner(env, email);
  else if (!row && allowedDomain(email, env)) row = await enrollParticipant(env, email);
  return row ? { ...row, email } : null;
}

export async function identityFor(c: Context<AuthContext>, demo: boolean): Promise<Identity | null> {
  if (demo) {
    const other = c.req.header('x-demo-tenant') === 'other';
    const tenantId = other ? 'demo-other' : 'demo';
    const participant = c.req.header('x-demo-user') === 'participant';
    const id = `${tenantId}-${participant ? 'participant' : 'instructor'}`;
    const email = `${participant ? 'participant' : 'instructor'}@${tenantId}.local`;
    const name = participant ? 'Participante demo' : 'Instructor demo';
    const now = new Date().toISOString();
    await c.env.DB.prepare('INSERT OR IGNORE INTO tenants (id,name,created_at) VALUES (?,?,?)').bind(tenantId, other ? 'Otra organización demo' : 'Organización demo', now).run();
    await c.env.DB.prepare('INSERT OR IGNORE INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').bind(id, email, name, now).run();
    await c.env.DB.prepare('INSERT OR IGNORE INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').bind(tenantId, id, participant ? 'participant' : 'instructor').run();
    return { id, name, email, role: participant ? 'participant' : 'instructor', tenantId };
  }
  const domain = configuredDomain(c.env.ACCESS_TEAM_DOMAIN);
  const audience = c.env.ACCESS_AUD;
  if (!domain || !audience || audience.startsWith('REPLACE_')) throw new Error('Cloudflare Access sin configurar.');
  const token = c.req.header('Cf-Access-Jwt-Assertion');
  if (!token) return null;
  let email: string | null;
  try {
    const issuer = `https://${domain}`;
    const { payload } = await jwtVerify(token, jwksFor(domain), { issuer, audience, algorithms: ['RS256'] });
    email = normalizeEmail(payload.email);
  } catch (error) {
    console.warn(JSON.stringify({ code: 'AUTH_REJECTED', message: String(error) }));
    return null;
  }
  // Tokens de servicio de Access (sin correo) no tienen identidad de usuario.
  return email ? resolveIdentity(c.env, email) : null;
}
