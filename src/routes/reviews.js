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

// ✅ GET /api/reviews/product/:productId - Product ke saare reviews (NEW!)
reviews.get('/product/:productId', async (c) => {
  try {
    const productId = c.req.param('productId');

    const { results } = await c.env.DB.prepare(
      `SELECT r.*, u.name as user_name, u.avatar as user_avatar
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.product_id = ?
       ORDER BY r.created_at DESC`
    ).bind(productId).all();

    // ✅ Average rating + distribution
    const stats = await c.env.DB.prepare(
      `SELECT 
        COUNT(*) as total,
        AVG(rating) as avg_rating,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
       FROM reviews WHERE product_id = ?`
    ).bind(productId).first();

    return ok(c, results || [], {
      total: stats?.total || 0,
      avgRating: stats?.avg_rating || 0,
      distribution: {
        5: stats?.five_star || 0,
        4: stats?.four_star || 0,
        3: stats?.three_star || 0,
        2: stats?.two_star || 0,
        1: stats?.one_star || 0,
      },
    });
  } catch (err) {
    return fail(c, `Failed to load reviews: ${err.message}`, 500);
  }
});

// ✅ GET /api/reviews/can-review/:productId - Check if user can review
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

    const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
    if (!product) return fail(c, 'Product not found.', 404);

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
