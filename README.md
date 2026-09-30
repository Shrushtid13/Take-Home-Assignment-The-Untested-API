# Take-Home Assignment — The Untested API

A 2-day take-home assignment. You'll read unfamiliar code, write tests, track down bugs, and ship a small feature.

Read **[ASSIGNMENT.md](./ASSIGNMENT.md)** for the full brief before you start.

---

## A note on AI tools

You're welcome to use AI tools. What we're evaluating is your ability to read and reason about unfamiliar code — so your submission should reflect your own understanding, not just generated output.

Concretely:
- For each bug you report: include where in the code it lives and why it happens
- For the feature you implement: briefly explain the design decisions you made
- If something surprised you or you had to make a tradeoff, say so

---

## Getting Started

**Prerequisites:** Node.js 18+

```bash
cd task-api
npm install
npm start        # runs on http://localhost:3000
```

**Tests:**

```bash
npm test           # run test suite
npm run coverage   # run with coverage report
```

---

## Project Structure

```
task-api/
  src/
    app.js                  # Express app setup
    routes/tasks.js         # Route handlers
    services/taskService.js # Business logic + in-memory data store
    utils/validators.js     # Input validation helpers
  tests/                    # Your tests go here
  package.json
  jest.config.js
ASSIGNMENT.md               # Full brief — read this first
```

> The data store is in-memory. It resets every time the server restarts.

---

## API Reference

| Method   | Path                      | Description                              |
|----------|---------------------------|------------------------------------------|
| `GET`    | `/tasks`                  | List all tasks. Supports `?status=`, `?page=`, `?limit=` |
| `POST`   | `/tasks`                  | Create a new task                        |
| `PUT`    | `/tasks/:id`              | Full update of a task                    |
| `DELETE` | `/tasks/:id`              | Delete a task (returns 204)              |
| `PATCH`  | `/tasks/:id/complete`     | Mark a task as complete                  |
| `GET`    | `/tasks/stats`            | Counts by status + overdue count         |
| `PATCH`  | `/tasks/:id/assign`       | **Assign a task to a user** _(to implement)_ |

### Task shape

```json
{
  "id": "uuid",
  "title": "string",
  "description": "string",
  "status": "pending | in-progress | completed",
  "priority": "low | medium | high",
  "dueDate": "ISO 8601 or null",
  "completedAt": "ISO 8601 or null",
  "createdAt": "ISO 8601",
  "assignee": "string or null   (added by PATCH /tasks/:id/assign)"
}
```

### Sample requests

**Create a task**
```bash
curl -X POST http://localhost:3000/tasks \
  -H "Content-Type: application/json" \
  -d '{"title": "Write tests", "priority": "high"}'
```

**List tasks with filter**
```bash
curl "http://localhost:3000/tasks?status=pending&page=1&limit=10"
```

**Mark complete**
```bash
curl -X PATCH http://localhost:3000/tasks/<id>/complete
```

---

## What to Submit

See [ASSIGNMENT.md](./ASSIGNMENT.md) for full submission requirements. At minimum, include:

- **Test files** — covering the endpoints and edge cases you identified
- **Bug report** — what you found, where in the code, and why it's a bug (not just symptoms)
- **At least one fix** — with a note on your approach
- **`PATCH /tasks/:id/assign` implementation** — plus a short explanation of any design decisions (validation, edge cases, etc.)


---

## Submission Overview (candidate notes)

[![CI](https://github.com/Shrushtid13/Take-Home-Assignment-The-Untested-API/actions/workflows/ci.yml/badge.svg)](https://github.com/Shrushtid13/Take-Home-Assignment-The-Untested-API/actions/workflows/ci.yml)

| Deliverable | Location |
| --- | --- |
| Unit tests (service + validators) | `task-api/tests/taskService.test.js`, `task-api/tests/validators.test.js` |
| Integration tests (Supertest) | `task-api/tests/tasks.routes.test.js` |
| Coverage | 98.84% statements / 96.46% branches, 97 tests (run `npm run coverage`) |
| Bug report (11 bugs + smaller issues, 9 fixed) | [`BUG_REPORT.md`](BUG_REPORT.md) |
| Fixes | commented `FIX (Bug #n)` in `src/services/taskService.js`, `src/routes/tasks.js`, `src/utils/validators.js`, `src/app.js` |
| CI | [`.github/workflows/ci.yml`](.github/workflows/ci.yml): runs tests + coverage on Node 18 and 20 |
| New endpoint `PATCH /tasks/:id/assign` | `src/routes/tasks.js`, `src/services/taskService.js`, `src/utils/validators.js` |
| Design notes, next steps, production questions | [`SUBMISSION_NOTES.md`](SUBMISSION_NOTES.md) |

Note: the status values used by the code (and therefore the tests) are `todo | in_progress | done`.
The original README table above lists `pending | in-progress | completed`, which does not match the code.

### Example: assign a task
```
curl -X PATCH http://localhost:3000/tasks/<id>/assign \
  -H "Content-Type: application/json" \
  -d '{"assignee": "Alice"}'
```
