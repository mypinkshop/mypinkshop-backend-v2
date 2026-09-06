// src/routes/offers.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const offers = new Hono();

const VALID_TYPES = ['top_banner', 'popup', 'coupon'];
const VALID_DISCOUNT_TYPES = ['percentage', 'fixed'];

/* --------------------------------------------------------------------- */
/* Public                                                                 */
/* --------------------------------------------------------------------- */

// GET /api/offers/active-offer
// Returns the single most relevant currently-active offer, or null.
offers.get('/active-offer', async (c) => {
  try {
    const offer = await c.env.DB.prepare(
      `SELECT * FROM offers
       WHERE is_active = 1
         AND (start_date IS NULL OR start_date <= datetime('now'))
         AND (end_date IS NULL OR end_date >= datetime('now'))
       ORDER BY created_at DESC
       LIMIT 1`
    ).first();

    return ok(c, offer || null);
  } catch (err) {
    return fail(c, `Failed to load active offer: ${err.message}`, 500);
  }
});

// GET /api/offers  (all active offers, e.g. for a popup carousel)
offers.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM offers
       WHERE is_active = 1
         AND (start_date IS NULL OR start_date <= datetime('now'))
         AND (end_date IS NULL OR end_date >= datetime('now'))
       ORDER BY created_at DESC`
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
      'SELECT * FROM offers ORDER BY created_at DESC'
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

    const id = genId('off');

    await c.env.DB.prepare(
      `INSERT INTO offers
        (id, title, description, is_active, type, discount_type, discount_value,
         min_order_value, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), ?, datetime('now'), datetime('now'))`
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
        endDate
      )
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
    return ok(c, created, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create offer: ${err.message}`, 500);
  }
});

// PUT /api/offers/:id
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
    };

    await c.env.DB.prepare(
      `UPDATE offers SET title = ?, description = ?, is_active = ?, type = ?, discount_type = ?,
        discount_value = ?, min_order_value = ?, start_date = ?, end_date = ?, updated_at = datetime('now')
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
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM offers WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update offer: ${err.message}`, 500);
  }
});

// DELETE /api/offers/:id
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
