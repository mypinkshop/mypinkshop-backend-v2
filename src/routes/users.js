// src/routes/users.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, parsePagination } from '../lib/utils.js';
import { hashPassword, verifyPassword } from '../lib/password.js';

const users = new Hono();

/* --------------------------------------------------------------------- */
/* Self-service (any authenticated user)                                 */
/* --------------------------------------------------------------------- */

// GET /api/users/profile
users.get('/profile', authMiddleware, async (c) => {
  try {
    const jwtUser = c.get('user');
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

// PUT /api/users/profile
users.put('/profile', authMiddleware, async (c) => {
  try {
    const jwtUser = c.get('user');
    const body = await c.req.json().catch(() => ({}));

    const existing = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(jwtUser.id).first();
    if (!existing) return fail(c, 'User not found.', 404);

    const merged = {
      name: body.name ?? existing.name,
      phone: body.phone ?? existing.phone,
      avatar: body.avatar ?? existing.avatar,
    };

    await c.env.DB.prepare(
      `UPDATE users SET name = ?, phone = ?, avatar = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(merged.name, merged.phone, merged.avatar, jwtUser.id)
      .run();

    const updated = await c.env.DB.prepare(
      'SELECT id, name, email, phone, role, avatar, created_at FROM users WHERE id = ?'
    )
      .bind(jwtUser.id)
      .first();

    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update profile: ${err.message}`, 500);
  }
});

// ✅ PUT /api/users/change-password (Frontend Profile.jsx isko hit karta hai)
users.put('/change-password', authMiddleware, async (c) => {
  try {
    const jwtUser = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { currentPassword, newPassword } = body;

    if (!currentPassword || !newPassword) {
      return fail(c, 'currentPassword and newPassword are required.', 400);
    }
    if (newPassword.length < 6) {
      return fail(c, 'New password must be at least 6 characters.', 400);
    }

    const user = await c.env.DB.prepare('SELECT id, password FROM users WHERE id = ?')
      .bind(jwtUser.id)
      .first();
    if (!user) return fail(c, 'User not found.', 404);

    const valid = await verifyPassword(currentPassword, user.password);
    if (!valid) return fail(c, 'Current password is incorrect.', 401);

    const newHash = await hashPassword(newPassword);
    await c.env.DB.prepare(
      `UPDATE users SET password = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newHash, jwtUser.id).run();

    return ok(c, { message: 'Password changed successfully.' });
  } catch (err) {
    return fail(c, `Failed to change password: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* Admin                                                                  */
/* --------------------------------------------------------------------- */

// GET /api/users - list all users (admin)
users.get('/', authMiddleware, requireAdmin, async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);

    const { results } = await c.env.DB.prepare(
      `SELECT id, name, email, phone, role, avatar, created_at FROM users
       ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(limit, offset)
      .all();

    const countRow = await c.env.DB.prepare('SELECT COUNT(*) as total FROM users').first();

    return ok(c, results || [], {
      page,
      limit,
      total: countRow?.total || 0,
      totalPages: Math.max(1, Math.ceil((countRow?.total || 0) / limit)),
    });
  } catch (err) {
    return fail(c, `Failed to load users: ${err.message}`, 500);
  }
});

// GET /api/users/:id (admin)
users.get('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const user = await c.env.DB.prepare(
      'SELECT id, name, email, phone, role, avatar, created_at FROM users WHERE id = ?'
    )
      .bind(id)
      .first();
    if (!user) return fail(c, 'User not found.', 404);
    return ok(c, user);
  } catch (err) {
    return fail(c, `Failed to load user: ${err.message}`, 500);
  }
});

// PUT /api/users/:id/role (admin) - e.g. promote to admin/vendor
users.put('/:id/role', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { role } = body;

    const VALID_ROLES = ['customer', 'admin', 'vendor'];
    if (!VALID_ROLES.includes(role)) {
      return fail(c, `role must be one of: ${VALID_ROLES.join(', ')}`, 400);
    }

    const result = await c.env.DB.prepare(
      `UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(role, id)
      .run();

    if (result.meta?.changes === 0) return fail(c, 'User not found.', 404);

    const updated = await c.env.DB.prepare(
      'SELECT id, name, email, phone, role FROM users WHERE id = ?'
    )
      .bind(id)
      .first();

    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update role: ${err.message}`, 500);
  }
});

// DELETE /api/users/:id (admin)
users.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id).run();
    if (result.meta?.changes === 0) return fail(c, 'User not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete user: ${err.message}`, 500);
  }
});

export default users;
