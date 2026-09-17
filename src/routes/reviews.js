// src/routes/reviews.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId, safeJsonArray } from '../lib/utils.js';

const reviews = new Hono();

// ============================================================
// ✅ Helpers
// ============================================================
const toSafeJsonString = (val) => {
  if (!val) return JSON.stringify([]);
  if (typeof val === 'string') {
    try { JSON.parse(val); return val; } catch { return JSON.stringify([val]); }
  }
  return JSON.stringify(val);
};

function serializeReview(row) {
  if (!row) return null;
  
  // ✅ Priority: author_name (admin-added) > user_name (customer)
  const userName = row.author_name || row.user_name || 'Customer';
  
  // ✅ Date fix — SQLite format to ISO
  let createdAt = row.created_at || row.createdAt || null;
  if (createdAt) createdAt = String(createdAt).replace(' ', 'T');
  
  return {
    ...row,
    _id: row.id,
    productId: row.product_id,
    userId: row.user_id,
    user_name: userName,           // ✅ Final name (author_name priority)
    author_name: row.author_name || null,
    images: safeJsonArray(row.images),
    videos: safeJsonArray(row.videos),
    helpful_count: row.helpful_count || 0,
    helpful: row.helpful_count || 0,
    title: row.title || '',
    status: row.status || 'pending',
    admin_reply: row.admin_reply || null,
    isRatingOnly: !row.review || !row.review.trim(),
    comment: row.review || '',
    created_at: createdAt,
    createdAt: createdAt,
  };
}

