/**
 * services/taskService.js: business logic and the in-memory data store.
 *
 * The store is a plain module-level array, so data lives only as long as the
 * process does (restart = empty). Because it is shared module state, tests call
 * `_reset()` in `beforeEach` to stay independent of one another.
 *
 * Task shape:
 *   { id, title, description, status: 'todo'|'in_progress'|'done',
 *     priority: 'low'|'medium'|'high', dueDate: ISO|null,
 *     completedAt: ISO|null, assignee: string|null, createdAt: ISO }
 *
 * Functions here assume input has ALREADY been validated by the route layer
 * (see utils/validators.js). They return `null` / `false` / `undefined` for
 * "not found" and leave choosing the HTTP status code to the routes.
 */
const { v4: uuidv4 } = require('uuid');

/** @type {Array<object>} the in-memory "database" */
let tasks = [];

/** @returns {object[]} a shallow COPY of all tasks, so callers can't mutate the store array. */
const getAll = () => [...tasks];

/**
 * @param {string} id
 * @returns {object|undefined} the task, or undefined when it does not exist
 */
const findById = (id) => tasks.find((t) => t.id === id);

/**
 * Tasks whose status matches exactly.
 *
 * FIX (Bug #2): the original used `t.status.includes(status)`, a SUBSTRING match,
 * so `?status=do` returned both "todo" and "done" (and `?status=o` returned
 * everything). Statuses are a fixed enum, so strict equality is correct.
 *
 * @param {string} status
 * @returns {object[]}
 */
const getByStatus = (status) => tasks.filter((t) => t.status === status);

/**
 * One page of tasks, optionally restricted to a status.
 *
 * FIX (Bug #1): pages are 1-based in the API, but the original offset was
 * `page * limit`, which skipped the whole first page (page 1 returned items
 * 3-4 for limit 2). The correct offset is `(page - 1) * limit`.
 *
 * FIX (Bug #6): the optional `status` argument lets filtering and pagination
 * be combined (filter first, then slice).
 *
 * @param {number} page    1-based page number (route guarantees a positive int)
 * @param {number} limit   page size (route guarantees a positive int)
 * @param {string} [status] optional exact-match status filter
 * @returns {object[]}
 */
const getPaginated = (page, limit, status) => {
  const source = status ? getByStatus(status) : tasks;
  const offset = (page - 1) * limit;
  return source.slice(offset, offset + limit);
};

/**
 * Dashboard numbers: how many tasks per status, and how many are overdue.
 * A task is overdue when it has a dueDate in the past AND is not done yet.
 * Tasks with an unknown status are ignored in the per-status counts.
 *
 * @returns {{todo:number, in_progress:number, done:number, overdue:number}}
 */
const getStats = () => {
  const now = new Date();
  const counts = { todo: 0, in_progress: 0, done: 0 };
  let overdue = 0;

  tasks.forEach((t) => {
    if (counts[t.status] !== undefined) counts[t.status]++;
    if (t.dueDate && t.status !== 'done' && new Date(t.dueDate) < now) {
      overdue++;
    }
  });

  return { ...counts, overdue };
};

/**
 * Create and store a task. Missing optional fields get defaults.
 * `id`, `createdAt`, `completedAt` and `assignee` are always server-generated
 * (`completedAt` is set only if the task is created already "done").
 *
 * @param {{title:string, description?:string, status?:string, priority?:string, dueDate?:string|null}} input
 * @returns {object} the stored task
 */
const create = ({ title, description = '', status = 'todo', priority = 'medium', dueDate = null }) => {
  const now = new Date().toISOString();
  const task = {
    id: uuidv4(),
    title,
    description,
    status,
    priority,
    dueDate,
    // FIX (Bug #8): a task created already "done" used to have completedAt: null.
    completedAt: status === 'done' ? now : null,
    assignee: null, // set later via PATCH /tasks/:id/assign
    createdAt: now,
  };
  tasks.push(task);
  return task;
};

// Fields a client is allowed to change through PUT /tasks/:id.
// Everything else is server-owned or has its own endpoint:
//   id, createdAt  -> immutable identity
//   completedAt    -> set by the server (see completeTask)
//   assignee       -> only via PATCH /tasks/:id/assign (which validates it)
const UPDATABLE_FIELDS = ['title', 'description', 'status', 'priority', 'dueDate'];

/**
 * Merge the allowed fields of `fields` into an existing task.
 *
 * FIX (Bug #4): `fields` used to be spread blindly, so a client could send
 * `{ id: "hacked" }` and overwrite server-owned fields. It also allowed forging
 * `completedAt`, storing unknown fields, and setting an unvalidated `assignee`
 * (bypassing the /assign rules). We now use an ALLOW-LIST: only the fields in
 * UPDATABLE_FIELDS are copied, anything else in the body is silently ignored.
 *
 * FIX (Bug #8): `completedAt` is now kept consistent with `status` when the
 * status CHANGES: moving to "done" stamps it, moving away from "done" clears it,
 * and re-sending the same status leaves it untouched.
 *
 * @param {string} id
 * @param {object} fields  already-validated partial task
 * @returns {object|null}  updated task, or null if not found
 */
const update = (id, fields) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  const safeFields = {};
  UPDATABLE_FIELDS.forEach((key) => {
    if (fields[key] !== undefined) safeFields[key] = fields[key];
  });
  const previous = tasks[index];
  const updated = { ...previous, ...safeFields };

  if (safeFields.status !== undefined && safeFields.status !== previous.status) {
    updated.completedAt = safeFields.status === 'done' ? new Date().toISOString() : null;
  }

  tasks[index] = updated;
  return updated;
};

/**
 * Delete a task.
 * @param {string} id
 * @returns {boolean} true if a task was removed, false if it did not exist
 */
const remove = (id) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return false;

  tasks.splice(index, 1);
  return true;
};

/**
 * Mark a task done and record when.
 *
 * FIX (Bug #3): the original also forced `priority: 'medium'`, silently
 * downgrading e.g. a "high" task on completion. Only `status` and `completedAt`
 * should change.
 *
 * FIX (Bug #8): completing an already-done task used to overwrite the original
 * completedAt with the newer time. It is now idempotent: a done task is returned
 * unchanged, keeping its ORIGINAL completion time.
 *
 * @param {string} id
 * @returns {object|null} updated task, or null if not found
 */
const completeTask = (id) => {
  const task = findById(id);
  if (!task) return null;
  if (task.status === 'done') return task;

  const updated = {
    ...task,
    status: 'done',
    completedAt: new Date().toISOString(),
  };

  const index = tasks.findIndex((t) => t.id === id);
  tasks[index] = updated;
  return updated;
};

/**
 * NEW FEATURE: assign a task to a person.
 * The caller (route) has already validated and trimmed `assignee`.
 * Overwrites any existing assignee (reassignment is allowed).
 *
 * @param {string} id
 * @param {string} assignee
 * @returns {object|null} updated task, or null if not found
 */
const assignTask = (id, assignee) => {
  const index = tasks.findIndex((t) => t.id === id);
  if (index === -1) return null;

  tasks[index] = { ...tasks[index], assignee };
  return tasks[index];
};

/** Test helper: empties the store. Not used by the app itself. */
const _reset = () => {
  tasks = [];
};

module.exports = {
  getAll,
  findById,
  getByStatus,
  getPaginated,
  getStats,
  create,
  update,
  remove,
  completeTask,
  assignTask,
  _reset,
};
