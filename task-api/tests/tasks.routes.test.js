/**
 * Integration tests for the HTTP layer (Supertest against the Express app).
 *
 * These go through the real Express routing, JSON parsing and validation, and
 * assert only observable behavior (status codes + response bodies), NOT how the
 * service is implemented. Supertest drives the app in-process, so no port is
 * opened and no server needs to be running.
 *
 * Tests tagged "BUG #n" assert the CORRECT behavior; they failed against the
 * original code (see BUG_REPORT.md).
 */
const request = require('supertest');
const app = require('../src/app');
const svc = require('../src/services/taskService');

// Reset the shared in-memory store so tests don't leak state into each other.
beforeEach(() => svc._reset());

// Helper: POST a task with sensible defaults; override any field per test.
const make = (body = {}) => request(app).post('/tasks').send({ title: 'T', ...body });

describe('POST /tasks', () => {
  test('201 + created task', async () => {
    const res = await make({ priority: 'high' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'T', priority: 'high', status: 'todo' });
  });
  test('400 on missing title', async () => {
    const res = await request(app).post('/tasks').send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/title/);
  });
  test('400 on invalid status / priority / dueDate', async () => {
    expect((await make({ status: 'x' })).status).toBe(400);
    expect((await make({ priority: 'x' })).status).toBe(400);
    expect((await make({ dueDate: 'x' })).status).toBe(400);
  });
  // BUG #11: loose dates like "March 5" or 12 used to be stored (and then counted as overdue).
  test('400 on non-ISO dueDate such as "March 5" or a number (BUG #11)', async () => {
    expect((await make({ dueDate: 'March 5' })).status).toBe(400);
    expect((await make({ dueDate: 12 })).status).toBe(400);
  });
  // BUG #8: a task created as done must record when it was completed.
  test('a task created with status "done" gets completedAt (BUG #8)', async () => {
    const res = await make({ status: 'done' });
    expect(res.body.completedAt).not.toBeNull();
  });
});

describe('error handling', () => {
  // BUG #7: malformed JSON is the CLIENT's fault -> 400, not 500.
  test('malformed JSON body returns 400 with a JSON error (BUG #7)', async () => {
    const res = await request(app)
      .post('/tasks')
      .set('Content-Type', 'application/json')
      .send('{"title": bad json');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Invalid JSON in request body' });
  });

  // A genuine server fault must still be a 500 that does NOT leak internals.
  test('unexpected server errors return a generic 500 without leaking details', async () => {
    const boom = jest.spyOn(svc, 'getAll').mockImplementation(() => {
      throw new Error('secret internal detail');
    });
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get('/tasks');
    boom.mockRestore();
    log.mockRestore();
    expect(res.status).toBe(500);
    expect(res.body).toEqual({ error: 'Internal server error' });
  });
});

