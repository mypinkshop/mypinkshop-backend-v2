// src/routes/notifications.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const notifications = new Hono();

// ✅ GET /api/notifications/unread-count (User)
notifications.get('/unread-count', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
    ).bind(user.id).all();
    return ok(c, results[0] || { count: 0 });
  } catch (err) {
    return fail(c, `Failed to load unread count: ${err.message}`, 500);
  }
});

// ✅ GET /api/notifications (User)
notifications.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();
    
    // Unread count bhi nikaalo
    const unreadResult = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
    ).bind(user.id).first();
    
    return ok(c, {
      notifications: results || [],
      unreadCount: unreadResult?.count || 0
    });
  } catch (err) {
    return fail(c, `Failed to load notifications: ${err.message}`, 500);
  }
});

// ✅ POST /api/notifications/send (Admin)
notifications.post('/send', authMiddleware, requireAdmin, async (c) => {
  try {
    const { title, message, userId, type } = await c.req.json().catch(() => ({}));
    
    if (!title || !message) {
      return fail(c, 'Title and message are required.', 400);
    }

    // Agar specific user ko bhejna hai
    if (userId) {
      const id = genId('ntf');
      await c.env.DB.prepare(
        `INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`
      ).bind(id, userId, title, message, type || 'system').run();
      
      return ok(c, { success: true, count: 1 }, undefined, 201);
    }

    // Saare users ko bhejna hai
    const { results: users } = await c.env.DB.prepare('SELECT id FROM users').all();
    
    for (const user of users) {
      const id = genId('ntf');
      await c.env.DB.prepare(
        `INSERT INTO notifications (id, user_id, title, message, type, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, 0, datetime('now'))`
      ).bind(id, user.id, title, message, type || 'system').run();
    }

    return ok(c, { success: true, count: users.length }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to send notification: ${err.message}`, 500);
  }
});

// ✅ PUT /api/notifications/:id/read (User)
notifications.put('/:id/read', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).run();
    
    if (result.meta?.changes === 0) return fail(c, 'Notification not found.', 404);
    return ok(c, { success: true });
  } catch (err) {
    return fail(c, `Failed to mark as read: ${err.message}`, 500);
  }
});

// ✅ DELETE /api/notifications/:id (User)
notifications.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'DELETE FROM notifications WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).run();
    
    if (result.meta?.changes === 0) return fail(c, 'Notification not found.', 404);
    return ok(c, { success: true });
  } catch (err) {
    return fail(c, `Failed to delete notification: ${err.message}`, 500);
  }
});

// GET /api/notifications/unread-count - Unread notification count
notifications.get('/unread-count', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const countRow = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0'
    ).bind(user.id).first();
    
    return ok(c, { count: countRow?.count || 0 });
  } catch (err) {
    return fail(c, `Failed to load unread count: ${err.message}`, 500);
  }
});

export default notifications;
