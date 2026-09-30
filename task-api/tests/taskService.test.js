/**
 * Unit tests for taskService.js (business logic + in-memory store).
 *
 * These call the service functions DIRECTLY (no HTTP), so a failure here points
 * at the business logic rather than routing/validation.
 *
 * The store is module-level state, so we reset it before every test
 * to keep tests independent of each other (order must never matter).
 *
 * Tests tagged "BUG #n" assert the CORRECT behavior; they failed against the
 * original code and are what exposed the bugs listed in BUG_REPORT.md.
 */
const svc = require('../src/services/taskService');

// Start every test with an empty store.
beforeEach(() => svc._reset());

describe('create / getAll / findById', () => {
  test('create applies defaults and generates id + createdAt', () => {
    const t = svc.create({ title: 'A' });
    expect(t).toMatchObject({
      title: 'A', description: '', status: 'todo', priority: 'medium',
      dueDate: null, completedAt: null,
    });
    expect(t.id).toEqual(expect.any(String));
    expect(new Date(t.createdAt).toString()).not.toBe('Invalid Date');
  });

  test('getAll returns a copy (mutating it does not affect the store)', () => {
    svc.create({ title: 'A' });
    const list = svc.getAll();
    list.pop();
    expect(svc.getAll()).toHaveLength(1);
  });

  test('findById returns the task, or undefined when missing', () => {
    const t = svc.create({ title: 'A' });
    expect(svc.findById(t.id)).toEqual(t);
    expect(svc.findById('nope')).toBeUndefined();
  });
});

describe('getByStatus', () => {
  // Seed one task per status so we can tell exact matches from partial ones.
  beforeEach(() => {
    svc.create({ title: 'a', status: 'todo' });
    svc.create({ title: 'b', status: 'in_progress' });
    svc.create({ title: 'c', status: 'done' });
  });

  test('returns only exact status matches', () => {
    expect(svc.getByStatus('todo').map((t) => t.title)).toEqual(['a']);
    expect(svc.getByStatus('done').map((t) => t.title)).toEqual(['c']);
  });

  // BUG #2: implementation uses String.includes, so partial strings match.
  test('does NOT match on partial status strings (e.g. "do" or "o")', () => {
    expect(svc.getByStatus('do')).toEqual([]);
    expect(svc.getByStatus('progress')).toEqual([]);
  });
});

describe('getPaginated', () => {
  // 5 tasks named t1..t5, created in order, so slices are easy to predict.
  beforeEach(() => {
    for (let i = 1; i <= 5; i++) svc.create({ title: `t${i}` });
  });

  // BUG #1: offset was page * limit (0-based) although API is 1-based.
  test('page 1 returns the first `limit` items', () => {
    expect(svc.getPaginated(1, 2).map((t) => t.title)).toEqual(['t1', 't2']);
  });

  test('page 2 returns the next slice', () => {
    expect(svc.getPaginated(2, 2).map((t) => t.title)).toEqual(['t3', 't4']);
  });

  test('last page may be partial; page past the end is empty', () => {
    expect(svc.getPaginated(3, 2).map((t) => t.title)).toEqual(['t5']);
    expect(svc.getPaginated(4, 2)).toEqual([]);
  });
});

describe('getStats', () => {
  test('counts by status and counts overdue only for non-done tasks', () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    const future = new Date(Date.now() + 86400000).toISOString();
    // Expected: todo=3, in_progress=1, done=1, overdue=2 (only NON-done tasks with a past dueDate).
    svc.create({ title: 'a', status: 'todo', dueDate: past });          // overdue
    svc.create({ title: 'b', status: 'in_progress', dueDate: past });   // overdue
    svc.create({ title: 'c', status: 'done', dueDate: past });          // done => not overdue
    svc.create({ title: 'd', status: 'todo', dueDate: future });        // not overdue
    svc.create({ title: 'e', status: 'todo' });                         // no due date
    expect(svc.getStats()).toEqual({ todo: 3, in_progress: 1, done: 1, overdue: 2 });
  });

  test('empty store returns zeros', () => {
    expect(svc.getStats()).toEqual({ todo: 0, in_progress: 0, done: 0, overdue: 0 });
  });
});

