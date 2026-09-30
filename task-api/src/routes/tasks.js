/**
 * routes/tasks.js: HTTP layer for the Task API.
 *
 * Routes only deal with HTTP concerns (parse input, validate, pick a status
 * code). All business logic and data access live in services/taskService.js,
 * and all input validation rules live in utils/validators.js.
 */
const express = require('express');
const router = express.Router();
const taskService = require('../services/taskService');
const { validateCreateTask, validateUpdateTask, validateAssignee } = require('../utils/validators');

/**
 * GET /tasks/stats
 * Returns the number of tasks per status plus the number of overdue tasks.
 * NOTE: must be declared BEFORE any `/:id` route, otherwise Express would treat
 * the word "stats" as an id.
 */
router.get('/stats', (req, res) => {
  const stats = taskService.getStats();
  res.json(stats);
});

/**
 * Parse a query-string value as a positive integer, or return `fallback`.
 *
 * FIX (Bug #5): the original code used `parseInt(x) || default`, which only
 * protects against NaN/0. Negative values (page=-1) slipped through and produced
 * a negative slice offset, i.e. wrong results.
 *
 * @param {string|undefined} value  raw query param
 * @param {number} fallback         value to use when `value` is not a positive int
 * @returns {number}
 */
const toPositiveInt = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

/**
 * GET /tasks
 * Query params (all optional):
 *   ?status=todo|in_progress|done   exact-match status filter
 *   ?page=1&limit=10                1-based pagination (defaults: page 1, limit 10)
 * Filtering and pagination can be combined.
 */
router.get('/', (req, res) => {
  const { status, page, limit } = req.query;

  // FIX (Bug #6): the status branch used to `return` early and silently ignore
  // page/limit. Pagination is now checked first and receives the status filter,
  // so `?status=todo&page=2&limit=3` filters THEN paginates.
  if (page !== undefined || limit !== undefined) {
    const tasks = taskService.getPaginated(toPositiveInt(page, 1), toPositiveInt(limit, 10), status);
    return res.json(tasks);
  }

  const tasks = status ? taskService.getByStatus(status) : taskService.getAll();
  res.json(tasks);
});

/**
 * POST /tasks
 * Body: { title (required), description?, status?, priority?, dueDate? }
 * 201 with the created task, or 400 with { error } if validation fails.
 */
router.post('/', (req, res) => {
  const error = validateCreateTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.create(req.body);
  res.status(201).json(task);
});

/**
 * PUT /tasks/:id
 * Updates the provided fields of a task (behaves as a partial update, not a
 * strict full replace; see "questions before production" in SUBMISSION_NOTES.md).
 * 400 invalid body, 404 unknown id, 200 with the updated task.
 */
router.put('/:id', (req, res) => {
  const error = validateUpdateTask(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.update(req.params.id, req.body);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

/**
 * DELETE /tasks/:id
 * 204 (no body) on success, 404 if the task does not exist.
 */
router.delete('/:id', (req, res) => {
  const deleted = taskService.remove(req.params.id);
  if (!deleted) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.status(204).send();
});

/**
 * PATCH /tasks/:id/complete
 * Marks a task as done and stamps `completedAt`. 404 if the task does not exist.
 */
router.patch('/:id/complete', (req, res) => {
  const task = taskService.completeTask(req.params.id);
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

/**
 * PATCH /tasks/:id/assign        (NEW FEATURE)
 * Body: { "assignee": "string" }
 *
 * Responses:
 *   200  updated task (with `assignee` set)
 *   400  assignee missing / not a string / blank / too long
 *   404  task does not exist
 *
 * Design decisions:
 *  - The body is validated BEFORE the task lookup, so a malformed request is
 *    always a 400 regardless of whether the id exists.
 *  - The name is trimmed before storing ("  Bob " -> "Bob").
 *  - Re-assigning an already-assigned task is ALLOWED and overwrites the old
 *    assignee (reassignment/handover is a normal workflow). It is idempotent:
 *    assigning the same name twice is not an error. If the product wants to
 *    forbid it, change this to a 409 Conflict.
 */
router.patch('/:id/assign', (req, res) => {
  const error = validateAssignee(req.body);
  if (error) {
    return res.status(400).json({ error });
  }

  const task = taskService.assignTask(req.params.id, req.body.assignee.trim());
  if (!task) {
    return res.status(404).json({ error: 'Task not found' });
  }

  res.json(task);
});

module.exports = router;
