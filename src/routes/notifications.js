// src/routes/notifications.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const notifications = new Hono();

// ============================================================
// USER ROUTES
// ============================================================

// ✅ GET /api/notifications/unread-count
notifications.get('/unread-count', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const row = await c.env.DB.prepare(
      `SELECT COUNT(*) as count 
       FROM notifications 
       WHERE user_id = ? 
         AND is_read = 0 
         AND (deleted_by_user IS NULL OR deleted_by_user = 0)`
    ).bind(user.id).first();
    return ok(c, { count: row?.count || 0 });
  } catch (err) {
    return fail(c, `Failed to load unread count: ${err.message}`, 500);
  }
});

// ✅ GET /api/notifications (user's inbox)
notifications.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM notifications 
       WHERE user_id = ? 
         AND (deleted_by_user IS NULL OR deleted_by_user = 0)
       ORDER BY created_at DESC 
       LIMIT 200`
    ).bind(user.id).all();

    const unreadRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as count 
       FROM notifications 
       WHERE user_id = ? 
         AND is_read = 0 
         AND (deleted_by_user IS NULL OR deleted_by_user = 0)`
    ).bind(user.id).first();

    return ok(c, {
      notifications: results || [],
      unreadCount: unreadRow?.count || 0,
    });
  } catch (err) {
    return fail(c, `Failed to load notifications: ${err.message}`, 500);
  }
});

// ✅ PUT /api/notifications/read-all
notifications.put('/read-all', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    await c.env.DB.prepare(
      `UPDATE notifications 
       SET is_read = 1, read_at = datetime('now') 
       WHERE user_id = ? AND is_read = 0`
    ).bind(user.id).run();
    return ok(c, { success: true });
  } catch (err) {
    return fail(c, `Failed to mark all as read: ${err.message}`, 500);
  }
});

// ✅ PUT /api/notifications/:id/read
notifications.put('/:id/read', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      `UPDATE notifications 
       SET is_read = 1, read_at = datetime('now') 
       WHERE id = ? AND user_id = ?`
    ).bind(id, user.id).run();

    if (result.meta?.changes === 0) {
      return fail(c, 'Notification not found.', 404);
    }
    return ok(c, { success: true });
  } catch (err) {
    return fail(c, `Failed to mark as read: ${err.message}`, 500);
  }
});

// ✅ DELETE /api/notifications/:id (soft delete for user)
notifications.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      `UPDATE notifications 
       SET deleted_by_user = 1 
       WHERE id = ? AND user_id = ?`
    ).bind(id, user.id).run();

    if (result.meta?.changes === 0) {
      return fail(c, 'Notification not found.', 404);
    }
    return ok(c, { success: true });
  } catch (err) {
    return fail(c, `Failed to delete: ${err.message}`, 500);
  }
});

// ============================================================
// ADMIN ROUTES
// ============================================================

