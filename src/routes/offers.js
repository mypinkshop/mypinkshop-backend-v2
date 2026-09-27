// src/routes/offers.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const offers = new Hono();

const VALID_TYPES = ['top_banner', 'popup', 'coupon', 'category_banner'];
const VALID_DISCOUNT_TYPES = ['percentage', 'fixed'];
const VALID_POSITIONS = [
  'top_banner',      // Global top (all pages)
  'category_top',    // Category page top
  'category_mid',    // Category page middle
  'category_bottom', // Category page bottom
  'product_page',    // Product detail page
  'checkout',        // Checkout page
  'popup',           // Popup modal
];

/* --------------------------------------------------------------------- */
/* Public                                                                 */
/* --------------------------------------------------------------------- */

// GET /api/offers/active-offer
// Returns single most relevant active offer (legacy support)
offers.get('/active-offer', async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');

    let query = `
      SELECT * FROM offers
      WHERE is_active = 1
        AND (start_date IS NULL OR start_date <= datetime('now'))
        AND (end_date IS NULL OR end_date >= datetime('now'))
    `;
    const bindings = [];

    if (category) {
      query += ` AND (category = ? OR category IS NULL)`;
      bindings.push(category);
    } else {
      query += ` AND category IS NULL`;
    }

    query += ` ORDER BY priority DESC, created_at DESC LIMIT 1`;

    const offer = await c.env.DB.prepare(query).bind(...bindings).first();
    return ok(c, offer || null);
  } catch (err) {
    return fail(c, `Failed to load active offer: ${err.message}`, 500);
  }
});

// GET /api/offers/active?category=electronics&position=category_top
// Returns multiple active offers (category-wise + global)
offers.get('/active', async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');
    const position = url.searchParams.get('position');

    let query = `
      SELECT * FROM offers
      WHERE is_active = 1
        AND (start_date IS NULL OR start_date <= datetime('now'))
        AND (end_date IS NULL OR end_date >= datetime('now'))
    `;
    const bindings = [];

    if (category) {
      query += ` AND (category = ? OR category IS NULL)`;
      bindings.push(category);
    } else {
      query += ` AND category IS NULL`;
    }

    if (position) {
      query += ` AND position = ?`;
      bindings.push(position);
    }

    query += ` ORDER BY priority DESC, created_at DESC`;

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load active offers: ${err.message}`, 500);
  }
});

// GET /api/offers  (all active offers, e.g. for carousel)
offers.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM offers
       WHERE is_active = 1
         AND (start_date IS NULL OR start_date <= datetime('now'))
         AND (end_date IS NULL OR end_date >= datetime('now'))
       ORDER BY priority DESC, created_at DESC`
    ).all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load offers: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* Admin                                                                  */
/* --------------------------------------------------------------------- */

// GET /api/offers/admin/all - list every offer (admin)
offers.get('/admin/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM offers ORDER BY priority DESC, created_at DESC'
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load offers: ${err.message}`, 500);
  }
});

// Alias: GET /api/offers/all (admin)
offers.get('/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM offers ORDER BY priority DESC, created_at DESC'
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load offers: ${err.message}`, 500);
  }
});

// POST /api/offers/create
offers.post('/create', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      title,
      description,
      isActive = true,
      type = 'top_banner',
      discountType = 'percentage',
      discountValue = 10,
      minOrderValue = 0,
      startDate = null,
      endDate = null,
      category = null,                    // ✅ NAYA
      position = 'top_banner',            // ✅ NAYA
      icon = '🎉',                        // ✅ NAYA
      priority = 0,                       // ✅ NAYA
    } = body;

    if (!title || !description) {
      return fail(c, 'title and description are required.', 400);
    }
    if (!VALID_TYPES.includes(type)) {
      return fail(c, `type must be one of: ${VALID_TYPES.join(', ')}`, 400);
    }
    if (!VALID_DISCOUNT_TYPES.includes(discountType)) {
      return fail(c, `discountType must be one of: ${VALID_DISCOUNT_TYPES.join(', ')}`, 400);
    }
    if (!VALID_POSITIONS.includes(position)) {
      return fail(c, `position must be one of: ${VALID_POSITIONS.join(', ')}`, 400);
    }

    const id = genId('off');

    await c.env.DB.prepare(
      `INSERT INTO offers
        (id, title, description, is_active, type, discount_type, discount_value,
         min_order_value, start_date, end_date, category, position, icon, priority,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        title,
        description,
        isActive ? 1 : 0,
        type,
        discountType,
        discountValue,
        minOrderValue,
        startDate,
        endDate,
        category,
        position,
        icon,
        priority
      )
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
    return ok(c, created, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create offer: ${err.message}`, 500);
  }
});

