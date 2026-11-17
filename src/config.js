/**
 * config.js
 * ---------------------------------------------------------------
 * Central place for every configuration value of the application.
 * Values come from environment variables (or from the .env file),
 * so the same code runs locally and on AWS without changes.
 */
require('dotenv').config();

/**
 * Reads a required environment variable and stops the app with a
 * clear message if it is missing (fail fast instead of failing later).
 */
function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const config = {
  port: Number(process.env.PORT) || 3000,

  // Authentication
  jwtSecret: required('JWT_SECRET'),
  jwtExpiresIn: '8h',
  cookieSecure: process.env.COOKIE_SECURE === 'true',

  // Amazon RDS (MySQL)
  db: {
    host: required('DB_HOST'),
    port: Number(process.env.DB_PORT) || 3306,
    user: required('DB_USER'),
    password: required('DB_PASSWORD'),
    database: required('DB_NAME'),
  },

  // AWS (S3 + CloudWatch). On EC2 the credentials come from the
  // instance role (LabInstanceProfile), never from the code.
  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    s3Bucket: process.env.S3_BUCKET || '',
    cloudwatchMetrics: process.env.CLOUDWATCH_METRICS === 'true',
    cloudwatchNamespace: process.env.CLOUDWATCH_NAMESPACE || 'TaskManagementSystem',
  },

  // Logging
  logFile: process.env.LOG_FILE || 'logs/app.log',

  // Attachments
  maxUploadBytes: 5 * 1024 * 1024, // 5 MB per file
};

module.exports = config;