// ✅ POST /api/notifications/send (Admin)
notifications.post('/send', authMiddleware, requireAdmin, async (c) => {
  try {
    const admin = c.get('user');
    const body = await c.req.json().catch(() => ({}));

    const {
      title,
      message,
      type = 'system',
      targetType = 'all',
      userId = null,
      imageUrl = null,
      actionUrl = null,
    } = body;

    // Validation
    if (!title || !title.trim()) {
      return fail(c, 'Title is required.', 400);
    }
    if (!message || !message.trim()) {
      return fail(c, 'Message is required.', 400);
    }
    if (targetType === 'specific' && !userId) {
      return fail(c, 'userId is required for specific target.', 400);
    }

    const batchId = genId('nbat');
    const now = new Date().toISOString().replace('T', ' ').substring(0, 19);

    // Determine target users
    let targetUserIds = [];

    if (targetType === 'specific') {
      const userRow = await c.env.DB.prepare(
        'SELECT id FROM users WHERE id = ?'
      ).bind(userId).first();
      if (!userRow) {
        return fail(c, 'Target user not found.', 404);
      }
      targetUserIds = [userId];
    } else {
      const { results } = await c.env.DB.prepare('SELECT id FROM users').all();
      targetUserIds = (results || []).map((u) => u.id);
    }

    if (targetUserIds.length === 0) {
      return fail(c, 'No users found to send notification.', 400);
    }

    // Insert batch
    await c.env.DB.prepare(
      `INSERT INTO notification_batches 
        (id, title, message, type, target_type, target_user_id, 
         image_url, action_url, sent_by, recipient_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      batchId,
      title.trim(),
      message.trim(),
      type,
      targetType,
      userId,
      imageUrl,
      actionUrl,
      admin.id,
      targetUserIds.length,
      now
    ).run();

    // Insert delivery records (batch insert)
    const stmts = targetUserIds.map((uid) =>
      c.env.DB.prepare(
        `INSERT INTO notifications 
          (id, batch_id, user_id, title, message, type, 
           image_url, action_url, is_read, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`
      ).bind(
        genId('ntf'),
        batchId,
        uid,
        title.trim(),
        message.trim(),
        type,
        imageUrl,
        actionUrl,
        now
      )
    );

    await c.env.DB.batch(stmts);

    return ok(
      c,
      {
        success: true,
        batchId,
        recipientCount: targetUserIds.length,
      },
      undefined,
      201
    );
  } catch (err) {
    console.error('Send notification error:', err);
    return fail(c, `Failed to send notification: ${err.message}`, 500);
  }
});

// ✅ GET /api/notifications/admin/batches (list of sent batches)
notifications.get('/admin/batches', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT 
         b.*,
         u.name as sent_by_name,
         u.email as sent_by_email
       FROM notification_batches b
       LEFT JOIN users u ON b.sent_by = u.id
       ORDER BY b.created_at DESC
       LIMIT 200`
    ).all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load batches: ${err.message}`, 500);
  }
});

// ✅ GET /api/notifications/admin/batches/:id (batch details with stats)
notifications.get('/admin/batches/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');

    const batch = await c.env.DB.prepare(
      `SELECT 
         b.*,
         u.name as sent_by_name
       FROM notification_batches b
       LEFT JOIN users u ON b.sent_by = u.id
       WHERE b.id = ?`
    ).bind(id).first();

    if (!batch) return fail(c, 'Batch not found.', 404);

    // Delivery stats
    const stats = await c.env.DB.prepare(
      `SELECT 
         COUNT(*) as total,
         SUM(CASE WHEN is_read = 1 THEN 1 ELSE 0 END) as read_count,
         SUM(CASE WHEN deleted_by_user = 1 THEN 1 ELSE 0 END) as deleted_count
       FROM notifications
       WHERE batch_id = ?`
    ).bind(id).first();

    return ok(c, {
      ...batch,
      stats: {
        total: stats?.total || 0,
        read: stats?.read_count || 0,
        deleted: stats?.deleted_count || 0,
        unread: (stats?.total || 0) - (stats?.read_count || 0),
      },
    });
  } catch (err) {
    return fail(c, `Failed to load batch: ${err.message}`, 500);
  }
});

// ✅ DELETE /api/notifications/admin/batches/:id (delete whole batch)
notifications.delete('/admin/batches/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');

    // Delete delivery records
    const result = await c.env.DB.prepare(
      'DELETE FROM notifications WHERE batch_id = ?'
    ).bind(id).run();

    // Delete batch metadata
    await c.env.DB.prepare(
      'DELETE FROM notification_batches WHERE id = ?'
    ).bind(id).run();

    return ok(c, {
      success: true,
      deletedCount: result.meta?.changes || 0,
    });
  } catch (err) {
    return fail(c, `Failed to delete batch: ${err.message}`, 500);
  }
});

// ✅ GET /api/notifications/admin/all-users (user list for specific targeting)
notifications.get('/admin/all-users', authMiddleware, requireAdmin, async (c) => {
  try {
    const url = new URL(c.req.url);
    const search = url.searchParams.get('q') || '';
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50', 10), 200);

    let query = 'SELECT id, name, email, phone FROM users';
    const bindings = [];

    if (search.trim()) {
      query += ' WHERE name LIKE ? OR email LIKE ? OR phone LIKE ?';
      const like = `%${search.trim()}%`;
      bindings.push(like, like, like);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    bindings.push(limit);

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load users: ${err.message}`, 500);
  }
});

export default notifications;
