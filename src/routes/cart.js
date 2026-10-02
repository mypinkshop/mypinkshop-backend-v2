// src/routes/cart.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId, safeJsonArray } from '../lib/utils.js';

const cart = new Hono();

// ✅ Config
const MAX_QTY_PER_PRODUCT = 4;

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
    const subtotal = items.reduce(
      (sum, item) => sum + (item.product?.price || 0) * item.quantity,
      0
    );

    return ok(c, { items, subtotal, itemCount: items.length });
  } catch (err) {
    return fail(c, `Failed to load cart: ${err.message}`, 500);
  }
});

// ✅ POST /api/cart/add — WITH STOCK + MAX LIMIT CHECK
cart.post('/add', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { productId, quantity = 1 } = body;

    if (!productId) return fail(c, 'productId is required.', 400);
    if (quantity < 1) return fail(c, 'quantity must be at least 1.', 400);

    // ✅ Product + stock fetch karo
    const product = await c.env.DB.prepare(
      'SELECT id, stock, name FROM products WHERE id = ?'
    )
      .bind(productId)
      .first();
    if (!product) return fail(c, 'Product not found.', 404);

    const productStock = Number(product.stock) || 0;

    // ✅ Existing cart item check
    const existing = await c.env.DB.prepare(
      'SELECT * FROM cart WHERE user_id = ? AND product_id = ?'
    )
      .bind(user.id, productId)
      .first();

    const currentQty = existing?.quantity || 0;
    const newTotal = currentQty + quantity;

    // ✅ CHECK 1: MAX 4 per product
    if (newTotal > MAX_QTY_PER_PRODUCT) {
      return fail(
        c,
        `Maximum ${MAX_QTY_PER_PRODUCT} units allowed per product. You already have ${currentQty} in your cart.`,
        400
      );
    }

    // ✅ CHECK 2: Stock availability
    if (productStock > 0 && newTotal > productStock) {
      const remaining = productStock - currentQty;
      return fail(
        c,
        remaining > 0
          ? `Only ${productStock} left in stock. You already have ${currentQty} in cart.`
          : `Only ${productStock} left in stock.`,
        400
      );
    }

    // ✅ Agar stock 0 hai to add nahi hone do
    if (productStock === 0) {
      return fail(c, 'Out of stock.', 400);
    }

    // ✅ Insert or update
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

    return ok(c, {
      productId,
      quantity,
      added: true,
      newTotal,
      stockLeft: productStock - newTotal,
    });
  } catch (err) {
    return fail(c, `Failed to add to cart: ${err.message}`, 500);
  }
});

// ✅ PUT /api/cart/update — WITH STOCK + MAX LIMIT CHECK
cart.put('/update', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { productId, quantity } = body;

    if (!productId || quantity === undefined) {
      return fail(c, 'productId and quantity are required.', 400);
    }

    // ✅ Remove if quantity <= 0
    if (quantity <= 0) {
      await c.env.DB.prepare(
        'DELETE FROM cart WHERE user_id = ? AND product_id = ?'
      )
        .bind(user.id, productId)
        .run();
      return ok(c, { productId, removed: true });
    }

    // ✅ MAX 4 check
    if (quantity > MAX_QTY_PER_PRODUCT) {
      return fail(
        c,
        `Maximum ${MAX_QTY_PER_PRODUCT} units allowed per product.`,
        400
      );
    }

    // ✅ Stock check
    const product = await c.env.DB.prepare(
      'SELECT id, stock FROM products WHERE id = ?'
    )
      .bind(productId)
      .first();
    if (!product) return fail(c, 'Product not found.', 404);

    const productStock = Number(product.stock) || 0;
    if (productStock > 0 && quantity > productStock) {
      return fail(c, `Only ${productStock} left in stock.`, 400);
    }

    // ✅ Update
    const result = await c.env.DB.prepare(
      `UPDATE cart SET quantity = ?, updated_at = datetime('now') 
       WHERE user_id = ? AND product_id = ?`
    )
      .bind(quantity, user.id, productId)
      .run();

    if (result.meta?.changes === 0)
      return fail(c, 'Cart item not found.', 404);

    return ok(c, {
      productId,
      quantity,
      stockLeft: productStock - quantity,
    });
  } catch (err) {
    return fail(c, `Failed to update cart: ${err.message}`, 500);
  }
});

// DELETE /api/cart/remove/:productId
cart.delete('/remove/:productId', async (c) => {
  try {
    const user = c.get('user');
    const productId = c.req.param('productId');

    const result = await c.env.DB.prepare(
      'DELETE FROM cart WHERE user_id = ? AND product_id = ?'
    )
      .bind(user.id, productId)
      .run();

    if (result.meta?.changes === 0)
      return fail(c, 'Cart item not found.', 404);
    return ok(c, { productId, removed: true });
  } catch (err) {
    return fail(c, `Failed to remove cart item: ${err.message}`, 500);
  }
});

// DELETE /api/cart/clear
cart.delete('/clear', async (c) => {
  try {
    const user = c.get('user');
    await c.env.DB.prepare('DELETE FROM cart WHERE user_id = ?')
      .bind(user.id)
      .run();
    return ok(c, { cleared: true });
  } catch (err) {
    return fail(c, `Failed to clear cart: ${err.message}`, 500);
  }
});

// ✅ POST /api/cart/merge — WITH STOCK + MAX LIMIT CHECK
cart.post('/merge', async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { items } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return ok(c, { merged: 0, message: 'No items to merge' });
    }

    let mergedCount = 0;
    let skippedCount = 0;

    for (const item of items) {
      const { productId, quantity } = item || {};
      if (!productId || !quantity || quantity < 1) continue;

      // ✅ Product + stock fetch
      const product = await c.env.DB.prepare(
        'SELECT id, stock FROM products WHERE id = ?'
      )
        .bind(productId)
        .first();

      if (!product) {
        skippedCount++;
        continue;
      }

      const productStock = Number(product.stock) || 0;
      if (productStock === 0) {
        skippedCount++;
        continue;
      }

      // ✅ Existing cart item
      const existing = await c.env.DB.prepare(
        'SELECT * FROM cart WHERE user_id = ? AND product_id = ?'
      )
        .bind(user.id, productId)
        .first();

      const currentQty = existing?.quantity || 0;

      // ✅ Merge karte waqt max 4 limit aur stock check
      let allowedQty = quantity;
      const maxAllowed = Math.min(MAX_QTY_PER_PRODUCT, productStock);
      const totalAllowed = Math.max(0, maxAllowed - currentQty);

      if (totalAllowed === 0) {
        skippedCount++;
        continue;
      }

      if (allowedQty > totalAllowed) {
        allowedQty = totalAllowed;
      }

      if (existing) {
        await c.env.DB.prepare(
          `UPDATE cart SET quantity = quantity + ?, updated_at = datetime('now')
           WHERE user_id = ? AND product_id = ?`
        )
          .bind(allowedQty, user.id, productId)
          .run();
      } else {
        const id = genId('cart');
        await c.env.DB.prepare(
          `INSERT INTO cart (id, user_id, product_id, quantity, created_at, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
        )
          .bind(id, user.id, productId, allowedQty)
          .run();
      }

      mergedCount++;
    }

    return ok(c, {
      merged: mergedCount,
      skipped: skippedCount,
      message:
        skippedCount > 0
          ? `Merged ${mergedCount} items, ${skippedCount} skipped (out of stock/limit)`
          : `Merged ${mergedCount} items`,
    });
  } catch (err) {
    return fail(c, `Failed to merge cart: ${err.message}`, 500);
  }
});

export default cart;
