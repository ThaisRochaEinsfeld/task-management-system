/**
 * middleware/auth.js
 * ---------------------------------------------------------------
 * Protects routes that require a logged-in user.
 *
 * After login the server stores a signed JWT (JSON Web Token) in an
 * HttpOnly cookie called "token". HttpOnly means JavaScript running
 * in the browser cannot read it, which protects it against XSS.
 *
 * This middleware checks that cookie on every protected request and,
 * if it is valid, puts the user's id and name in req.user.
 */
const jwt = require('jsonwebtoken');
const config = require('../config');

const COOKIE_NAME = 'token';

function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) {
    return res.status(401).json({ error: 'You need to log in.' });
  }

  try {
    // jwt.verify checks the signature and the expiration date.
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = { id: payload.sub, name: payload.name };
    return next();
  } catch {
    // Invalid or expired token: remove it and ask for a new login.
    res.clearCookie(COOKIE_NAME);
    return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
  }
}

/** Creates the login cookie for a user. */
function setAuthCookie(res, user) {
  const token = jwt.sign({ sub: user.id, name: user.name }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,               // not readable by browser JavaScript
    secure: config.cookieSecure,  // only sent over HTTPS in production
    sameSite: 'lax',              // basic protection against CSRF
    maxAge: 8 * 60 * 60 * 1000,   // 8 hours, same as the token
  });
}

function clearAuthCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

module.exports = { requireAuth, setAuthCookie, clearAuthCookie };
