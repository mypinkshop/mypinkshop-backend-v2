// src/routes/wishlist.js
//
// ⚠️ REWRITTEN — the original version had THREE separate contract
// mismatches against the frontend (WishlistContext.jsx):
//   1. Frontend POSTs to `/api/wishlist` with body `{ productId }`;
//      backend only had `POST /add` expecting `{ product_id }`.
//   2. Frontend calls `DELETE /api/wishlist/:id` using the PRODUCT id
//      (that's the only id it ever has — isInWishlist/addToWishlist/
//      removeFromWishlist are all keyed by product id everywhere in the
//      app); backend expected its own internal wishlist-row id, which the
//      frontend never has, so every remove silently 404'd.
//   3. Frontend calls `DELETE /api/wishlist/clear/all`; that route didn't
//      exist at all.
// Since `wishlist` has a UNIQUE(user_id, product_id) constraint, a
// product id is already a perfectly valid unique identifier for "this
// user's wishlist entry for this product" — so instead of forcing every
// frontend page to learn a separate internal row id, this file makes
// product_id the public identifier everywhere, and returns it as both
// `id` and `_id` (the frontend was originally written for a MongoDB
// backend that used `_id`).
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const wishlist = new Hono();

const mapRow = (row) => ({
  id: row.product_id,
  _id: row.product_id,
  productId: row.product_id,
  name: row.name,
  price: row.price,
  images: row.images ? JSON.parse(row.images) : [],
  image: row.images ? (JSON.parse(row.images)[0] || null) : null,
  addedAt: row.created_at,
});

// GET /api/wishlist
wishlist.get('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      `SELECT w.*, p.name, p.price, p.images
       FROM wishlist w
       JOIN products p ON w.product_id = p.id
       WHERE w.user_id = ?
       ORDER BY w.created_at DESC`
    ).bind(user.id).all();
    return ok(c, (results || []).map(mapRow));
  } catch (err) {
    return fail(c, `Failed to load wishlist: ${err.message}`, 500);
  }
});

// POST /api/wishlist - body: { productId }
// (kept POST /api/wishlist/add too, for any other caller using the old path)
const addHandler = async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const productId = body.productId || body.product_id;
    if (!productId) return fail(c, 'productId is required.', 400);

    const existing = await c.env.DB.prepare(
      'SELECT id FROM wishlist WHERE user_id = ? AND product_id = ?'
    ).bind(user.id, productId).first();
    if (existing) return ok(c, { productId, alreadyExists: true });

    const id = genId('wl');
    await c.env.DB.prepare(
      `INSERT INTO wishlist (id, user_id, product_id, created_at) VALUES (?, ?, ?, datetime('now'))`
    ).bind(id, user.id, productId).run();
    return ok(c, { id, productId }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to add to wishlist: ${err.message}`, 500);
  }
};
wishlist.post('/', authMiddleware, addHandler);
wishlist.post('/add', authMiddleware, addHandler);

// ✅ DELETE /api/wishlist/clear/all - MUST be registered before
// DELETE /:productId, otherwise "clear" would be swallowed as a product id.
wishlist.delete('/clear/all', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    await c.env.DB.prepare('DELETE FROM wishlist WHERE user_id = ?').bind(user.id).run();
    return ok(c, { cleared: true });
  } catch (err) {
    return fail(c, `Failed to clear wishlist: ${err.message}`, 500);
  }
});

// DELETE /api/wishlist/:productId - removes by PRODUCT id (see note above)
wishlist.delete('/:productId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const productId = c.req.param('productId');
    const result = await c.env.DB.prepare(
      `DELETE FROM wishlist WHERE product_id = ? AND user_id = ?`
    ).bind(productId, user.id).run();
    if (result.meta?.changes === 0) return fail(c, 'Wishlist item not found.', 404);
    return ok(c, { productId, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete wishlist item: ${err.message}`, 500);
  }
});

export default wishlist;
