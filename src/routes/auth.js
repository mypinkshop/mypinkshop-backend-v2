// src/routes/auth.js
import { Hono } from 'hono';
import { signJWT, verifyJWT } from '../lib/jwt.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { ok, fail, genId } from '../lib/utils.js';
import { sendEmail } from '../lib/email.js';
import { sendPasswordResetLink } from '../lib/whatsapp.js';   // ✅ NEW

const auth = new Hono();

/* --------------------------------------------------------------------- */
/* Middleware                                                             */
/* --------------------------------------------------------------------- */

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

export async function requireAdmin(c, next) {
  const user = c.get('user');
  if (!user || user.role !== 'admin') {
    return fail(c, 'Admin access required.', 403);
  }
  await next();
}

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
      return fail(c, 'Please fill in your name, email, and password to continue.', 400);
    }
    if (password.length < 6) {
      return fail(c, 'Your password must be at least 6 characters long.', 400);
    }

    const existing = await c.env.DB.prepare('SELECT id FROM users WHERE email = ?')
      .bind(email.toLowerCase().trim())
      .first();

    if (existing) {
      return fail(c, 'An account with this email already exists. Please sign in instead.', 409);
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
      return fail(c, 'Please enter both your email and password.', 400);
    }

    const user = await c.env.DB.prepare(
      'SELECT id, name, email, password, role FROM users WHERE email = ?'
    )
      .bind(email.toLowerCase().trim())
      .first();

    if (!user) {
      return fail(c, "We couldn't find an account with that email. Please check and try again, or sign up for a new account.", 404);
    }

    const valid = await verifyPassword(password, user.password);
    if (!valid) {
      return fail(c, 'Incorrect password. Please try again or use "Forgot password?" to reset it.', 401);
    }

    const token = await signJWT(
      { id: user.id, email: user.email, role: user.role, name: user.name },
      c.env.JWT_SECRET
    );

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

// POST /api/auth/logout
auth.post('/logout', authMiddleware, async (c) => {
  return ok(c, { message: 'Logged out successfully.' });
});

/* --------------------------------------------------------------------- */
/* Forgot / reset password                                                */
/* --------------------------------------------------------------------- */

// ============================================================
// POST /api/auth/forgot-password
// Body: { email } OR { phone }
//
// EMAIL mode  → email पर link भेजे (WhatsApp भी अगर registered हो)
// PHONE mode  → WhatsApp पर link भेजे (Email भी अगर registered हो)
// ============================================================
auth.post('/forgot-password', async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { email, phone } = body;

    // दोनों में से एक तो ज़रूरी है
    if (!email && !phone) {
      return fail(c, 'Please enter your email address or WhatsApp number.', 400);
    }

    let user = null;

    // ============= EMAIL से LOOKUP =============
    if (email) {
      const cleanEmail = String(email).toLowerCase().trim();

      if (!cleanEmail.includes('@')) {
        return fail(c, 'Please enter a valid email address.', 400);
      }

      user = await c.env.DB.prepare(
        'SELECT id, name, email, phone FROM users WHERE email = ?'
      )
        .bind(cleanEmail)
        .first();

      if (!user) {
        return fail(c, "We couldn't find an account with that email address. Please check and try again, or sign up for a new account.", 404);
      }
    }
    // ============= PHONE से LOOKUP =============
    else {
      const cleanPhone = String(phone).replace(/\D/g, '').slice(-10);

      if (cleanPhone.length !== 10) {
        return fail(c, 'Please enter a valid 10-digit WhatsApp number.', 400);
      }

      // DB में phone अलग-अलग format में हो सकता है → flexible match
      user = await c.env.DB.prepare(
        `SELECT id, name, email, phone FROM users 
         WHERE REPLACE(REPLACE(REPLACE(REPLACE(phone, '+', ''), ' ', ''), '-', ''), '(', '') LIKE ?`
      )
        .bind(`%${cleanPhone}`)
        .first();

      if (!user) {
        return fail(c, "We couldn't find an account with that WhatsApp number. Please check and try again.", 404);
      }
    }

    // Purane unused reset tokens delete करें
    await c.env.DB.prepare('DELETE FROM password_resets WHERE user_id = ?')
      .bind(user.id)
      .run();

    const resetToken = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const id = genId('pwr');

    await c.env.DB.prepare(
      `INSERT INTO password_resets (id, user_id, token, used, created_at, expires_at)
       VALUES (?, ?, ?, 0, datetime('now'), ?)`
    )
      .bind(id, user.id, resetToken, expiresAt)
      .run();

    const frontendUrl = c.env.FRONTEND_URL || 'https://www.mypinkshop.com';
    const resetLink = `${frontendUrl}/reset-password/${resetToken}`;

    // ============================================================
    // 📧 EMAIL भेजें (अगर user का real email है)
    // ============================================================
    let emailResult = { ok: false, skipped: true };
    const hasRealEmail = user.email && !user.email.endsWith('@phone.mypinkshop.com');

    if (hasRealEmail) {
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

      const emailResponse = await sendEmail(c, user.email, 'Reset your MyPinkShop password', emailHtml);
      emailResult = { ok: emailResponse.ok, skipped: false, error: emailResponse.error };

      if (!emailResponse.ok) {
        console.error('[Email reset] failed:', emailResponse.error);
      }
    }

    // ============================================================
    // 📱 WHATSAPP भेजें (अगर user का phone registered है)
    // ============================================================
    let whatsappResult = { success: false, skipped: true };

    if (user.phone) {
      whatsappResult = await sendPasswordResetLink(c.env, user.phone, user.name, resetToken);

      if (!whatsappResult.success) {
        console.error('[WhatsApp reset] failed:', whatsappResult.error);
      }
    }

    // ============================================================
    // दोनों channels fail हों तो error
    // ============================================================
    if (!emailResult.ok && !whatsappResult.success) {
      return fail(c, 'Could not send reset link. Please try again later.', 500);
    }

    // ============================================================
    // Success response — frontend को बताएँ कौन-कौन से channels use हुए
    // ============================================================
    return ok(c, {
      message: 'Password reset link sent.',
      channels: {
        email: emailResult.ok === true,
        whatsapp: whatsappResult.success === true,
      },
    });
  } catch (err) {
    return fail(c, `Failed to process request: ${err.message}`, 500);
  }
});

// POST /api/auth/reset-password/:token
auth.post('/reset-password/:token', async (c) => {
  try {
    const token = c.req.param('token')?.trim();
    const body = await c.req.json().catch(() => ({}));
    const { password } = body;

    if (!token) {
      return fail(c, 'Missing reset token.', 400);
    }

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