// ============================================================
// ✅ PUBLIC: GET /api/reviews/product/:productId
// ============================================================
reviews.get('/product/:productId', async (c) => {
  try {
    const productId = c.req.param('productId');
    const url = new URL(c.req.url);
    const sort = url.searchParams.get('sort') || 'newest';
    const page = Math.max(parseInt(url.searchParams.get('page')) || 1, 1);
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 10, 100);
    const offset = (page - 1) * limit;

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

    const stats = await c.env.DB.prepare(
      `SELECT 
        COUNT(*) as total,
        AVG(rating) as avg_rating,
        SUM(CASE WHEN rating = 5 THEN 1 ELSE 0 END) as five_star,
        SUM(CASE WHEN rating = 4 THEN 1 ELSE 0 END) as four_star,
        SUM(CASE WHEN rating = 3 THEN 1 ELSE 0 END) as three_star,
        SUM(CASE WHEN rating = 2 THEN 1 ELSE 0 END) as two_star,
        SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END) as one_star,
        SUM(CASE WHEN review IS NULL OR review = '' THEN 1 ELSE 0 END) as rating_only
       FROM reviews WHERE product_id = ? AND status = 'approved'`
    ).bind(productId).first();

    const total = stats?.total || 0;
    const pages = Math.max(1, Math.ceil(total / limit));
    const reviewsList = (results || []).map(serializeReview);

    return c.json({
      success: true,
      reviews: reviewsList,
      data: reviewsList,
      total,
      page,
      pages,
      averageRating: Number((stats?.avg_rating || 0).toFixed(1)),
      totalReviews: total,
      ratingCounts: {
        5: stats?.five_star || 0,
        4: stats?.four_star || 0,
        3: stats?.three_star || 0,
        2: stats?.two_star || 0,
        1: stats?.one_star || 0,
      },
      ratingOnlyCount: stats?.rating_only || 0,
      reviewWithCommentCount: total - (stats?.rating_only || 0),
    });
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
// ============================================================
reviews.get('/can-review/:productId', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const productId = c.req.param('productId');

    if (!user) {
      return ok(c, { canReview: false, alreadyReviewed: false, hasReviewed: false, reason: 'not_logged_in' });
    }

    const existingReview = await c.env.DB.prepare(
      'SELECT id FROM reviews WHERE user_id = ? AND product_id = ?'
    ).bind(user.id, productId).first();

    if (existingReview) {
      return ok(c, {
        canReview: false,
        alreadyReviewed: true,
        hasReviewed: true,
        reason: 'already_reviewed',
        reviewId: existingReview.id,
      });
    }

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
        alreadyReviewed: false,
        hasReviewed: false,
        reason: 'not_delivered',
        message: 'You can only review products after delivery',
      });
    }

    return ok(c, {
      canReview: true,
      alreadyReviewed: false,
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
// ✅ AUTH: POST /api/reviews/upload — review images upload
// ============================================================
reviews.post('/upload', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) return fail(c, 'Unauthorized', 401);

    const formData = await c.req.formData();
    const urls = [];

    const media = formData.getAll('media');
    if (!media || media.length === 0) {
      return fail(c, 'No files uploaded', 400);
    }

    for (const file of media) {
      if (!file || typeof file === 'string') continue;

      const ext = file.name?.split('.').pop() || 'jpg';
      const key = `reviews/${user.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

      try {
        if (c.env.BUCKET) {
          await c.env.BUCKET.put(key, file.stream(), {
            httpMetadata: { contentType: file.type || 'image/jpeg' },
          });
          urls.push(`https://pub-xxxxx.r2.dev/${key}`);
        } else {
          const buffer = await file.arrayBuffer();
          const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
          urls.push(`data:${file.type};base64,${base64}`);
        }
      } catch (e) {
        console.error('Upload file error:', e);
      }
    }

    return ok(c, { urls });
  } catch (err) {
    console.error('Review upload error:', err);
    return fail(c, `Upload failed: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ AUTH: POST /api/reviews (customer)
// ============================================================
reviews.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    if (!user) return fail(c, 'Unauthorized', 401);

    const body = await c.req.json().catch(() => ({}));
    const { productId, rating, review, comment, title, images = [], videos = [], isRatingOnly = false } = body;

    const reviewText = review || comment || '';

    if (!productId) return fail(c, 'productId is required.', 400);
    if (!rating || rating < 1 || rating > 5) return fail(c, 'rating must be between 1 and 5.', 400);
    if (!isRatingOnly && !reviewText.trim()) return fail(c, 'review text is required.', 400);

    const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
    if (!product) return fail(c, 'Product not found.', 404);

    const existingReview = await c.env.DB.prepare(
      'SELECT id FROM reviews WHERE user_id = ? AND product_id = ?'
    ).bind(user.id, productId).first();

    if (existingReview) return fail(c, 'You have already reviewed this product.', 409);

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
    const videosJson = toSafeJsonString(videos);

    await c.env.DB.prepare(
      `INSERT INTO reviews 
        (id, user_id, product_id, rating, review, title, images, status, order_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'), datetime('now'))`
    )
      .bind(id, user.id, productId, parseInt(rating), reviewText.trim(), (title || '').trim(), imagesJson, deliveredOrder.order_id)
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();

    return ok(c, { review: serializeReview(created) }, undefined, 201);
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
// ✅ AUTH: PATCH /api/reviews/:id/helpful
// ============================================================
const helpfulHandler = async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      `UPDATE reviews SET helpful_count = helpful_count + 1 WHERE id = ? AND status = 'approved'`
    ).bind(id).run();

    if (result.meta?.changes === 0) return fail(c, 'Review not found.', 404);

    const updated = await c.env.DB.prepare('SELECT helpful_count FROM reviews WHERE id = ?').bind(id).first();
    return ok(c, { id, helpful: updated?.helpful_count || 0, voted: true });
  } catch (err) {
    return fail(c, `Failed to vote: ${err.message}`, 500);
  }
};
reviews.patch('/:id/helpful', authMiddleware, helpfulHandler);
reviews.post('/:id/helpful', authMiddleware, helpfulHandler);

