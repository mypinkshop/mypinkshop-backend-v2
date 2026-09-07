// src/routes/auth.js
import { Hono } from 'hono';
import { signJWT, verifyJWT } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { ok, fail, genId } from '../lib/utils.js';
import { sendEmail } from '../lib/email.js';

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

    // ✅ Same shape fix as /login — see comment there.
    const userPayload = { id, _id: id, name, email: email.toLowerCase().trim(), role: 'customer' };
    return c.json({
      success: true,
      token,
      id,
      _id: id,
      name,
      email: email.toLowerCase().trim(),
      role: 'customer',
      user: userPayload,
      data: { token, ...userPayload, user: userPayload },
    }, 201);
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

    // ✅ CRITICAL FIX: previously this returned only { success, data: {...} }.
    // Three different frontend pages call this SAME /api/auth/login route
    // and each reads a different shape:
    //   - Login.jsx / AuthContext.login()  → top-level `token` + `user.{_id,name,email,role}`
    //   - AdminLogin.jsx                   → fully flat `token`,`role`,`email`,`name`,`_id`
    // Neither matched the old { data: {...} } shape (data.user was
    // `undefined`, so destructuring it threw and login always failed).
    // This response now includes the fields at every level every existing
    // page actually reads, so nothing else needs to change.
    const userPayload = { id: user.id, _id: user.id, name: user.name, email: user.email, role: user.role };
    return c.json({
      success: true,
      token,
      id: user.id,
      _id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      user: userPayload,
      data: { token, ...userPayload, user: userPayload },
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

/* --------------------------------------------------------------------- */
/* Forgot / reset password                                                */
/* --------------------------------------------------------------------- */

// POST /api/auth/forgot-password
// Body: { email }
auth.post('/forgot-password', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email } = body;

    if (!email) return fail(c, 'email is required.', 400);

    const cleanEmail = String(email).toLowerCase().trim();
    const genericSuccess = () =>
      ok(c, { message: 'If that email is registered, a password reset link has been sent.' });

    const user = await c.env.DB.prepare('SELECT id, name FROM users WHERE email = ?')
      .bind(cleanEmail)
      .first();

    if (!user) {
      // Don't reveal whether the account exists; still respond success.
      return genericSuccess();
    }

    // Invalidate any older unused reset tokens for this user first.
    await c.env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(user.id).run();

    const resetToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString(); // 30 minutes
    const id = genId('pwr');

    await c.env.DB.prepare(
      `INSERT INTO password_resets (id, user_id, token, used, created_at, expires_at)
       VALUES (?, ?, ?, 0, datetime('now'), ?)`
    )
      .bind(id, user.id, resetToken, expiresAt)
      .run();

    const frontendUrl = c.env.FRONTEND_URL || 'https://www.mypinkshop.com';
    const resetLink = `${frontendUrl}/reset-password/${resetToken}`;

    const emailHtml = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #ec4899;">MyPinkShop</h2>
        <p>Hi ${user.name || ''},</p>
        <p>We received a request to reset your password. Click the button below to choose a new one:</p>
        <p style="text-align: center; margin: 30px 0;">
          <a href="${resetLink}" style="background: #ec4899; color: white; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: bold;">Reset Password</a>
        </p>
        <p style="color: #888; font-size: 13px;">This link expires in 30 minutes. If you didn't request this, you can safely ignore this email.</p>
      </div>
    `;

    const emailResult = await sendEmail(c, cleanEmail, 'Reset your MyPinkShop password', emailHtml);
    if (!emailResult.ok) {
      return fail(c, `Email API Error: ${emailResult.error}`, 500);
    }

    return genericSuccess();
  } catch (err) {
    return fail(c, `Failed to process request: ${err.message}`, 500);
  }
});

// POST /api/auth/reset-password/:token
// Body: { password }
auth.post('/reset-password/:token', async (c) => {
  try {
    const token = c.req.param('token');
    const body = await c.req.json().catch(() => ({}));
    const { password } = body;

    if (!password || password.length < 6) {
      return fail(c, 'Password must be at least 6 characters.', 400);
    }

    const resetRecord = await c.env.DB.prepare(
      'SELECT * FROM password_resets WHERE token = ?'
    )
      .bind(token)
      .first();

    if (!resetRecord) return fail(c, 'Invalid or expired reset link.', 400);
    if (resetRecord.used) return fail(c, 'This reset link has already been used.', 400);
    if (new Date(resetRecord.expires_at) < new Date()) {
      return fail(c, 'This reset link has expired. Please request a new one.', 400);
    }

    const passwordHash = await hashPassword(password);

    await c.env.DB.prepare(
      `UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(passwordHash, resetRecord.user_id)
      .run();

    await c.env.DB.prepare('UPDATE password_resets SET used = 1 WHERE id = ?')
      .bind(resetRecord.id)
      .run();

    return ok(c, { message: 'Password has been reset successfully.' });
  } catch (err) {
    return fail(c, `Failed to reset password: ${err.message}`, 500);
  }
});

export default auth;
