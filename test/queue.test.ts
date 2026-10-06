import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it, vi } from 'vitest';
import { applyCommand, createSession, type Actor } from '../shared/engine';
import { EVENT_CATALOG } from '../shared/events';
import type { SimEvent } from '../shared/simulation';
import type { EventMessage } from '../worker/types';

vi.mock('cloudflare:workers', () => ({ DurableObject: class {} }));
const { QUEUE_DETAIL_FIELDS, queueMessages, queueSafeEvent, roomPayload } = await import('../worker/room');
const { default: worker, persistEvent } = await import('../worker/index');

const TENANT = 'tenant-a';
const SESSION = 'session-1';
const instructor: Actor = { id: 'inst-1', name: 'Docente', role: 'instructor' };
const alumna: Actor = { id: 'user-a', name: 'Alumna', role: 'participant' };
const alumno: Actor = { id: 'user-b', name: 'Alumno', role: 'participant' };

// D1 real en memoria (SQLite de Node) con las migraciones del repo y claves foráneas activas, como en D1.
type Bound = { sql: string; args: unknown[] };
function fakeD1() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  for (const file of ['0001_foundation.sql', '0002_scenarios.sql']) db.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  db.prepare('INSERT INTO tenants (id,name,created_at) VALUES (?,?,?)').run(TENANT, 'UFV', '2026-10-06T00:00:00.000Z');
  db.prepare('INSERT INTO sessions (id,tenant_id,instructor_id,scenario_id,scenario_version,status,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(SESSION, TENANT, instructor.id, 'escenario', 1, 'active', '2026-10-06T00:00:00.000Z');
  const run = (item: Bound) => db.prepare(item.sql).run(...(item.args as never[]));
  const make = (sql: string, args: unknown[]): Bound & Record<string, unknown> => ({
    sql, args,
    bind: (...next: unknown[]) => make(sql, next),
    first: async () => db.prepare(sql).get(...(args as never[])) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...(args as never[])) }),
    run: async () => { run({ sql, args }); return { success: true }; }
  });
  const DB = {
    prepare: (sql: string) => make(sql, []),
    batch: async (items: Bound[]) => {
      db.exec('BEGIN');
      try { items.forEach(run); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
      return [];
    }
  };
  return {
    env: { DB } as never,
    status: () => (db.prepare('SELECT status FROM sessions WHERE id = ?').get(SESSION) as { status: string } | undefined)?.status,
    events: () => db.prepare('SELECT seq, type, detail_json AS detail FROM simulation_events WHERE session_id = ? ORDER BY seq').all(SESSION) as { seq: number; type: string; detail: string }[],
    deleteSession: () => { db.prepare('DELETE FROM simulation_events WHERE session_id = ?').run(SESSION); db.prepare('DELETE FROM sessions WHERE id = ?').run(SESSION); }
  };
}

const at = (seq: number) => new Date(Date.UTC(2026, 9, 6, 10, 0, seq)).toISOString();
const ev = (seq: number, type: SimEvent['type'], detail: SimEvent['detail'] = {}): EventMessage =>
  ({ tenantId: TENANT, sessionId: SESSION, event: { seq, type, at: at(seq), actorId: instructor.id, detail } });

/** Entrega un lote al consumidor de la cola y anota qué mensajes reciben ack o retry. */
async function deliver(env: never, bodies: EventMessage[]) {
  const acked: number[] = [];
  const retried: number[] = [];
  const messages = bodies.map(body => ({ body, ack: () => acked.push(body.event.seq), retry: () => retried.push(body.event.seq) }));
  await worker.queue({ messages } as never, env);
  return { acked, retried };
}

describe('redacción de la cola', () => {
  it('has a whitelist entry for every event type in the catalog', () => {
    expect(Object.keys(QUEUE_DETAIL_FIELDS).sort()).toEqual(Object.keys(EVENT_CATALOG).sort());
  });

  it('drops the incident note and keeps riskDelta, without touching the original event', () => {
    const event: SimEvent = { seq: 4, type: 'incident', at: at(4), actorId: instructor.id, detail: { note: 'Llamar a ana@ufv.es', riskDelta: 10 } };
    const safe = queueSafeEvent(event);
    expect(safe.detail).toEqual({ riskDelta: 10, noteRedacted: true });
    expect(event.detail.note).toBe('Llamar a ana@ufv.es');
  });

  it('drops any field outside the whitelist, also on unknown event types', () => {
    expect(queueSafeEvent({ seq: 2, type: 'decision', at: at(2), actorId: 'user-a', detail: { phaseId: 'p1', optionId: 'o1', durationMs: 900, comment: 'texto' } }).detail)
      .toEqual({ phaseId: 'p1', optionId: 'o1', durationMs: 900, commentRedacted: true });
    expect(queueSafeEvent({ seq: 3, type: 'nuevo' as SimEvent['type'], at: at(3), actorId: 'system', detail: { phaseId: 'p1' } }).detail)
      .toEqual({ phaseIdRedacted: true });
  });

  it('keeps the note in the Durable Object state but never in the queue messages', () => {
    let state = createSession(SESSION, TENANT, instructor, at(1));
    state = applyCommand(state, { id: 'cmd-join-a', type: 'join' }, alumna, at(2)).state;
    const result = applyCommand(state, { id: 'cmd-incident', type: 'incident', note: 'Ana García se ha ido', riskDelta: 5 }, instructor, at(3));
    expect(result.state.events.at(-1)?.detail.note).toBe('Ana García se ha ido');
    const messages = queueMessages(result.state, result.state.events);
    const wire = JSON.stringify(messages);
    expect(wire).not.toContain('Ana García');
    expect(wire).not.toContain('Alumna');
    expect(messages.at(-1)?.body.event.detail).toEqual({ riskDelta: 5, noteRedacted: true });
  });

  it('redacts again in the consumer, so old messages with a note do not reach D1', async () => {
    const d1 = fakeD1();
    await deliver(d1.env, [ev(2, 'incident', { note: 'texto libre', riskDelta: 3 })]);
    expect(JSON.parse(d1.events()[0].detail)).toEqual({ riskDelta: 3, noteRedacted: true });
  });
});

