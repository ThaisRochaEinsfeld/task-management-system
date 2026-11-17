/**
 * services/metrics.js
 * ---------------------------------------------------------------
 * Custom business metrics sent to Amazon CloudWatch, for example
 * how many tasks were created or completed.
 *
 * CloudWatch already collects infrastructure metrics on its own
 * (CPU, network, disk of the EC2 instance). These custom metrics show
 * how the APPLICATION is being used, and they appear in the console
 * under Metrics > Custom namespaces > TaskManagementSystem.
 *
 * To avoid one API call per action, counts are kept in memory and
 * sent together once per minute.
 *
 * Enabled only when CLOUDWATCH_METRICS=true (on AWS). Locally the
 * functions do nothing, so the app runs without AWS credentials.
 */
const { CloudWatchClient, PutMetricDataCommand } = require('@aws-sdk/client-cloudwatch');
const config = require('../config');
const logger = require('../logger');

const enabled = config.aws.cloudwatchMetrics;
const client = enabled ? new CloudWatchClient({ region: config.aws.region }) : null;
const FLUSH_INTERVAL_MS = 60 * 1000;

// Pending counts, e.g. { TasksCreated: 3, TasksCompleted: 1 }
let counters = {};

/** Adds 1 (or `value`) to a metric. */
function increment(name, value = 1) {
  if (!enabled) return;
  counters[name] = (counters[name] || 0) + value;
}

/** Sends the accumulated counts to CloudWatch and resets them. */
async function flush() {
  const names = Object.keys(counters);
  if (!enabled || names.length === 0) return;

  const toSend = counters;
  counters = {};

  try {
    await client.send(new PutMetricDataCommand({
      Namespace: config.aws.cloudwatchNamespace,
      MetricData: names.map((name) => ({
        MetricName: name,
        Value: toSend[name],
        Unit: 'Count',
        Timestamp: new Date(),
      })),
    }));
  } catch (err) {
    // Monitoring problems must never break the application itself.
    logger.warn('Could not send metrics to CloudWatch', { error: err.message });
  }
}

if (enabled) {
  // unref(): this timer alone does not keep the process running.
  setInterval(flush, FLUSH_INTERVAL_MS).unref();
  logger.info('CloudWatch custom metrics enabled', { namespace: config.aws.cloudwatchNamespace });
}

module.exports = { increment, flush };
