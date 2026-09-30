/**
 * utils/validators.js: input validation helpers.
 *
 * Each validator returns `null` when the input is valid, or a human-readable
 * error string that the route sends back in a 400 response.
 */

// Allowed enum values; keep in sync with the task shape in the README.
const VALID_STATUSES = ['todo', 'in_progress', 'done'];
const VALID_PRIORITIES = ['low', 'medium', 'high'];

// ISO 8601: "2030-01-31" or "2030-01-31T10:30", optionally with seconds,
// fractional seconds and a "Z" / "+05:30" timezone offset.
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Shared dueDate check for create and update.
 *
 * FIX (Bug #11): the old check was `Date.parse(x)` only, which happily accepts
 * "March 5" (-> 2001) and even the number 12 (-> 1970). Those tasks were stored
 * and then counted as overdue. Now the value must be a STRING in ISO 8601 form
 * that also parses to a real date. `undefined` and `null` mean "no due date".
 *
 * @param {unknown} dueDate
 * @returns {string|null} error message, or null if valid / absent
 */
const validateDueDate = (dueDate) => {
  if (dueDate === undefined || dueDate === null) return null;
  if (typeof dueDate !== 'string' || !ISO_DATE_RE.test(dueDate) || isNaN(Date.parse(dueDate))) {
    return 'dueDate must be a valid ISO date string';
  }
  return null;
};

/**
 * Validate the body of POST /tasks. `title` is required; everything else is optional.
 *
 * KNOWN ISSUE (Bug #9): the optional checks use truthiness (`body.status && ...`),
 * so falsy junk like `status: ""` or `status: null` skips validation entirely.
 * A stricter version would check `!== undefined`.
 *
 * @param {object} body
 * @returns {string|null}
 */
const validateCreateTask = (body) => {
  if (!body.title || typeof body.title !== 'string' || body.title.trim() === '') {
    return 'title is required and must be a non-empty string';
  }
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
    return `priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
  }
  return validateDueDate(body.dueDate);
};

/**
 * Validate the body of PUT /tasks/:id. Every field is optional (partial update),
 * but any field that IS provided must be valid. Same truthiness caveat as above (Bug #9).
 *
 * @param {object} body
 * @returns {string|null}
 */
const validateUpdateTask = (body) => {
  // Here an explicit `title: ""` must be rejected, hence the `!== undefined` check.
  if (body.title !== undefined && (typeof body.title !== 'string' || body.title.trim() === '')) {
    return 'title must be a non-empty string';
  }
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    return `status must be one of: ${VALID_STATUSES.join(', ')}`;
  }
  if (body.priority && !VALID_PRIORITIES.includes(body.priority)) {
    return `priority must be one of: ${VALID_PRIORITIES.join(', ')}`;
  }
  return validateDueDate(body.dueDate);
};

// Upper bound so someone can't store an arbitrarily huge "name".
const MAX_ASSIGNEE_LENGTH = 100;

/**
 * NEW: validate the body of PATCH /tasks/:id/assign.
 *
 * Rules and reasoning:
 *  - must be a string: rejects numbers, null, objects and a missing field
 *  - must be non-empty AFTER trimming: a blank name is not a person, and
 *    accepting it would make "unassigned" ambiguous (null vs "")
 *  - at most 100 characters (measured after trimming, matching what is stored)
 *
 * `body || {}` guards against a missing/undefined body.
 *
 * @param {{assignee?: unknown}} body
 * @returns {string|null}
 */
const validateAssignee = (body) => {
  const { assignee } = body || {};
  if (typeof assignee !== 'string' || assignee.trim() === '') {
    return 'assignee is required and must be a non-empty string';
  }
  if (assignee.trim().length > MAX_ASSIGNEE_LENGTH) {
    return `assignee must be at most ${MAX_ASSIGNEE_LENGTH} characters`;
  }
  return null;
};

module.exports = { validateCreateTask, validateUpdateTask, validateAssignee };
