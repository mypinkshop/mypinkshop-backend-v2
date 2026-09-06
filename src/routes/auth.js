// src/routes/auth.js
import { Hono } from 'hono';
import { signJWT, verifyJWT } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { ok, fail, genId } from '../lib/utils.js';

const auth = new Hono();

/* --------------------------------------------------------------------- */
/* Middleware                                                             */
/* --------------------------------------------------------------------- */

/**
 * authMiddleware
 * Reads `Authorization: Bearer <token>`, verifies the JWT, and attaches
 * the decoded payload to the request context as c.get('user').
 * Responds 401 if the token is missing or invalid.
 */
export async function authMiddleware(c, next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;

  if (!token) {
    return fail(c, 'Authentication required. Missing Bearer token.', 401);
  }

  try {
    const payload = await verifyJWT(token, c.env.JWT_SECRET);
    c.set('user', payload);
    await next();
  } catch (err) {
    return fail(c, `Invalid or expired token: ${err.message}`, 401);
  }
}

/**
 * requireAdmin
 * Must run after authMiddleware. Ensures c.get('user').role === 'admin'.
 */
export async function requireAdmin(c, next) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return fail(c, 'Admin access required.', 403);
  }
  await next();
}

/**
 * optionalAuth
 * Attaches the user to context if a valid token is present, but never
 * blocks the request if it's missing/invalid. Useful for public endpoints
 * that want to lightly personalize output when a user is logged in.
 */
export async function optionalAuth(c, next) {
  const header = c.req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (token) {
    try {
      const payload = await verifyJWT(token, c.env.JWT_SECRET);
      c.set('user', payload);
    } catch {
      // ignore invalid token for optional auth
    }
  }
  await next();
}

/* --------------------------------------------------------------------- */
/* Routes                                                                 */
/* --------------------------------------------------------------------- */

// POST /api/auth/register
auth.post('/register', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { name, email, password, phone } = body;

    if (!name || !email || !password) {
      return fail(c, 'name, email and password are required.', 400);
    }
    if (password.length < 6) {
      return fail(c, 'Password must be at least 6 characters.', 400);
    }

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email.toLowerCase().trim())
      .first();

    if (existing) {
      return fail(c, 'An account with this email already exists.', 409);
    }

    const id = genId('usr');
    const passwordHash = await hashPassword(password);

    await c.env.DB.prepare(
      `INSERT INTO users (id, name, email, password, phone, role, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'customer', datetime('now'), datetime('now'))`
    )
      .bind(id, name.trim(), email.toLowerCase().trim(), passwordHash, phone || null)
      .run();

    const token = await signJWT({ id, email: email.toLowerCase().trim(), role: 'customer', name }, c.env.JWT_SECRET);

    return ok(c, {
      token,
      user: { id, name, email: email.toLowerCase().trim(), role: 'customer' },
    }, undefined, 201);
  } catch (err) {
    return fail(c, `Registration failed: ${err.message}`, 500);
  }
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email, password } = body;

    if (!email || !password) {
      return fail(c, 'email and password are required.', 400);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, name, email, password, role FROM users WHERE email = ?'
    )
      .bind(email.toLowerCase().trim())
      .first();

    if (!user) {
      return fail(c, 'Invalid email or password.', 401);
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return fail(c, 'Invalid email or password.', 401);
    }

    const token = await signJWT(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      c.env.JWT_SECRET
    );

    return ok(c, {
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  } catch (err) {
    return fail(c, `Login failed: ${err.message}`, 500);
  }
});

// GET /api/auth/me
auth.get('/me', authMiddleware, async (c) => {
  const jwtUser = c.get('user');
  try {
    const user = await c.env.DB.prepare(
      'SELECT id, name, email, phone, role, avatar, created_at FROM users WHERE id = ?'
    )
      .bind(jwtUser.id)
      .first();

    if (!user) return fail(c, 'User not found.', 404);
    return ok(c, user);
  } catch (err) {
    return fail(c, `Failed to load profile: ${err.message}`, 500);
  }
});

// POST /api/auth/logout (stateless JWT: client just discards the token)
auth.post('/logout', authMiddleware, async (c) => {
  return ok(c, { message: 'Logged out successfully.' });
});

export default auth;
