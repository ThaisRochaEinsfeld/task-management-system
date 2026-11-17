/**
 * db.js
 * ---------------------------------------------------------------
 * Connection to the MySQL database (Amazon RDS in production,
 * a Docker container when running locally).
 *
 * We use a connection *pool*: a few connections are kept open and
 * reused between requests, which is faster than opening a new
 * connection for every query.
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
const config = require('./config');
const logger = require('./logger');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  // Return DATE columns as 'YYYY-MM-DD' strings instead of JS Date
  // objects, avoiding time zone shifts in the browser.
  dateStrings: ['DATE'],
});

/**
 * Creates the tables if they do not exist yet.
 * Retries a few times because, on startup, the database container
 * (or a freshly created RDS instance) may not be ready immediately.
 */
async function initDatabase({ retries = 10, delayMs = 3000 } = {}) {
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  const schema = fs.readFileSync(schemaPath, 'utf8');

  // Split the file into individual statements (separated by ';'),
  // removing comment lines and empty pieces.
  const statements = schema
    .split(';')
    .map((s) => s.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
    .filter(Boolean);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      for (const sql of statements) {
        await pool.query(sql);
      }
      logger.info('Database schema ready', { host: config.db.host, database: config.db.database });
      return;
    } catch (err) {
      logger.warn('Database not ready, retrying', { attempt, error: err.message });
      if (attempt === retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}

module.exports = { pool, initDatabase };
