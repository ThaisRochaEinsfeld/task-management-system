/**
 * routes/tasks.js
 * ---------------------------------------------------------------
 * CRUD of tasks, dashboard statistics and file attachments.
 * Every route requires login, and every query filters by
 * user_id, so a user can never see or change another user's tasks.
 *
 *   GET    /api/tasks?status=all|pending|completed
 *   GET    /api/tasks/stats
 *   POST   /api/tasks                      { title, description, dueDate }
 *   PUT    /api/tasks/:id                  { title, description, dueDate, completed }
 *   DELETE /api/tasks/:id
 *   POST   /api/tasks/:id/attachments      (multipart form, field "file")
 *   GET    /api/tasks/:id/attachments/:attachmentId   -> download
 *   DELETE /api/tasks/:id/attachments/:attachmentId
 */
const express = require('express');
const multer = require('multer');
const { pool } = require('../db');
const logger = require('../logger');
const config = require('../config');
const storage = require('../services/storage');
const metrics = require('../services/metrics');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Uploaded files are kept in memory (max 5 MB) and then sent to S3.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.maxUploadBytes, files: 1 },
});

// ---------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------

/**
 * Validates and normalizes the task fields sent by the browser.
 * Returns { error } or { value }.
 */
function parseTaskInput(body) {
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const dueDate = body.dueDate ? String(body.dueDate) : null;

  if (!title || title.length > 200) {
    return { error: 'The title is required (up to 200 characters).' };
  }
  if (description.length > 2000) {
    return { error: 'The description can have up to 2000 characters.' };
  }
  if (dueDate && !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return { error: 'Invalid due date.' };
  }
  return { value: { title, description: description || null, dueDate } };
}

/** Loads one task, only if it belongs to the logged-in user. */
async function findOwnTask(taskId, userId) {
  const [rows] = await pool.query('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [taskId, userId]);
  return rows[0] || null;
}

/** Converts a database row into the JSON format used by the frontend. */
function toTaskJson(row, attachments = []) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    completed: Boolean(row.completed),
    completedAt: row.completed_at,
    createdAt: row.created_at,
    attachments: attachments.map((a) => ({
      id: a.id,
      name: a.original_name,
      size: a.size_bytes,
    })),
  };
}

// ---------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------

/** List the user's tasks, optionally filtered by status. */
router.get('/', async (req, res, next) => {
  try {
    const status = req.query.status || 'all';
    let sql = 'SELECT * FROM tasks WHERE user_id = ?';
    if (status === 'pending') sql += ' AND completed = FALSE';
    if (status === 'completed') sql += ' AND completed = TRUE';
    // Pending first, then by due date (tasks without date at the end).
    sql += ' ORDER BY completed ASC, due_date IS NULL, due_date ASC, created_at DESC';

    const [tasks] = await pool.query(sql, [req.user.id]);

    // Load the attachments of all listed tasks with a single query.
    let attachments = [];
    if (tasks.length > 0) {
      const ids = tasks.map((t) => t.id);
      [attachments] = await pool.query(
        'SELECT id, task_id, original_name, size_bytes FROM attachments WHERE task_id IN (?) ORDER BY created_at',
        [ids],
      );
    }

    res.json({
      tasks: tasks.map((t) => toTaskJson(t, attachments.filter((a) => a.task_id === t.id))),
    });
  } catch (err) {
    next(err);
  }
});

/** Numbers for the dashboard: total, pending, completed, overdue, % done. */
router.get('/stats', async (req, res, next) => {
  try {
    const [[row]] = await pool.query(
      `SELECT
         COUNT(*)                                              AS total,
         COALESCE(SUM(completed = TRUE), 0)                    AS completed,
         COALESCE(SUM(completed = FALSE), 0)                   AS pending,
         COALESCE(SUM(completed = FALSE AND due_date < CURDATE()), 0) AS overdue
       FROM tasks WHERE user_id = ?`,
      [req.user.id],
    );

    const total = Number(row.total);
    const completed = Number(row.completed);
    res.json({
      total,
      completed,
      pending: Number(row.pending),
      overdue: Number(row.overdue),
      percentCompleted: total === 0 ? 0 : Math.round((completed / total) * 100),
    });
  } catch (err) {
    next(err);
  }
});

/** Create a task. */
router.post('/', async (req, res, next) => {
  try {
    const { error, value } = parseTaskInput(req.body);
    if (error) return res.status(400).json({ error });

    const [result] = await pool.query(
      'INSERT INTO tasks (user_id, title, description, due_date) VALUES (?, ?, ?, ?)',
      [req.user.id, value.title, value.description, value.dueDate],
    );

    const task = await findOwnTask(result.insertId, req.user.id);
    logger.info('Task created', { userId: req.user.id, taskId: task.id });
    metrics.increment('TasksCreated');
    res.status(201).json({ task: toTaskJson(task) });
  } catch (err) {
    next(err);
  }
});

