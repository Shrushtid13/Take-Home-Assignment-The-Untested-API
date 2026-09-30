/**
 * app.js: Express application setup.
 *
 * Responsibilities:
 *  - parse JSON request bodies
 *  - mount the /tasks routes
 *  - provide a last-resort error handler
 *
 * The app is exported (without listening) so Supertest can drive it in tests
 * without opening a real network port.
 */
const express = require('express');
const taskRoutes = require('./routes/tasks');

const app = express();

// Parse `application/json` bodies into req.body.
app.use(express.json());

// All task endpoints live under /tasks (see routes/tasks.js).
app.use('/tasks', taskRoutes);

// Global error handler (must have 4 args so Express treats it as an error handler).
//
// FIX (Bug #7): this used to answer 500 for EVERYTHING, so a client sending
// malformed JSON got "Internal server error" instead of a 400. Errors raised by
// Express/body-parser carry a 4xx `status`; we now pass those through as client
// errors. Anything else is a genuine server fault: log it, but never leak
// internals (stack/message) to the client.
app.use((err, req, res, next) => {
  const status = err.status || err.statusCode || 500;

  if (status >= 400 && status < 500) {
    return res.status(status).json({
      error: err.type === 'entity.parse.failed' ? 'Invalid JSON in request body' : err.message,
    });
  }

  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

// Only start listening when run directly (`npm start`), NOT when imported by tests.
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`Task API running on port ${PORT}`);
  });
}

module.exports = app;
