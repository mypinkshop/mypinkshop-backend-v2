// src/routes/reviews.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const reviews = new Hono();

// ✅ GET /api/reviews/my-reviews - User ke apne saare reviews
reviews.get('/my-reviews', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) return fail(c, 'Unauthorized', 401);
    
    const { results } = await c.env.DB.prepare(
      `SELECT r.*, p.name as product_name, p.images as product_image
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`
    ).bind(user.id).all();
    
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load my reviews: ${err.message}`, 500);
  }
});

// ✅ GET /api/reviews/can-review/:productId - Check if user can review this product
reviews.get('/can-review/:productId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const productId = c.req.param('productId');
    
    if (!user) {
      return ok(c, { canReview: false, hasReviewed: false });
    }
    
    const existingReview = await c.env.DB.prepare(
      'SELECT id FROM reviews WHERE user_id = ? AND product_id = ?'
    ).bind(user.id, productId).first();
    
    return ok(c, {
      canReview: !existingReview,
      hasReviewed: !!existingReview
    });
  } catch (err) {
    return fail(c, `Failed to check review eligibility: ${err.message}`, 500);
  }
});

// ✅ POST /api/reviews - Naya review submit karo
reviews.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) return fail(c, 'Unauthorized', 401);

    const body = await c.req.json().catch(() => ({}));
    const { productId, rating, review } = body;
    
    if (!productId) {
      return fail(c, 'productId is required.', 400);
    }
    
    if (!rating || rating < 1 || rating > 5) {
      return fail(c, 'rating must be between 1 and 5.', 400);
    }
    
    // ✅ Check if product exists
    const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
    if (!product) return fail(c, 'Product not found.', 404);
    
    // ✅ Check if user already reviewed this product (unique review)
    const existingReview = await c.env.DB.prepare(
      'SELECT * FROM reviews WHERE user_id = ? AND product_id = ?'
    ).bind(user.id, productId).first();
    
    if (existingReview) return fail(c, 'You have already reviewed this product.', 409);
    
    const id = genId('rev');
    
    await c.env.DB.prepare(
      `INSERT INTO reviews (id, user_id, product_id, rating, review, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, user.id, productId, rating, review || '')
      .run();
    
    // ✅ Product ki average rating update karo
    await c.env.DB.prepare(
      `UPDATE products SET rating = 
        (SELECT AVG(rating) FROM reviews WHERE product_id = ?),
        review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ?)
       WHERE id = ?`
    ).bind(productId, productId, productId).run();
    
    return ok(c, { id, productId, rating, review }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to submit review: ${err.message}`, 500);
  }
});

// ✅ DELETE /api/reviews/:id - Review delete karo
reviews.delete('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) return fail(c, 'Unauthorized', 401);

    const id = c.req.param('id');
    
    const result = await c.env.DB.prepare(
      'DELETE FROM reviews WHERE id = ? AND user_id = ?'
    ).bind(id, user.id).run();
    
    if (result.meta?.changes === 0) return fail(c, 'Review not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete review: ${err.message}`, 500);
  }
});

export default reviews;
