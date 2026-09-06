// src/routes/coupons.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const coupons = new Hono();

// ✅ GET /api/coupons/active - Active coupons for Cart page
coupons.get('/active', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM coupons WHERE is_active = 1 AND (expires_at IS NULL OR expires_at > datetime(\'now\')) ORDER BY created_at DESC'
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load coupons: ${err.message}`, 500);
  }
});

// ✅ POST /api/coupons/validate - Validate coupon code
coupons.post('/validate', async (c) => {
  try {
    const { code, cartTotal } = await c.req.json().catch(() => ({}));
    if (!code) return fail(c, 'Coupon code is required.', 400);

    const coupon = await c.env.DB.prepare(
      'SELECT * FROM coupons WHERE code = ? AND is_active = 1 AND (expires_at IS NULL OR expires_at > datetime(\'now\'))'
    ).bind(code.toUpperCase()).first();

    if (!coupon) return fail(c, 'Invalid coupon code.', 404);

    // Calculate discount
    let discountAmount = 0;
    if (coupon.discount_type === 'percentage') {
      discountAmount = (cartTotal * coupon.discount_value) / 100;
      if (coupon.max_discount > 0 && discountAmount > coupon.max_discount) {
        discountAmount = coupon.max_discount;
      }
    } else {
      discountAmount = coupon.discount_value;
    }

    return ok(c, {
      coupon,
      discountAmount: Math.round(discountAmount),
      valid: true
    });
  } catch (err) {
    return fail(c, `Failed to validate coupon: ${err.message}`, 500);
  }
});

// ✅ GET /api/coupons/all - All coupons (Admin only)
coupons.get('/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM coupons ORDER BY created_at DESC'
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load coupons: ${err.message}`, 500);
  }
});

// ✅ POST /api/coupons/create - Create coupon (Admin only)
coupons.post('/create', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      code,
      description = '',
      discountType = 'percentage',
      discountValue,
      minOrderValue = 0,
      maxDiscount = 0,
      usageLimit = 100,
      startDate,
      endDate,
      isActive = true,
    } = body;

    if (!code || discountValue === undefined) {
      return fail(c, 'code and discountValue are required.', 400);
    }

    const existing = await c.env.DB.prepare(
      'SELECT id FROM coupons WHERE code = ?'
    ).bind(code.toUpperCase()).first();

    if (existing) return fail(c, 'Coupon code already exists.', 409);

    const id = genId('coup');

    await c.env.DB.prepare(
      `INSERT INTO coupons 
        (id, code, description, discount_type, discount_value, min_order_value, max_discount, usage_limit, is_active, start_date, end_date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        code.toUpperCase(),
        description,
        discountType,
        discountValue,
        minOrderValue,
        maxDiscount,
        usageLimit,
        isActive ? 1 : 0,
        startDate || new Date().toISOString(),
        endDate || null
      )
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(id).first();
    return ok(c, created, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create coupon: ${err.message}`, 500);
  }
});

// ✅ PUT /api/coupons/update/:id - Update coupon (Admin only)
coupons.put('/update/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Coupon not found.', 404);

    const body = await c.req.json().catch(() => ({}));
    const merged = {
      code: body.code ? body.code.toUpperCase() : existing.code,
      description: body.description ?? existing.description,
      discount_type: body.discountType ?? existing.discount_type,
      discount_value: body.discountValue ?? existing.discount_value,
      min_order_value: body.minOrderValue ?? existing.min_order_value,
      max_discount: body.maxDiscount ?? existing.max_discount,
      usage_limit: body.usageLimit ?? existing.usage_limit,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active,
      start_date: body.startDate ?? existing.start_date,
      end_date: body.endDate ?? existing.end_date,
    };

    await c.env.DB.prepare(
      `UPDATE coupons SET code = ?, description = ?, discount_type = ?, discount_value = ?,
        min_order_value = ?, max_discount = ?, usage_limit = ?, is_active = ?, start_date = ?,
        end_date = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        merged.code,
        merged.description,
        merged.discount_type,
        merged.discount_value,
        merged.min_order_value,
        merged.max_discount,
        merged.usage_limit,
        merged.is_active,
        merged.start_date,
        merged.end_date,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update coupon: ${err.message}`, 500);
  }
});

// ✅ PATCH /api/coupons/toggle/:id - Toggle coupon active status (Admin only)
coupons.patch('/toggle/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM coupons WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Coupon not found.', 404);

    const newStatus = existing.is_active ? 0 : 1;
    await c.env.DB.prepare(
      'UPDATE coupons SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(newStatus, id).run();

    return ok(c, { success: true, is_active: newStatus });
  } catch (err) {
    return fail(c, `Failed to toggle coupon: ${err.message}`, 500);
  }
});

// ✅ DELETE /api/coupons/delete/:id - Delete coupon (Admin only)
coupons.delete('/delete/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare('DELETE FROM coupons WHERE id = ?').bind(id).run();
    if (result.meta?.changes === 0) return fail(c, 'Coupon not found.', 404);
    return ok(c, { success: true, id });
  } catch (err) {
    return fail(c, `Failed to delete coupon: ${err.message}`, 500);
  }
});

export default coupons;
