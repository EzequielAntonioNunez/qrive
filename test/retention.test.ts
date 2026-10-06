import { describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
const { applyRetention } = await import('../worker/app');

// D1 mínimo en memoria: suficiente para comprobar qué consultas lanza la retención.
function fakeEnv(days?: string) {
  const executed: { sql: string; args: unknown[] }[] = [];
  const statement = (sql: string) => ({
    bind: (...args: unknown[]) => ({
      sql, args,
      all: async () => { executed.push({ sql, args }); return { results: sql.startsWith('SELECT') ? [{ id: 'old-session', tenantId: 'tenant-a' }] : [] }; },
      run: async () => { executed.push({ sql, args }); return {}; }
    })
  });
  const purged: string[] = [];
  const env = {
    RETENTION_DAYS: days,
    DB: { prepare: statement, batch: async (items: { sql: string; args: unknown[] }[]) => { executed.push(...items); return []; } },
    SESSIONS: { idFromName: (name: string) => name, get: (name: string) => ({ fetch: async () => { purged.push(name); return Response.json({ purged: true }); } }) }
  };
  return { env: env as never, executed, purged };
}

describe('data retention', () => {
  it('deletes completed sessions older than the configured window and audits each deletion', async () => {
    const { env, executed, purged } = fakeEnv('30');
    const deleted = await applyRetention(env, new Date('2026-10-06T00:00:00.000Z'));
    expect(deleted).toBe(1);
    expect(executed[0].args).toEqual(['2026-09-06T00:00:00.000Z']);
    expect(purged).toEqual(['tenant-a:old-session']);
    expect(executed.some(item => item.sql.startsWith('DELETE FROM simulation_events'))).toBe(true);
    expect(executed.some(item => item.sql.startsWith('DELETE FROM sessions'))).toBe(true);
    expect(executed.find(item => item.sql.startsWith('INSERT INTO audit_log'))?.args).toContain('session_retention_deleted');
  });

  it('falls back to 365 days when the setting is missing or invalid', async () => {
    const { env, executed } = fakeEnv('abc');
    await applyRetention(env, new Date('2026-10-06T00:00:00.000Z'));
    expect(executed[0].args).toEqual(['2025-10-06T00:00:00.000Z']);
  });
});
