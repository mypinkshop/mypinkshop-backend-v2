// src/routes/orderHistory.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId, parsePagination } from '../lib/utils.js';

const orderHistory = new Hono();

// ✅ GET /api/orders/user - User ke apne saare orders (History)
orderHistory.get('/user', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { page, limit, offset } = parsePagination(c);
    
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    ).bind(user.id, limit, offset).all();
    
    const countRow = await c.env.DB.prepare(
      'SELECT COUNT(*) as total FROM orders WHERE user_id = ?'
    ).bind(user.id).first();
    
    return ok(c, results || [], {
      page,
      limit,
      total: countRow?.total || 0,
      totalPages: Math.max(1, Math.ceil((countRow?.total || 0) / limit)),
    });
  } catch (err) {
    return fail(c, `Failed to load orders: ${err.message}`, 500);
  }
});

// ✅ GET /api/orders/user/:id - User ke ek specific order ki details
orderHistory.get('/user/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    
    const order = await c.env.DB.prepare(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    
    if (!order) return fail(c, 'Order not found.', 404);
    
    const { results: items } = await c.env.DB.prepare(
      'SELECT * FROM order_items WHERE order_id = ?'
    ).bind(id).all();
    
    return ok(c, { ...order, items: items || [] });
  } catch (err) {
    return fail(c, `Failed to load order details: ${err.message}`, 500);
  }
});

// ✅ PUT /api/orders/user/cancel/:id - User order cancel kare
orderHistory.put('/user/cancel/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    
    const order = await c.env.DB.prepare(
      'SELECT * FROM orders WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).first();
    
    if (!order) return fail(c, 'Order not found.', 404);
    
    if (order.status !== 'pending') {
      return fail(c, 'Only pending orders can be cancelled.', 400);
    }
    
    await c.env.DB.prepare(
      'UPDATE orders SET status = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind('cancelled', id).run();
    
    return ok(c, { id, status: 'cancelled' });
  } catch (err) {
    return fail(c, `Failed to cancel order: ${err.message}`, 500);
  }
});

export default orderHistory;