describe('update', () => {
  test('merges fields and returns the updated task', () => {
    const t = svc.create({ title: 'A' });
    const u = svc.update(t.id, { title: 'B', priority: 'high' });
    expect(u).toMatchObject({ id: t.id, title: 'B', priority: 'high' });
    expect(svc.findById(t.id).title).toBe('B');
  });

  test('returns null for unknown id', () => {
    expect(svc.update('nope', { title: 'x' })).toBeNull();
  });

  // BUG #4: the service spreads arbitrary fields, so identity fields can be overwritten.
  test('cannot overwrite id or createdAt', () => {
    const t = svc.create({ title: 'A' });
    const u = svc.update(t.id, { id: 'hacked', createdAt: '2000-01-01T00:00:00.000Z' });
    expect(u.id).toBe(t.id);
    expect(u.createdAt).toBe(t.createdAt);
  });

  // BUG #4 (allow-list): only title/description/status/priority/dueDate are updatable.
  test('ignores server-owned and unknown fields (completedAt, assignee, arbitrary keys)', () => {
    const t = svc.create({ title: 'A' });
    const u = svc.update(t.id, { title: 'B', completedAt: '1999-01-01', assignee: 123, foo: 'bar' });
    expect(u.title).toBe('B');             // allowed field applied
    expect(u.completedAt).toBeNull();      // server-owned: untouched
    expect(u.assignee).toBeNull();         // only /assign may set this
    expect(u).not.toHaveProperty('foo');   // unknown fields are dropped
  });

  test('can set every updatable field', () => {
    const t = svc.create({ title: 'A' });
    const due = '2030-01-01T00:00:00.000Z';
    const u = svc.update(t.id, { title: 'B', description: 'd', status: 'in_progress', priority: 'low', dueDate: due });
    expect(u).toMatchObject({ title: 'B', description: 'd', status: 'in_progress', priority: 'low', dueDate: due });
  });
});

describe('remove', () => {
  test('removes an existing task and returns true', () => {
    const t = svc.create({ title: 'A' });
    expect(svc.remove(t.id)).toBe(true);
    expect(svc.getAll()).toHaveLength(0);
  });
  test('returns false when task does not exist', () => {
    expect(svc.remove('nope')).toBe(false);
  });
});

describe('completeTask', () => {
  test('sets status=done and completedAt', () => {
    const t = svc.create({ title: 'A' });
    const c = svc.completeTask(t.id);
    expect(c.status).toBe('done');
    expect(new Date(c.completedAt).toString()).not.toBe('Invalid Date');
  });

  // BUG #3: completeTask hard-codes priority = 'medium'.
  test('does not change the task priority', () => {
    const t = svc.create({ title: 'A', priority: 'high' });
    expect(svc.completeTask(t.id).priority).toBe('high');
  });

  test('returns null for unknown id', () => {
    expect(svc.completeTask('nope')).toBeNull();
  });
});

// BUG #8: completedAt must always agree with status.
describe('completedAt consistency', () => {
  afterEach(() => jest.useRealTimers());

  test('a task created as "done" gets a completedAt', () => {
    const t = svc.create({ title: 'A', status: 'done' });
    expect(t.completedAt).not.toBeNull();
  });

  test('a task created as "todo" has no completedAt', () => {
    expect(svc.create({ title: 'A' }).completedAt).toBeNull();
  });

  test('update: moving to "done" stamps completedAt', () => {
    const t = svc.create({ title: 'A' });
    expect(svc.update(t.id, { status: 'done' }).completedAt).not.toBeNull();
  });

  test('update: moving away from "done" clears completedAt', () => {
    const t = svc.create({ title: 'A', status: 'done' });
    expect(svc.update(t.id, { status: 'todo' }).completedAt).toBeNull();
  });

  test('update: re-sending the same "done" status keeps the original completedAt', () => {
    jest.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') });
    const t = svc.create({ title: 'A', status: 'done' });
    jest.setSystemTime(new Date('2030-06-01T00:00:00.000Z'));
    expect(svc.update(t.id, { status: 'done' }).completedAt).toBe('2030-01-01T00:00:00.000Z');
  });

  test('update: changing other fields does not touch completedAt', () => {
    const t = svc.create({ title: 'A', status: 'done' });
    expect(svc.update(t.id, { title: 'B' }).completedAt).toBe(t.completedAt);
  });

  test('completeTask is idempotent: second call keeps the ORIGINAL completedAt', () => {
    jest.useFakeTimers({ now: new Date('2030-01-01T00:00:00.000Z') });
    const t = svc.create({ title: 'A' });
    const first = svc.completeTask(t.id);
    jest.setSystemTime(new Date('2030-06-01T00:00:00.000Z'));
    const second = svc.completeTask(t.id);
    expect(first.completedAt).toBe('2030-01-01T00:00:00.000Z');
    expect(second.completedAt).toBe(first.completedAt);
  });
});

describe('assignTask', () => {
  test('stores the assignee and returns the updated task', () => {
    const t = svc.create({ title: 'A' });
    const a = svc.assignTask(t.id, 'Alice');
    expect(a.assignee).toBe('Alice');
    expect(svc.findById(t.id).assignee).toBe('Alice');
  });

  test('returns null for unknown id', () => {
    expect(svc.assignTask('nope', 'Alice')).toBeNull();
  });

  test('new tasks start unassigned (assignee: null)', () => {
    expect(svc.create({ title: 'A' }).assignee).toBeNull();
  });
});
