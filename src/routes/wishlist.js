// src/routes/wishlist.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const wishlist = new Hono();

// GET /api/wishlist
wishlist.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      `SELECT w.*, p.name, p.price, p.images 
       FROM wishlist w
       JOIN products p ON w.product_id = p.id
       WHERE w.user_id = ?`
    ).bind(user.id).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load wishlist: ${err.message}`, 500);
  }
});

// POST /api/wishlist/add
wishlist.post('/add', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { product_id } = await c.req.json();
    const id = genId('wl');
    await c.env.DB.prepare(
      `INSERT INTO wishlist (id, user_id, product_id, created_at) VALUES (?, ?, ?, datetime('now'))`
    ).bind(id, user.id, product_id).run();
    return ok(c, { id, product_id }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to add to wishlist: ${err.message}`, 500);
  }
});

// DELETE /api/wishlist/:id
wishlist.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      `DELETE FROM wishlist WHERE id = ? AND user_id = ?`
    ).bind(id, user.id).run();
    if (result.meta?.changes === 0) return fail(c, 'Wishlist item not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete wishlist item: ${err.message}`, 500);
  }
});

export default wishlist;