/**
 * Update a task. The body may contain the text fields, the
 * "completed" flag, or both (the checkbox only sends "completed").
 */
router.put('/:id', async (req, res, next) => {
  try {
    const task = await findOwnTask(req.params.id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });

    // Start from the current values and override what was sent.
    let { title, description, due_date: dueDate } = task;
    if (req.body.title !== undefined) {
      const { error, value } = parseTaskInput(req.body);
      if (error) return res.status(400).json({ error });
      ({ title, description, dueDate } = value);
    }

    let completed = Boolean(task.completed);
    if (req.body.completed !== undefined) completed = Boolean(req.body.completed);
    const justCompleted = completed && !task.completed;

    await pool.query(
      `UPDATE tasks
         SET title = ?, description = ?, due_date = ?, completed = ?,
             completed_at = CASE WHEN ? THEN COALESCE(completed_at, NOW()) ELSE NULL END
       WHERE id = ? AND user_id = ?`,
      [title, description, dueDate, completed, completed, task.id, req.user.id],
    );

    if (justCompleted) metrics.increment('TasksCompleted');
    logger.info('Task updated', { userId: req.user.id, taskId: task.id, completed });

    const updated = await findOwnTask(task.id, req.user.id);
    res.json({ task: toTaskJson(updated) });
  } catch (err) {
    next(err);
  }
});

/** Delete a task and its attachments (database rows and S3 files). */
router.delete('/:id', async (req, res, next) => {
  try {
    const task = await findOwnTask(req.params.id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });

    const [attachments] = await pool.query('SELECT storage_key FROM attachments WHERE task_id = ?', [task.id]);
    for (const a of attachments) {
      await storage.remove(a.storage_key);
    }

    // The attachment rows are removed automatically (ON DELETE CASCADE).
    await pool.query('DELETE FROM tasks WHERE id = ? AND user_id = ?', [task.id, req.user.id]);
    logger.info('Task deleted', { userId: req.user.id, taskId: task.id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------
// Attachments (files stored in Amazon S3)
// ---------------------------------------------------------------

/** Upload one file and attach it to the task. */
router.post('/:id/attachments', upload.single('file'), async (req, res, next) => {
  try {
    const task = await findOwnTask(req.params.id, req.user.id);
    if (!task) return res.status(404).json({ error: 'Task not found.' });
    if (!req.file) return res.status(400).json({ error: 'Choose a file to upload.' });

    // Object key inside the bucket, grouped by user and task, e.g.
    // users/3/tasks/12/1731240000000-report.pdf
    const safeName = req.file.originalname.replace(/[^\w.\-]+/g, '_').slice(-100);
    const key = `users/${req.user.id}/tasks/${task.id}/${Date.now()}-${safeName}`;

    await storage.save(key, req.file.buffer, req.file.mimetype);

    const [result] = await pool.query(
      `INSERT INTO attachments (task_id, original_name, storage_key, mime_type, size_bytes)
       VALUES (?, ?, ?, ?, ?)`,
      [task.id, req.file.originalname, key, req.file.mimetype, req.file.size],
    );

    logger.info('Attachment uploaded', { userId: req.user.id, taskId: task.id, bytes: req.file.size });
    metrics.increment('AttachmentsUploaded');
    res.status(201).json({
      attachment: { id: result.insertId, name: req.file.originalname, size: req.file.size },
    });
  } catch (err) {
    next(err);
  }
});

/** Loads one attachment, checking that its task belongs to the user. */
async function findOwnAttachment(taskId, attachmentId, userId) {
  const [rows] = await pool.query(
    `SELECT a.* FROM attachments a
       JOIN tasks t ON t.id = a.task_id
      WHERE a.id = ? AND a.task_id = ? AND t.user_id = ?`,
    [attachmentId, taskId, userId],
  );
  return rows[0] || null;
}

/**
 * Download an attachment. With S3 the browser is redirected to a
 * pre-signed URL that is valid for only 5 minutes, so the bucket
 * itself can stay completely private.
 */
router.get('/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    const attachment = await findOwnAttachment(req.params.id, req.params.attachmentId, req.user.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });
    await storage.sendDownload(res, attachment);
  } catch (err) {
    next(err);
  }
});

/** Remove an attachment. */
router.delete('/:id/attachments/:attachmentId', async (req, res, next) => {
  try {
    const attachment = await findOwnAttachment(req.params.id, req.params.attachmentId, req.user.id);
    if (!attachment) return res.status(404).json({ error: 'Attachment not found.' });

    await storage.remove(attachment.storage_key);
    await pool.query('DELETE FROM attachments WHERE id = ?', [attachment.id]);
    logger.info('Attachment deleted', { userId: req.user.id, attachmentId: attachment.id });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

module.exports = router;