// PUT /api/offers/update/:id
offers.put('/update/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Offer not found.', 404);

    const body = await c.req.json().catch(() => ({}));
    const merged = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active,
      type: body.type ?? existing.type,
      discount_type: body.discountType ?? existing.discount_type,
      discount_value: body.discountValue ?? existing.discount_value,
      min_order_value: body.minOrderValue ?? existing.min_order_value,
      start_date: body.startDate ?? existing.start_date,
      end_date: body.endDate ?? existing.end_date,
      category: body.category !== undefined ? (body.category || null) : existing.category,   // ✅ NAYA
      position: body.position ?? existing.position ?? 'top_banner',                           // ✅ NAYA
      icon: body.icon ?? existing.icon ?? '🎉',                                                // ✅ NAYA
      priority: body.priority !== undefined ? parseInt(body.priority) : (existing.priority ?? 0), // ✅ NAYA
    };

    await c.env.DB.prepare(
      `UPDATE offers SET 
        title = ?, description = ?, is_active = ?, type = ?, 
        discount_type = ?, discount_value = ?, min_order_value = ?, 
        start_date = ?, end_date = ?, category = ?, position = ?, 
        icon = ?, priority = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        merged.title,
        merged.description,
        merged.is_active,
        merged.type,
        merged.discount_type,
        merged.discount_value,
        merged.min_order_value,
        merged.start_date,
        merged.end_date,
        merged.category,
        merged.position,
        merged.icon,
        merged.priority,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update offer: ${err.message}`, 500);
  }
});

// Alias: PUT /api/offers/:id
offers.put('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Offer not found.', 404);

    const body = await c.req.json().catch(() => ({}));
    const merged = {
      title: body.title ?? existing.title,
      description: body.description ?? existing.description,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active,
      type: body.type ?? existing.type,
      discount_type: body.discountType ?? existing.discount_type,
      discount_value: body.discountValue ?? existing.discount_value,
      min_order_value: body.minOrderValue ?? existing.min_order_value,
      start_date: body.startDate ?? existing.start_date,
      end_date: body.endDate ?? existing.end_date,
      category: body.category !== undefined ? (body.category || null) : existing.category,
      position: body.position ?? existing.position ?? 'top_banner',
      icon: body.icon ?? existing.icon ?? '🎉',
      priority: body.priority !== undefined ? parseInt(body.priority) : (existing.priority ?? 0),
    };

    await c.env.DB.prepare(
      `UPDATE offers SET 
        title = ?, description = ?, is_active = ?, type = ?, 
        discount_type = ?, discount_value = ?, min_order_value = ?, 
        start_date = ?, end_date = ?, category = ?, position = ?, 
        icon = ?, priority = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        merged.title,
        merged.description,
        merged.is_active,
        merged.type,
        merged.discount_type,
        merged.discount_value,
        merged.min_order_value,
        merged.start_date,
        merged.end_date,
        merged.category,
        merged.position,
        merged.icon,
        merged.priority,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update offer: ${err.message}`, 500);
  }
});

// PATCH /api/offers/toggle/:id - toggle active status
offers.patch('/toggle/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Offer not found.', 404);

    const newStatus = existing.is_active ? 0 : 1;

    await c.env.DB.prepare(
      `UPDATE offers SET is_active = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newStatus, id).run();

    return ok(c, { id, isActive: newStatus === 1 });
  } catch (err) {
    return fail(c, `Failed to toggle offer: ${err.message}`, 500);
  }
});

// DELETE /api/offers/delete/:id
offers.delete('/delete/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare('DELETE FROM offers WHERE id = ?').bind(id).run();
    if (result.meta?.changes === 0) return fail(c, 'Offer not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete offer: ${err.message}`, 500);
  }
});

// Alias: DELETE /api/offers/:id
offers.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare('DELETE FROM offers WHERE id = ?').bind(id).run();
    if (result.meta?.changes === 0) return fail(c, 'Offer not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete offer: ${err.message}`, 500);
  }
});

export default offers;
