import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Context } from 'hono';
import type { Actor } from '../shared/engine';
import type { Env } from './types';

export interface Identity extends Actor { tenantId: string; email: string }
export interface AuthContext { Bindings: Env; Variables: { identity: Identity } }

function configuredDomain(value?: string): string | null {
  if (!value || value.startsWith('REPLACE_')) return null;
  return value.replace(/^https?:\/\//, '').replace(/\/$/, '');
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
  try {
    const issuer = `https://${domain}`;
    const keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
    const { payload } = await jwtVerify(token, keys, { issuer, audience });
    if (typeof payload.email !== 'string') return null;
    const email = payload.email.toLowerCase();
    let row = await c.env.DB.prepare(`SELECT users.id, users.display_name AS name, memberships.role, memberships.tenant_id AS tenantId
      FROM users JOIN memberships ON memberships.user_id = users.id WHERE users.email = ? LIMIT 1`).bind(email).first<{ id: string; name: string; role: 'instructor' | 'participant'; tenantId: string }>();
    if (!row && c.env.BOOTSTRAP_OWNER_EMAIL?.toLowerCase() === email) {
      const userId = crypto.randomUUID();
      const tenantId = crypto.randomUUID();
      const now = new Date().toISOString();
      await c.env.DB.batch([
        c.env.DB.prepare('INSERT INTO tenants (id,name,created_at) VALUES (?,?,?)').bind(tenantId, 'Universidad Francisco de Vitoria', now),
        c.env.DB.prepare('INSERT INTO users (id,email,display_name,created_at) VALUES (?,?,?,?)').bind(userId, email, email, now),
        c.env.DB.prepare('INSERT INTO memberships (tenant_id,user_id,role) VALUES (?,?,?)').bind(tenantId, userId, 'instructor')
      ]);
      row = { id: userId, name: email, role: 'instructor', tenantId };
    }
    return row ? { ...row, email } : null;
  } catch (error) {
    console.warn(JSON.stringify({ code: 'AUTH_REJECTED', message: String(error) }));
    return null;
  }
}
