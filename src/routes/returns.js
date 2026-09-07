// src/routes/returns.js
//
// NEW FILE — AdminOrders.jsx's "Returns" tab called GET /api/orders/returns/all
// and PUT /api/returns/:id/status, but there was no `returns` table and no
// route for either anywhere in the backend (a genuine missing feature, not
// just a wiring bug — this file + the `returns` table above are new).
// Mounted at BOTH /api/returns and /api/orders/returns in index.js so both
// paths the frontend already uses work without needing a frontend change.
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const returns = new Hono();

// POST /api/returns - Customer requests a return for a delivered order
// (No frontend button calls this yet — add one in MyOrders.jsx for
// delivered orders when you're ready; the endpoint is ready to use.)
returns.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { orderId, reason } = body;

    if (!orderId || !reason) return fail(c, 'orderId and reason are required.', 400);

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (!order) return fail(c, 'Order not found.', 404);
    if (order.user_id !== user.id) return fail(c, 'You do not have access to this order.', 403);
    if (order.status !== 'delivered') return fail(c, 'Only delivered orders can be returned.', 400);

    const existing = await c.env.DB.prepare(
      `SELECT id FROM returns WHERE order_id = ? AND status IN ('pending','approved')`
    ).bind(orderId).first();
    if (existing) return fail(c, 'A return request already exists for this order.', 409);

    const id = genId('ret');
    await c.env.DB.prepare(
      `INSERT INTO returns (id, order_id, user_id, reason, amount, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'pending', datetime('now'), datetime('now'))`
    ).bind(id, orderId, user.id, reason, order.total_amount || 0).run();

    return ok(c, { id, orderId, status: 'pending' }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create return request: ${err.message}`, 500);
  }
});

// GET /api/returns/all (also reachable at /api/orders/returns/all — see index.js)
returns.get('/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT
         r.id, r.order_id as orderId, r.reason, r.amount, r.status,
         r.created_at as createdAt,
         o.order_number as orderNumber,
         u.name as customerName, u.email as customerEmail,
         (SELECT p.name FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = r.order_id LIMIT 1) as productName
       FROM returns r
       JOIN orders o ON r.order_id = o.id
       JOIN users u ON r.user_id = u.id
       ORDER BY r.created_at DESC`
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load returns: ${err.message}`, 500);
  }
});

// PUT/PATCH /api/returns/:id/status (Admin approve/reject — AdminOrders.jsx uses PATCH)
const updateReturnStatusHandler = async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { status } = body;

    if (!['approved', 'rejected', 'completed', 'pending'].includes(status)) {
      return fail(c, 'Invalid status.', 400);
    }

    const existing = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Return request not found.', 404);

    await c.env.DB.prepare(
      `UPDATE returns SET status = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(status, id).run();

    // If approved/completed, reflect it on the order too.
    if (status === 'approved' || status === 'completed') {
      await c.env.DB.prepare(
        `UPDATE orders SET status = 'refunded', payment_status = 'refunded', updated_at = datetime('now') WHERE id = ?`
      ).bind(existing.order_id).run();
    }

    const updated = await c.env.DB.prepare('SELECT * FROM returns WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update return status: ${err.message}`, 500);
  }
};
returns.put('/:id/status', authMiddleware, requireAdmin, updateReturnStatusHandler);
returns.patch('/:id/status', authMiddleware, requireAdmin, updateReturnStatusHandler);

export default returns;
