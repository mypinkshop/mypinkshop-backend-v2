// src/routes/reviews.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId, safeJsonArray } from '../lib/utils.js';

const reviews = new Hono();

// ============================================================
// ✅ Helper: Safe JSON array string
// ============================================================
const toSafeJsonString = (val) => {
  if (!val) return JSON.stringify([]);
  if (typeof val === 'string') {
    try { JSON.parse(val); return val; } catch { return JSON.stringify([val]); }
  }
  return JSON.stringify(val);
};

// ============================================================
// ✅ Helper: Serialize review (images parse + user info)
// ============================================================
function serializeReview(row) {
  if (!row) return null;
  return {
    ...row,
    _id: row.id,
    images: safeJsonArray(row.images),
    helpful_count: row.helpful_count || 0,
    title: row.title || '',
    status: row.status || 'pending',
    admin_reply: row.admin_reply || null,
  };
}

// ============================================================
// ✅ PUBLIC: GET /api/reviews/product/:productId
// Sirf APPROVED reviews dikhao
// ============================================================
reviews.get('/product/:productId', async (c) => {
  try {
    const productId = c.req.param('productId');
    const url = new URL(c.req.url);
    const sort = url.searchParams.get('sort') || 'newest';
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 100);
    const offset = parseInt(url.searchParams.get('offset')) || 0;

    let orderClause = 'ORDER BY r.created_at DESC';
    if (sort === 'helpful') orderClause = 'ORDER BY r.helpful_count DESC, r.created_at DESC';
    else if (sort === 'rating_high') orderClause = 'ORDER BY r.rating DESC, r.created_at DESC';
    else if (sort === 'rating_low') orderClause = 'ORDER BY r.rating ASC, r.created_at DESC';

    const { results } = await c.env.DB.prepare(
      `SELECT r.*, u.name as user_name, u.avatar as user_avatar
       FROM reviews r
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.product_id = ? AND r.status = 'approved'
       ${orderClause}
       LIMIT ? OFFSET ?`
    ).bind(productId, limit, offset).all();

    // Stats
    const stats = await c.env.DB.prepare(
      `SELECT 
        COUNT(*) as total,
        AVG(rating) as avg_rating,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star
       FROM reviews WHERE product_id = ? AND status = 'approved'`
    ).bind(productId).first();

    return ok(
      c,
      (results || []).map(serializeReview),
      {
        total: stats?.total || 0,
        avgRating: Number((stats?.avg_rating || 0).toFixed(1)),
        distribution: {
          5: stats?.five_star || 0,
          4: stats?.four_star || 0,
          3: stats?.three_star || 0,
          2: stats?.two_star || 0,
          1: stats?.one_star || 0,
        },
      }
    );
  } catch (err) {
    console.error('Load product reviews error:', err);
    return fail(c, `Failed to load reviews: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ AUTH: GET /api/reviews/my-reviews
// ============================================================
reviews.get('/my-reviews', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) return fail(c, 'Unauthorized', 401);

    const { results } = await c.env.DB.prepare(
      `SELECT r.*, p.name as product_name, p.images as product_images
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.id
       WHERE r.user_id = ?
       ORDER BY r.created_at DESC`
    ).bind(user.id).all();

    const formatted = (results || []).map(r => ({
      ...serializeReview(r),
      product_name: r.product_name,
      product_image: safeJsonArray(r.product_images)[0] || null,
    }));

    return ok(c, formatted);
  } catch (err) {
    return fail(c, `Failed to load my reviews: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ AUTH: GET /api/reviews/can-review/:productId
// Check karo: delivered order hai? already reviewed?
// ============================================================
reviews.get('/can-review/:productId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const productId = c.req.param('productId');

    if (!user) return ok(c, { canReview: false, hasReviewed: false, reason: 'not_logged_in' });

    // Already reviewed?
    const existingReview = await c.env.DB.prepare(
      'SELECT id FROM reviews WHERE user_id = ? AND product_id = ?'
    ).bind(user.id, productId).first();

    if (existingReview) {
      return ok(c, {
        canReview: false,
        hasReviewed: true,
        reason: 'already_reviewed',
        reviewId: existingReview.id,
      });
    }

    // Delivered order check — order_items join orders
    const deliveredOrder = await c.env.DB.prepare(
      `SELECT o.id as order_id, o.order_number
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = ? 
         AND oi.product_id = ? 
         AND o.status = 'delivered'
       LIMIT 1`
    ).bind(user.id, productId).first();

    if (!deliveredOrder) {
      return ok(c, {
        canReview: false,
        hasReviewed: false,
        reason: 'not_delivered',
        message: 'You can only review products after delivery',
      });
    }

    return ok(c, {
      canReview: true,
      hasReviewed: false,
      orderId: deliveredOrder.order_id,
      orderNumber: deliveredOrder.order_number,
    });
  } catch (err) {
    console.error('Can-review error:', err);
    return fail(c, `Failed to check review eligibility: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ AUTH: POST /api/reviews
// Review submit karo — status: pending
// ============================================================
reviews.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) return fail(c, 'Unauthorized', 401);

    const body = await c.req.json().catch(() => ({}));
    const { productId, rating, review, title, images = [] } = body;

    if (!productId) return fail(c, 'productId is required.', 400);
    if (!rating || rating < 1 || rating > 5) return fail(c, 'rating must be between 1 and 5.', 400);
    if (!review || !review.trim()) return fail(c, 'review text is required.', 400);

    const product = await c.env.DB.prepare('SELECT id, name FROM products WHERE id = ?').bind(productId).first();
    if (!product) return fail(c, 'Product not found.', 404);

    // Already reviewed?
    const existingReview = await c.env.DB.prepare(
      'SELECT id FROM reviews WHERE user_id = ? AND product_id = ?'
    ).bind(user.id, productId).first();

    if (existingReview) return fail(c, 'You have already reviewed this product.', 409);

    // Delivered check
    const deliveredOrder = await c.env.DB.prepare(
      `SELECT o.id as order_id
       FROM orders o
       INNER JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = ? AND oi.product_id = ? AND o.status = 'delivered'
       LIMIT 1`
    ).bind(user.id, productId).first();

    if (!deliveredOrder) {
      return fail(c, 'You can only review products after delivery.', 403);
    }

    const id = genId('rev');
    const imagesJson = toSafeJsonString(images);

    await c.env.DB.prepare(
      `INSERT INTO reviews 
        (id, user_id, product_id, rating, review, title, images, status, order_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        user.id,
        productId,
        parseInt(rating),
        review.trim(),
        (title || '').trim(),
        imagesJson,
        deliveredOrder.order_id
      )
      .run();

    // ⚠️ Product rating update NAHI karo — sirf approved reviews se hoga

    return ok(c, {
      id,
      productId,
      rating,
      review,
      title,
      images,
      status: 'pending',
      message: 'Review submitted for approval',
    }, undefined, 201);
  } catch (err) {
    console.error('Submit review error:', err);
    return fail(c, `Failed to submit review: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ AUTH: DELETE /api/reviews/:id (user khud)
// ============================================================
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

// ============================================================
// ✅ AUTH: POST /api/reviews/:id/helpful — Helpful vote
// ============================================================
reviews.post('/:id/helpful', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      `UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = ? AND status = 'approved'`
    ).bind(id).run();

    if (result.meta?.changes === 0) return fail(c, 'Review not found.', 404);
    return ok(c, { id, voted: true });
  } catch (err) {
    return fail(c, `Failed to vote: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: GET /api/reviews/admin/all
// ============================================================
reviews.get('/admin/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status') || 'all';
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 100, 500);
    const offset = parseInt(url.searchParams.get('offset')) || 0;
    const search = url.searchParams.get('search') || '';

    let whereClause = 'WHERE 1=1';
    const bindings = [];

    if (status !== 'all') {
      whereClause += ' AND r.status = ?';
      bindings.push(status);
    }

    if (search) {
      whereClause += ' AND (r.review LIKE ? OR r.title LIKE ? OR p.name LIKE ? OR u.name LIKE ?)';
      const like = `%${search}%`;
      bindings.push(like, like, like, like);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT 
         r.*,
         p.name as product_name,
         p.images as product_images,
         p.price as product_price,
         u.name as user_name,
         u.email as user_email,
         u.avatar as user_avatar
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.id
       LEFT JOIN users u ON r.user_id = u.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT ? OFFSET ?`
    ).bind(...bindings, limit, offset).all();

    const countRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM reviews r
       LEFT JOIN products p ON r.product_id = p.id
       LEFT JOIN users u ON r.user_id = u.id
       ${whereClause}`
    ).bind(...bindings).first();

    const formatted = (results || []).map(r => ({
      ...serializeReview(r),
      product_name: r.product_name,
      product_image: safeJsonArray(r.product_images)[0] || null,
      product_price: r.product_price,
      user_name: r.user_name,
      user_email: r.user_email,
      user_avatar: r.user_avatar,
    }));

    return ok(c, formatted, {
      total: countRow?.total || 0,
      limit,
      offset,
    });
  } catch (err) {
    console.error('Admin load reviews error:', err);
    return fail(c, `Failed to load reviews: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: GET /api/reviews/admin/stats
// ============================================================
reviews.get('/admin/stats', authMiddleware, requireAdmin, async (c) => {
  try {
    const stats = await c.env.DB.prepare(
      `SELECT
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) as rejected,
        AVG(CASE WHEN status = 'approved' THEN rating END) as avg_rating
       FROM reviews`
    ).first();

    return ok(c, {
      total: stats?.total || 0,
      pending: stats?.pending || 0,
      approved: stats?.approved || 0,
      rejected: stats?.rejected || 0,
      avgRating: Number((stats?.avg_rating || 0).toFixed(1)),
    });
  } catch (err) {
    return fail(c, `Failed to load stats: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: PATCH /api/reviews/admin/:id/approve
// ============================================================
reviews.patch('/admin/:id/approve', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Review not found.', 404);

    await c.env.DB.prepare(
      `UPDATE reviews SET status = 'approved', updated_at = datetime('now') WHERE id = ?`
    ).bind(id).run();

    // Product rating update karo
    await c.env.DB.prepare(
      `UPDATE products SET 
        rating = (SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'approved'),
        review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved')
       WHERE id = ?`
    ).bind(existing.product_id, existing.product_id, existing.product_id).run();

    return ok(c, { id, status: 'approved' });
  } catch (err) {
    return fail(c, `Failed to approve: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: PATCH /api/reviews/admin/:id/reject
// ============================================================
reviews.patch('/admin/:id/reject', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Review not found.', 404);

    await c.env.DB.prepare(
      `UPDATE reviews SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`
    ).bind(id).run();

    // Product rating recalculate (agar pehle approved tha)
    await c.env.DB.prepare(
      `UPDATE products SET 
        rating = COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'approved'), 0),
        review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved')
       WHERE id = ?`
    ).bind(existing.product_id, existing.product_id, existing.product_id).run();

    return ok(c, { id, status: 'rejected' });
  } catch (err) {
    return fail(c, `Failed to reject: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: DELETE /api/reviews/admin/:id
// ============================================================
reviews.delete('/admin/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Review not found.', 404);

    await c.env.DB.prepare('DELETE FROM reviews WHERE id = ?').bind(id).run();

    // Product rating recalculate
    await c.env.DB.prepare(
      `UPDATE products SET 
        rating = COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'approved'), 0),
        review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved')
       WHERE id = ?`
    ).bind(existing.product_id, existing.product_id, existing.product_id).run();

    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: POST /api/reviews/admin/add
// Admin manually review add kare — status: approved
// ============================================================
reviews.post('/admin/add', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { productId, userId, rating, review, title, images = [], userName } = body;

    if (!productId) return fail(c, 'productId is required.', 400);
    if (!rating || rating < 1 || rating > 5) return fail(c, 'rating must be between 1 and 5.', 400);
    if (!review || !review.trim()) return fail(c, 'review text is required.', 400);

    // Product check
    const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
    if (!product) return fail(c, 'Product not found.', 404);

    // User ID: agar diya hai to use karo, warna 'admin_guest'
    let finalUserId = userId;
    if (!finalUserId) {
      // Ek temporary admin review user
      finalUserId = 'admin_review_user';
      
      // Ensure user exists (optional)
      const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(finalUserId).first();
      if (!existingUser) {
        try {
          await c.env.DB.prepare(
            `INSERT INTO users (id, name, email, password, created_at) 
             VALUES (?, ?, ?, 'ADMIN_REVIEW_NO_LOGIN', datetime('now'))`
          ).bind(finalUserId, userName || 'Admin Review', 'admin-review@mypinkshop.com').run();
        } catch (e) {
          // User already exists — ignore
        }
      }
    }

    const id = genId('rev');
    const imagesJson = toSafeJsonString(images);

    await c.env.DB.prepare(
      `INSERT INTO reviews 
        (id, user_id, product_id, rating, review, title, images, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        finalUserId,
        productId,
        parseInt(rating),
        review.trim(),
        (title || '').trim(),
        imagesJson
      )
      .run();

    // Product rating recalculate
    await c.env.DB.prepare(
      `UPDATE products SET 
        rating = COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'approved'), 0),
        review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved')
       WHERE id = ?`
    ).bind(productId, productId, productId).run();

    return ok(c, {
      id,
      productId,
      rating,
      review,
      title,
      images,
      status: 'approved',
      message: 'Review added successfully',
    }, undefined, 201);
  } catch (err) {
    console.error('Admin add review error:', err);
    return fail(c, `Failed to add review: ${err.message}`, 500);
  }
});

export default reviews;