describe('consumidor de la cola: idempotencia, orden y sesiones borradas', () => {
  it('does not duplicate an event delivered twice', async () => {
    const d1 = fakeD1();
    const first = await deliver(d1.env, [ev(2, 'paused'), ev(2, 'paused')]);
    await deliver(d1.env, [ev(2, 'paused')]);
    expect(first.acked).toEqual([2, 2]);
    expect(d1.events().map(row => row.seq)).toEqual([2]);
    expect(d1.status()).toBe('paused');
  });

  it('applies pause/resume in seq order even when they arrive reversed', async () => {
    const d1 = fakeD1();
    await deliver(d1.env, [ev(6, 'resumed'), ev(5, 'paused')]);
    expect(d1.status()).toBe('active');
    expect(d1.events().map(row => row.seq)).toEqual([5, 6]);
  });

  it('ignores a retried old pause after a newer resume, even with other events in between', async () => {
    const d1 = fakeD1();
    await deliver(d1.env, [ev(5, 'paused'), ev(6, 'incident', { riskDelta: 1 }), ev(7, 'resumed')]);
    expect(d1.status()).toBe('active');
    await deliver(d1.env, [ev(5, 'paused')]);
    expect(d1.status()).toBe('active');
  });

  it('a non-status event with a higher seq does not block an earlier pause', async () => {
    const d1 = fakeD1();
    await deliver(d1.env, [ev(6, 'incident', { riskDelta: 1 }), ev(5, 'paused')]);
    expect(d1.status()).toBe('paused');
  });

  it('completed is terminal: a late pause or resume does not reopen the session', async () => {
    const d1 = fakeD1();
    await deliver(d1.env, [ev(9, 'completed', { score: 70 }), ev(8, 'resumed'), ev(7, 'paused')]);
    expect(d1.status()).toBe('complete');
  });

  it('acks events of a deleted session instead of retrying forever', async () => {
    const d1 = fakeD1();
    d1.deleteSession();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { acked, retried } = await deliver(d1.env, [ev(3, 'paused'), ev(4, 'completed', { score: 50 })]);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    expect(acked).toEqual([3, 4]);
    expect(retried).toEqual([]);
    expect(d1.events()).toEqual([]);
    expect(await persistEvent(d1.env, ev(5, 'resumed'))).toBe('session-missing');
  });

  it('retries when D1 fails', async () => {
    const env = { DB: { prepare: () => { throw new Error('D1 caído'); } } } as never;
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { acked, retried } = await deliver(env, [ev(2, 'paused')]);
    error.mockRestore();
    expect(acked).toEqual([]);
    expect(retried).toEqual([2]);
  });
});

describe('vista por rol en la sala', () => {
  it('gives the instructor the full state and a participant only their own view', () => {
    let state = createSession(SESSION, TENANT, instructor, at(1));
    state = applyCommand(state, { id: 'cmd-join-a', type: 'join' }, alumna, at(2)).state;
    state = applyCommand(state, { id: 'cmd-join-b', type: 'join' }, alumno, at(3)).state;
    expect(roomPayload(state, instructor, {}).state.participants.map(person => person.userId)).toEqual(['user-a', 'user-b']);
    const view = roomPayload(state, alumna, {}).state;
    expect(view.participants.map(person => person.userId)).toEqual(['user-a']);
    expect(view.processedCommands).toEqual([]);
    expect(JSON.stringify(view)).not.toContain('user-b');
  });

  it('falls back to the restricted view when the actor is missing', () => {
    let state = createSession(SESSION, TENANT, instructor, at(1));
    state = applyCommand(state, { id: 'cmd-join-a', type: 'join' }, alumna, at(2)).state;
    expect(roomPayload(state, undefined, {}).state.participants).toEqual([]);
  });
});
