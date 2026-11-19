/**
 * server.js
 * ---------------------------------------------------------------
 * Entry point of the Task Management System.
 *
 * Starts an Express web server that:
 *   1. serves the frontend (HTML, CSS and JS in /public);
 *   2. exposes a JSON API under /api (authentication and tasks);
 *   3. writes structured logs that the CloudWatch agent ships to AWS.
 *
 * Run with:  npm start
 */
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const multer = require('multer');

const config = require('./config');
const logger = require('./logger');
const { pool, initDatabase } = require('./db');
const metrics = require('./services/metrics');
const authRoutes = require('./routes/auth');
const taskRoutes = require('./routes/tasks');

const app = express();

// Behind Apache (reverse proxy) the real client IP arrives in X-Forwarded-For.
// Trusting one proxy hop makes req.ip (used by the rate limiter) correct.
app.set('trust proxy', 1);

// ---------------------------------------------------------------
// Security and parsing middleware
// ---------------------------------------------------------------

// helmet sets safe HTTP headers (Content-Security-Policy,
// X-Content-Type-Options, X-Frame-Options, etc.).
app.use(helmet({
  // The pages are served over HTTP during local tests, so we do not
  // force the browser to upgrade requests to HTTPS here; Apache
  // takes care of HTTPS in production.
  contentSecurityPolicy: {
    directives: { upgradeInsecureRequests: null },
  },
}));

app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());

// Log every API request with its status code and duration.
app.use('/api', (req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    logger.info('HTTP request', {
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start,
    });
  });
  next();
});

// ---------------------------------------------------------------
// Routes
// ---------------------------------------------------------------

// Health check used by monitoring.
// It also checks that the database answers.
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (err) {
    logger.error('Health check failed', { error: err.message });
    res.status(503).json({ status: 'database unavailable' });
  }
});

app.use('/api/auth', authRoutes);
app.use('/api/tasks', taskRoutes);

// Unknown API routes return JSON instead of an HTML page.
app.use('/api', (req, res) => res.status(404).json({ error: 'Route not found.' }));

// Static frontend files (index.html = login page, app.html = tasks).
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---------------------------------------------------------------
// Error handler (must be the last middleware)
// ---------------------------------------------------------------
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  // File larger than the allowed limit.
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'The file is larger than 5 MB.' });
  }
  // Invalid JSON in the request body.
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid request body.' });
  }

  // Anything else is an unexpected error: log the details for us,
  // but show only a generic message to the user.
  logger.error('Unhandled error', { path: req.originalUrl, error: err.message, stack: err.stack });
  metrics.increment('ServerErrors');
  return res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

// ---------------------------------------------------------------
// Startup
// ---------------------------------------------------------------
async function start() {
  await initDatabase();
  const server = app.listen(config.port, () => {
    logger.info('Server started', { port: config.port });
  });

  // Graceful shutdown (e.g. "systemctl stop"): stop accepting
  // requests, send the last metrics and close the database pool.
  const shutdown = async (signal) => {
    logger.info('Shutting down', { signal });
    server.close();
    await metrics.flush();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

start().catch((err) => {
  logger.error('Failed to start the server', { error: err.message });
  process.exit(1);
});
