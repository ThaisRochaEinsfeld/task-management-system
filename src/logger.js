/**
 * logger.js
 * ---------------------------------------------------------------
 * Very small structured logger.
 *
 * Every log line is a JSON object, for example:
 *   {"time":"2026-11-10T12:00:00.000Z","level":"info","message":"Task created","taskId":7}
 *
 * Lines are printed to the console AND appended to a log file.
 * On EC2 the Amazon CloudWatch agent watches that file and sends
 * every line to a CloudWatch Logs group, where we can search them
 * (CloudWatch Logs Insights understands the JSON fields).
 */
const fs = require('fs');
const path = require('path');

// The log file path is read directly from the environment to avoid a
// circular dependency with config.js.
const logFile = process.env.LOG_FILE || 'logs/app.log';
fs.mkdirSync(path.dirname(logFile), { recursive: true });
const stream = fs.createWriteStream(logFile, { flags: 'a' });

function write(level, message, details = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, message, ...details });
  // Errors go to stderr, everything else to stdout.
  (level === 'error' ? console.error : console.log)(line);
  stream.write(line + '\n');
}

module.exports = {
  info: (message, details) => write('info', message, details),
  warn: (message, details) => write('warn', message, details),
  error: (message, details) => write('error', message, details),
};
