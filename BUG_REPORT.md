# Bug Report: Task API

Every bug below was found by writing tests that assert the *correct* behavior and
watching them fail against the original code (test names contain `BUG #n`).
Status values used everywhere are the code's real ones: `todo | in_progress | done`.

**Summary:** 11 bugs found, **9 fixed** (1-8 and 11), 2 documented for follow-up (9, 10),
plus a short list of low-severity issues at the end.

## Fixed

### Bug 1: Pagination skips the first page (`taskService.getPaginated`)
- **Expected:** `?page=1&limit=2` returns items 1-2.
- **Actual:** returns items 3-4; page 1 is effectively page 2, and the last page is unreachable/empty.
- **Where / why:** `taskService.js`, `offset = page * limit`. Pages are 1-based (route defaults to `1`), so the offset must be `(page - 1) * limit`.
- **Found by:** test creating 5 tasks and asserting the slice for pages 1-3.
- **Fix:** `(page - 1) * limit`.

### Bug 2: Status filter uses substring matching (`taskService.getByStatus`)
- **Expected:** `?status=do` returns nothing (not a valid status); `?status=done` returns only done tasks.
- **Actual:** `t.status.includes(status)`, so `?status=do` returns todo *and* done, `?status=o` returns everything.
- **Found by:** test filtering with partial strings.
- **Fix:** strict equality `t.status === status`.

### Bug 3: Completing a task resets its priority (`taskService.completeTask`)
- **Expected:** `PATCH /:id/complete` changes only `status` and `completedAt`.
- **Actual:** the code also sets `priority: 'medium'`, so a `high` task silently becomes `medium`. Data loss.
- **Found by:** test creating a `high` task, completing it, asserting priority is unchanged.
- **Fix:** removed the hard-coded priority line.

### Bug 4: `PUT` is a mass-assignment hole (`taskService.update`)
- **Expected:** clients can change only `title`, `description`, `status`, `priority`, `dueDate`. `id`/`createdAt` are immutable, `completedAt` is server-controlled, and `assignee` is only set via `/assign` (which validates it).
- **Actual:** `{ ...existing, ...fields }` spreads the raw body, so a client can `PUT {id: "hacked"}` (breaking every later lookup by the old id), forge `completedAt`, store arbitrary unknown fields, or set an invalid `assignee` (e.g. a number), bypassing the `/assign` validation.
- **Found by:** test PUT-ing `{ id: 'hacked' }`; a later re-review of the code found the wider problem (my first fix only blocked `id`/`createdAt`, which was incomplete).
- **Fix:** an **allow-list** (`UPDATABLE_FIELDS`); anything else in the body is silently ignored.

### Bug 5: Negative / junk `page` and `limit` are accepted (`routes/tasks.js`)
- **Expected:** invalid values fall back to defaults (page 1, limit 10).
- **Actual:** `parseInt(x) || default` only catches `NaN`/`0`; `page=-1` or `limit=-5` pass through and produce a negative slice, returning wrong data.
- **Found by:** test calling `?page=-1&limit=-5`.
- **Fix:** `toPositiveInt()` helper: only positive integers are accepted, otherwise fallback.

### Bug 6: `status` filter silently disables pagination (`routes/tasks.js`)
- **Expected:** `?status=todo&page=2&limit=3` filters *then* paginates.
- **Actual:** the status branch returns early, so `page`/`limit` are ignored and the whole filtered list is returned.
- **Found by:** test combining both params.
- **Fix:** `getPaginated(page, limit, status)` filters then slices.

### Bug 7: Malformed JSON returns 500 instead of 400 (`app.js`)
- **Expected:** `400 Bad Request` with a JSON error. **Actual:** `500 Internal server error`, which wrongly blames the server for a client mistake.
- **Where / why:** `express.json()` raises an error carrying `status = 400`, but the global error handler ignored it and always answered 500.
- **Found by:** manual probing with a broken JSON body; now covered by a test.
- **Fix:** the handler passes 4xx errors through (`Invalid JSON in request body`). Genuine server faults still return a generic 500 that does not leak internals (also tested).

### Bug 8: `completedAt` is inconsistent with `status` (`taskService.js`)
- **Expected:** `completedAt` is set exactly when a task is `done`.
- **Actual (three cases):**
  - `POST {status:'done'}` created a "done" task with `completedAt: null`.
  - `PUT {status:'todo'}` on a completed task left the stale `completedAt` in place, and `PUT {status:'done'}` never set it.
  - Calling `/complete` twice overwrote `completedAt` with the newer time.
- **Found by:** manual probing while re-reviewing; each case is now a test.
- **Fix:** `create` stamps it for done tasks; `update` stamps it when status *changes to* done and clears it when it changes *away from* done (re-sending the same status leaves it alone); `completeTask` is idempotent and keeps the original time.

### Bug 11: `dueDate` validation is too loose (`validators.js`)
- **Expected:** a valid ISO 8601 string (or null). **Actual:** `Date.parse` accepts `"March 5"` (parsed as 2001) and even the number `12` (parsed as 1970). Such tasks were stored and immediately counted as **overdue** in `/tasks/stats`.
- **Found by:** manual probing while re-reviewing.
- **Fix:** a shared `validateDueDate()` requires a *string* matching an ISO 8601 pattern that also parses to a real date; `null`/absent still mean "no due date". Empty string is now rejected too.

## Found but NOT fixed (documented for follow-up)

### Bug 9: Validators skip falsy values (`validators.js`)
- `if (body.status && ...)` and `if (body.priority && ...)` use truthiness, so `status: ""` or `status: null` bypass validation and get stored (the create default only applies to `undefined`).
- Titles are validated with `trim()` but stored untrimmed (`"  padded  "`).
- (`dueDate` no longer has this problem after the Bug 11 fix.)
- **Fix:** check `!== undefined` instead of truthiness; trim before storing.

### Bug 10 (design smell): `findById` returns the live object
- Callers can mutate stored data without going through the service. Low risk today; return a copy if this grows.

### Smaller issues (unfixed, low severity)
- `description` is not validated: an object or number is stored as-is.
- `GET /tasks?status=bogus` returns `200 []` instead of a `400` listing the valid statuses.
- No upper bound on `limit` (`limit=99999999` is accepted).
- A date-only `dueDate` for *today* (`"2026-09-30"`) is parsed as UTC midnight, so it counts as overdue all day.
- Unknown routes return Express's default HTML 404 instead of JSON.
