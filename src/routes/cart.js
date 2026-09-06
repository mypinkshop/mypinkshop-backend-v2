// src/routes/cart.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId, safeJsonArray } from '../lib/utils.js';

const cart = new Hono();

// All cart routes require a logged-in user.
cart.use('*', authMiddleware);

function serializeCartItem(row) {
  return {
    id: row.id,
    productId: row.product_id,
    quantity: row.quantity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    product: row.p_id
      ? {
          id: row.p_id,
          name: row.p_name,
          price: row.p_price,
          originalPrice: row.p_original_price,
          images: safeJsonArray(row.p_images),
          stock: row.p_stock,
        }
      : null,
  };
}

// GET /api/cart
cart.get('/', async (c) => {
  try {
    const user = c.get('user');

    const { results } = await c.env.DB.prepare(
      `SELECT cart.id, cart.product_id, cart.quantity, cart.created_at, cart.updated_at,
              p.id as p_id, p.name as p_name, p.price as p_price,
              p.original_price as p_original_price, p.images as p_images, p.stock as p_stock
       FROM cart
       LEFT JOIN products p ON p.id = cart.product_id
       WHERE cart.user_id = ?
       ORDER BY cart.created_at DESC`
    )
      .bind(user.id)
      .all();

    const items = (results || []).map(serializeCartItem);
    const subtotal = items.reduce((sum, item) => sum + (item.product?.price || 0) * item.quantity, 0);

    return ok(c, { items, subtotal, itemCount: items.length });
  } catch (err) {
    return fail(c, `Failed to load cart: ${err.message}`, 500);
  }
});

// POST /api/cart/add
cart.post('/add', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { productId, quantity = 1 } = body;

    if (!productId) return fail(c, 'productId is required.', 400);
    if (quantity < 1) return fail(c, 'quantity must be at least 1.', 400);

    const product = await c.env.DB.prepare('SELECT id, stock FROM products WHERE id = ?')
      .bind(productId)
      .first();
    if (!product) return fail(c, 'Product not found.', 404);

    const existing = await c.env.DB.prepare(
      'SELECT * FROM cart WHERE user_id = ? AND product_id = ?'
    )
      .bind(user.id, productId)
      .first();

    if (existing) {
      await c.env.DB.prepare(
        `UPDATE cart SET quantity = quantity + ?, updated_at = datetime('now')
         WHERE user_id = ? AND product_id = ?`
      )
        .bind(quantity, user.id, productId)
        .run();
    } else {
      const id = genId('cart');
      await c.env.DB.prepare(
        `INSERT INTO cart (id, user_id, product_id, quantity, created_at, updated_at)
         VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
      )
        .bind(id, user.id, productId, quantity)
        .run();
    }

    return ok(c, { productId, quantity, added: true });
  } catch (err) {
    return fail(c, `Failed to add to cart: ${err.message}`, 500);
  }
});

// PUT /api/cart/update
cart.put('/update', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { productId, quantity } = body;

    if (!productId || quantity === undefined) {
      return fail(c, 'productId and quantity are required.', 400);
    }

    if (quantity <= 0) {
      await c.env.DB.prepare('DELETE FROM cart WHERE user_id = ? AND product_id = ?')
        .bind(user.id, productId)
        .run();
      return ok(c, { productId, removed: true });
    }

    const result = await c.env.DB.prepare(
      `UPDATE cart SET quantity = ?, updated_at = datetime('now') WHERE user_id = ? AND product_id = ?`
    )
      .bind(quantity, user.id, productId)
      .run();

    if (result.meta?.changes === 0) return fail(c, 'Cart item not found.', 404);

    return ok(c, { productId, quantity });
  } catch (err) {
    return fail(c, `Failed to update cart: ${err.message}`, 500);
  }
});

// DELETE /api/cart/remove/:productId
cart.delete('/remove/:productId', async (c) => {
  try {
    const user = c.get('user');
    const productId = c.req.param('productId');

    const result = await c.env.DB.prepare('DELETE FROM cart WHERE user_id = ? AND product_id = ?')
      .bind(user.id, productId)
      .run();

    if (result.meta?.changes === 0) return fail(c, 'Cart item not found.', 404);
    return ok(c, { productId, removed: true });
  } catch (err) {
    return fail(c, `Failed to remove cart item: ${err.message}`, 500);
  }
});

// DELETE /api/cart/clear
cart.delete('/clear', async (c) => {
  try {
    const user = c.get('user');
    await c.env.DB.prepare('DELETE FROM cart WHERE user_id = ?').bind(user.id).run();
    return ok(c, { cleared: true });
  } catch (err) {
    return fail(c, `Failed to clear cart: ${err.message}`, 500);
  }
});

export default cart;