describe('GET /tasks', () => {
  test('returns all tasks', async () => {
    await make({ title: 'a' }); await make({ title: 'b' });
    const res = await request(app).get('/tasks');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('filters by exact status', async () => {
    await make({ title: 'a', status: 'todo' });
    await make({ title: 'b', status: 'done' });
    const res = await request(app).get('/tasks?status=done');
    expect(res.body.map((t) => t.title)).toEqual(['b']);
  });

  test('status filter does not do substring matching (BUG #2)', async () => {
    await make({ status: 'todo' });
    await make({ status: 'done' });
    const res = await request(app).get('/tasks?status=do');
    expect(res.body).toEqual([]);
  });

  // 5 tasks with limit 2 => page1 = t1,t2 and page2 = t3,t4. The original code returned t3,t4 for page 1.
  test('pagination: page 1 is the first page (BUG #1)', async () => {
    for (let i = 1; i <= 5; i++) await make({ title: `t${i}` });
    const p1 = await request(app).get('/tasks?page=1&limit=2');
    const p2 = await request(app).get('/tasks?page=2&limit=2');
    expect(p1.body.map((t) => t.title)).toEqual(['t1', 't2']);
    expect(p2.body.map((t) => t.title)).toEqual(['t3', 't4']);
  });

  // Negative and non-numeric values must not crash or return odd slices; they fall back to page 1 / limit 10.
  test('pagination falls back to defaults for junk / non-positive values (BUG #5)', async () => {
    for (let i = 1; i <= 3; i++) await make({ title: `t${i}` });
    const res = await request(app).get('/tasks?page=-1&limit=-5');
    expect(res.status).toBe(200);
    expect(res.body.map((t) => t.title)).toEqual(['t1', 't2', 't3']);
    const res2 = await request(app).get('/tasks?page=abc&limit=xyz');
    expect(res2.body).toHaveLength(3);
  });

  // 4 todo + 1 done: filtering todo with limit 3 gives page1=[t1,t2,t3], page2=[t4]. Done tasks must not appear.
  test('status filter can be combined with pagination (BUG #6)', async () => {
    for (let i = 1; i <= 4; i++) await make({ title: `t${i}`, status: 'todo' });
    await make({ title: 'd', status: 'done' });
    const res = await request(app).get('/tasks?status=todo&page=2&limit=3');
    expect(res.body.map((t) => t.title)).toEqual(['t4']);
  });
});

describe('PUT /tasks/:id', () => {
  test('updates a task', async () => {
    const { body: t } = await make();
    const res = await request(app).put(`/tasks/${t.id}`).send({ title: 'New', status: 'in_progress' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, title: 'New', status: 'in_progress' });
  });
  test('404 for unknown id', async () => {
    expect((await request(app).put('/tasks/nope').send({ title: 'x' })).status).toBe(404);
  });
  test('400 on invalid body', async () => {
    const { body: t } = await make();
    expect((await request(app).put(`/tasks/${t.id}`).send({ title: '' })).status).toBe(400);
  });
  // BUG #8: changing status through PUT must keep completedAt in sync.
  test('PUT status done stamps completedAt, and moving back to todo clears it (BUG #8)', async () => {
    const { body: t } = await make();
    const done = await request(app).put(`/tasks/${t.id}`).send({ status: 'done' });
    expect(done.body.completedAt).not.toBeNull();
    const back = await request(app).put(`/tasks/${t.id}`).send({ status: 'todo' });
    expect(back.body.completedAt).toBeNull();
  });
  test('cannot overwrite id via body (BUG #4)', async () => {
    const { body: t } = await make();
    const res = await request(app).put(`/tasks/${t.id}`).send({ id: 'hacked' });
    expect(res.body.id).toBe(t.id);
  });
  // PUT must not be a back door around /assign's validation or a way to forge completedAt.
  test('ignores assignee, completedAt and unknown fields sent via PUT (BUG #4)', async () => {
    const { body: t } = await make();
    const res = await request(app)
      .put(`/tasks/${t.id}`)
      .send({ title: 'New', assignee: 12345, completedAt: '1999-01-01', foo: 'bar' });
    expect(res.status).toBe(200);
    expect(res.body.title).toBe('New');
    expect(res.body.assignee).toBeNull();
    expect(res.body.completedAt).toBeNull();
    expect(res.body).not.toHaveProperty('foo');
  });
});

describe('DELETE /tasks/:id', () => {
  test('204 then task is gone', async () => {
    const { body: t } = await make();
    expect((await request(app).delete(`/tasks/${t.id}`)).status).toBe(204);
    expect((await request(app).get('/tasks')).body).toHaveLength(0);
  });
  test('404 for unknown id', async () => {
    expect((await request(app).delete('/tasks/nope')).status).toBe(404);
  });
});

describe('PATCH /tasks/:id/complete', () => {
  test('marks done and sets completedAt', async () => {
    const { body: t } = await make();
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('done');
    expect(res.body.completedAt).not.toBeNull();
  });
  test('keeps the original priority (BUG #3)', async () => {
    const { body: t } = await make({ priority: 'high' });
    const res = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(res.body.priority).toBe('high');
  });
  test('404 for unknown id', async () => {
    expect((await request(app).patch('/tasks/nope/complete')).status).toBe(404);
  });
  // BUG #8: completing twice must not move the completion time forward.
  test('completing twice keeps the original completedAt (BUG #8)', async () => {
    const { body: t } = await make();
    const first = await request(app).patch(`/tasks/${t.id}/complete`);
    await new Promise((r) => setTimeout(r, 15));
    const second = await request(app).patch(`/tasks/${t.id}/complete`);
    expect(second.body.completedAt).toBe(first.body.completedAt);
  });
});

describe('GET /tasks/stats', () => {
  test('returns counts and overdue', async () => {
    const past = new Date(Date.now() - 86400000).toISOString();
    await make({ status: 'todo', dueDate: past });
    await make({ status: 'done' });
    const res = await request(app).get('/tasks/stats');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ todo: 1, in_progress: 0, done: 1, overdue: 1 });
  });
});

// Tests for the new endpoint. Each of the design decisions (trim, 400 vs 404,
// reassignment allowed) is pinned down by a test so it can't change silently.
describe('PATCH /tasks/:id/assign', () => {
  test('assigns and returns the updated task', async () => {
    const { body: t } = await make();
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: t.id, assignee: 'Alice' });
  });
  test('trims whitespace around the name', async () => {
    const { body: t } = await make();
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: '  Bob  ' });
    expect(res.body.assignee).toBe('Bob');
  });
  test('404 when task does not exist', async () => {
    const res = await request(app).patch('/tasks/nope/assign').send({ assignee: 'Alice' });
    expect(res.status).toBe(404);
  });
  test.each([[{}], [{ assignee: '' }], [{ assignee: '   ' }], [{ assignee: 5 }], [{ assignee: null }]])(
    '400 for invalid body %j', async (body) => {
      const { body: t } = await make();
      expect((await request(app).patch(`/tasks/${t.id}/assign`).send(body)).status).toBe(400);
    });
  // Design decision: reassignment is allowed and simply overwrites (not a 409).
  test('reassigning an already-assigned task overwrites the assignee (200)', async () => {
    const { body: t } = await make();
    await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    const res = await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Bob' });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe('Bob');
  });
  test('assignee persists and shows up in GET /tasks', async () => {
    const { body: t } = await make();
    await request(app).patch(`/tasks/${t.id}/assign`).send({ assignee: 'Alice' });
    expect((await request(app).get('/tasks')).body[0].assignee).toBe('Alice');
  });
});