// ============================================================
// 🛡️ ADMIN: GET /api/reviews/admin/all
// ============================================================
reviews.get('/admin/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status') || 'all';
    const page = Math.max(parseInt(url.searchParams.get('page')) || 1, 1);
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
    const offset = (page - 1) * limit;
    const search = url.searchParams.get('search') || '';
    const type = url.searchParams.get('type') || 'all';

    let whereClause = 'WHERE 1=1';
    const bindings = [];

    if (status !== 'all') {
      whereClause += ' AND r.status = ?';
      bindings.push(status);
    }

    if (type === 'rating_only') {
      whereClause += " AND (r.review IS NULL OR r.review = '')";
    } else if (type === 'with_comment') {
      whereClause += " AND r.review IS NOT NULL AND r.review != ''";
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

    const total = countRow?.total || 0;
    const pages = Math.max(1, Math.ceil(total / limit));

    const formatted = (results || []).map(r => ({
      ...serializeReview(r),
      product_name: r.product_name,
      product_image: safeJsonArray(r.product_images)[0] || null,
      product_price: r.product_price,
      user_name: r.author_name || r.user_name || 'Customer',
      user_email: r.user_email,
      user_avatar: r.user_avatar,
    }));

    return c.json({
      success: true,
      data: formatted,
      reviews: formatted,
      total,
      page,
      pages,
      limit,
      offset,
    });
  } catch (err) {
    console.error('Admin load reviews error:', err);
    return fail(c, `Failed to load reviews: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: GET /api/reviews/admin/pending
// ============================================================
reviews.get('/admin/pending', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT r.*, p.name as product_name, p.images as product_images,
              u.name as user_name, u.email as user_email, u.avatar as user_avatar
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.id
       LEFT JOIN users u ON r.user_id = u.id
       WHERE r.status = 'pending'
       ORDER BY r.created_at DESC
       LIMIT 100`
    ).all();

    const formatted = (results || []).map(r => ({
      ...serializeReview(r),
      product_name: r.product_name,
      product_image: safeJsonArray(r.product_images)[0] || null,
      user_name: r.author_name || r.user_name || 'Customer',
      user_email: r.user_email,
      user_avatar: r.user_avatar,
    }));

    return ok(c, formatted);
  } catch (err) {
    return fail(c, `Failed to load pending reviews: ${err.message}`, 500);
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

    const statsData = {
      total: stats?.total || 0,
      pending: stats?.pending || 0,
      approved: stats?.approved || 0,
      rejected: stats?.rejected || 0,
      avgRating: Number((stats?.avg_rating || 0).toFixed(1)),
    };

    return c.json({ success: true, data: statsData, stats: statsData });
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

    await c.env.DB.prepare(
      `UPDATE products SET 
        rating = (SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'approved'),
        review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved')
       WHERE id = ?`
    ).bind(existing.product_id, existing.product_id, existing.product_id).run();

    const updated = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();
    return ok(c, { review: serializeReview(updated), status: 'approved' });
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
// 🛡️ ADMIN: PATCH /api/reviews/admin/bulk-approve
// ============================================================
reviews.patch('/admin/bulk-approve', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { reviewIds = [] } = body;

    if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
      return fail(c, 'reviewIds array is required.', 400);
    }

    let approved = 0;
    for (const id of reviewIds) {
      const existing = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();
      if (!existing) continue;

      await c.env.DB.prepare(
        `UPDATE reviews SET status = 'approved', updated_at = datetime('now') WHERE id = ?`
      ).bind(id).run();

      await c.env.DB.prepare(
        `UPDATE products SET 
          rating = (SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'approved'),
          review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved')
         WHERE id = ?`
      ).bind(existing.product_id, existing.product_id, existing.product_id).run();

      approved++;
    }

    return ok(c, { approved, total: reviewIds.length });
  } catch (err) {
    return fail(c, `Bulk approve failed: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: PATCH /api/reviews/admin/bulk-reject
// ============================================================
reviews.patch('/admin/bulk-reject', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { reviewIds = [] } = body;

    if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
      return fail(c, 'reviewIds array is required.', 400);
    }

    let rejected = 0;
    for (const id of reviewIds) {
      const existing = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();
      if (!existing) continue;

      await c.env.DB.prepare(
        `UPDATE reviews SET status = 'rejected', updated_at = datetime('now') WHERE id = ?`
      ).bind(id).run();

      await c.env.DB.prepare(
        `UPDATE products SET 
          rating = COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'approved'), 0),
          review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved')
         WHERE id = ?`
      ).bind(existing.product_id, existing.product_id, existing.product_id).run();

      rejected++;
    }

    return ok(c, { rejected, total: reviewIds.length });
  } catch (err) {
    return fail(c, `Bulk reject failed: ${err.message}`, 500);
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
// 🛡️ ADMIN: GET /api/reviews/admin/export — CSV
// ============================================================
reviews.get('/admin/export', authMiddleware, requireAdmin, async (c) => {
  try {
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status') || 'all';

    let whereClause = 'WHERE 1=1';
    const bindings = [];
    if (status !== 'all') {
      whereClause += ' AND r.status = ?';
      bindings.push(status);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT r.*, p.name as product_name, u.name as user_name, u.email as user_email
       FROM reviews r
       LEFT JOIN products p ON r.product_id = p.id
       LEFT JOIN users u ON r.user_id = u.id
       ${whereClause}
       ORDER BY r.created_at DESC
       LIMIT 5000`
    ).bind(...bindings).all();

    const rows = [['ID', 'Product', 'Author', 'Rating', 'Title', 'Review', 'Status', 'Date']];
    for (const r of results || []) {
      const authorName = r.author_name || r.user_name || 'Customer';
      rows.push([
        r.id,
        r.product_name || '',
        authorName,
        r.rating,
        (r.title || '').replace(/,/g, ';'),
        (r.review || '').replace(/,/g, ';').replace(/\n/g, ' '),
        r.status,
        r.created_at,
      ]);
    }

    const csv = rows.map(row => row.join(',')).join('\n');
    c.header('Content-Type', 'text/csv');
    c.header('Content-Disposition', `attachment; filename="reviews-${status}-${Date.now()}.csv"`);
    return c.body(csv);
  } catch (err) {
    return fail(c, `Export failed: ${err.message}`, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: POST /api/reviews/admin/add
// ✅ Admin jaise chahe naam daale — author_name mein save hoga
// ============================================================
reviews.post('/admin/add', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { productId, rating, review, title, images = [], userName } = body;

    if (!productId) return fail(c, 'productId is required.', 400);
    if (!rating || rating < 1 || rating > 5) return fail(c, 'rating must be between 1 and 5.', 400);
    if (!review || !review.trim()) return fail(c, 'review text is required.', 400);
    if (!userName || !userName.trim()) return fail(c, 'userName (author name) is required.', 400);

    const product = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(productId).first();
    if (!product) return fail(c, 'Product not found.', 404);

    // ✅ Always same admin user
    const finalUserId = 'admin_review_user';

    // Ensure admin user exists (once)
    const existingUser = await c.env.DB.prepare('SELECT id FROM users WHERE id = ?').bind(finalUserId).first();
    if (!existingUser) {
      await c.env.DB.prepare(
        `INSERT INTO users (id, name, email, password, created_at) 
         VALUES (?, 'Admin', 'admin-review@mypinkshop.com', 'ADMIN_REVIEW_NO_LOGIN', datetime('now'))`
      ).bind(finalUserId).run();
    }

    const id = genId('rev');
    const imagesJson = toSafeJsonString(images);
    const authorName = userName.trim();      // ✅ Jo admin ne daala

    await c.env.DB.prepare(
      `INSERT INTO reviews 
        (id, user_id, product_id, rating, review, title, images, author_name, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'approved', datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        finalUserId,
        productId,
        parseInt(rating),
        review.trim(),
        (title || '').trim(),
        imagesJson,
        authorName
      )
      .run();

    await c.env.DB.prepare(
      `UPDATE products SET 
        rating = COALESCE((SELECT AVG(rating) FROM reviews WHERE product_id = ? AND status = 'approved'), 0),
        review_count = (SELECT COUNT(*) FROM reviews WHERE product_id = ? AND status = 'approved')
       WHERE id = ?`
    ).bind(productId, productId, productId).run();

    const created = await c.env.DB.prepare('SELECT * FROM reviews WHERE id = ?').bind(id).first();
    return ok(c, { review: serializeReview(created) }, undefined, 201);
  } catch (err) {
    console.error('Admin add review error:', err);
    return fail(c, `Failed to add review: ${err.message}`, 500);
  }
});

export default reviews;
