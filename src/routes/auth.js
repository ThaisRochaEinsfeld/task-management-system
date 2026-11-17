/**
 * routes/auth.js
 * ---------------------------------------------------------------
 * User registration, login, logout and "who am I".
 *
 *   POST /api/auth/register  { name, email, password }
 *   POST /api/auth/login     { email, password }
 *   POST /api/auth/logout
 *   GET  /api/auth/me
 */
const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { pool } = require('../db');
const logger = require('../logger');
const { requireAuth, setAuthCookie, clearAuthCookie } = require('../middleware/auth');

const router = express.Router();

// Limit login/registration attempts per IP to slow down brute-force
// password guessing: at most 20 attempts every 15 minutes.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait a few minutes and try again.' },
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Register a new user and log them in right away. */
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    // --- Input validation ---
    if (!name || name.length > 100) {
      return res.status(400).json({ error: 'Enter your name (up to 100 characters).' });
    }
    if (!EMAIL_REGEX.test(email)) {
      return res.status(400).json({ error: 'Enter a valid email address.' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'The password must have at least 8 characters.' });
    }

    // --- Store only the bcrypt hash of the password (cost factor 10) ---
    const passwordHash = await bcrypt.hash(password, 10);

    // "?" placeholders: mysql2 escapes the values, preventing SQL injection.
    const [result] = await pool.query(
      'INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)',
      [name, email, passwordHash],
    );

    const user = { id: result.insertId, name };
    setAuthCookie(res, user);
    logger.info('User registered', { userId: user.id });
    return res.status(201).json({ user });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'This email is already registered.' });
    }
    return next(err);
  }
});

/** Log in with email and password. */
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');

    const [rows] = await pool.query(
      'SELECT id, name, password_hash FROM users WHERE email = ?',
      [email],
    );
    const user = rows[0];

    // Same message for "unknown email" and "wrong password", so an
    // attacker cannot discover which emails are registered.
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      logger.warn('Failed login attempt', { ip: req.ip });
      return res.status(401).json({ error: 'Incorrect email or password.' });
    }

    setAuthCookie(res, user);
    logger.info('User logged in', { userId: user.id });
    return res.json({ user: { id: user.id, name: user.name } });
  } catch (err) {
    return next(err);
  }
});

/** Log out: just remove the cookie. */
router.post('/logout', (req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

/** Return the logged-in user (used by the frontend on page load). */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
