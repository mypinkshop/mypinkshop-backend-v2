// backend/src/routes/appBanners.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const appBanners = new Hono();

// ============================================================
// ✅ PUBLIC ROUTES
// ============================================================

// GET /api/app-banners — Saare active app banners
appBanners.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const type = url.searchParams.get('type');
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 50, 100);

    let query = `
      SELECT * FROM app_banners 
      WHERE is_active = 1
        AND (start_date IS NULL OR start_date <= datetime('now'))
        AND (end_date IS NULL OR end_date >= datetime('now'))
    `;
    const bindings = [];

    if (type) {
      query += ' AND type = ?';
      bindings.push(type);
    }

    query += ' ORDER BY order_index ASC, created_at DESC LIMIT ?';
    bindings.push(limit);

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load app banners: ${err.message}`, 500);
  }
});

// GET /api/app-banners/admin/all — Saare banners (admin)
appBanners.get('/admin/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM app_banners ORDER BY order_index ASC, created_at DESC'
    ).all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load banners: ${err.message}`, 500);
  }
});

// GET /api/app-banners/:id — Ek banner
appBanners.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const banner = await c.env.DB.prepare(
      'SELECT * FROM app_banners WHERE id = ?'
    ).bind(id).first();

    if (!banner) return fail(c, 'Banner not found.', 404);
    return ok(c, banner);
  } catch (err) {
    return fail(c, `Failed to load banner: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ ADMIN ROUTES
// ============================================================

// POST /api/app-banners — Naya banner
appBanners.post('/', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      type = 'hero',
      title,
      subtitle,
      description,
      emoji,
      image,
      ctaText,
      ctaLink,
      // Existing fields
      gradientStart = '#EC4899',
      gradientEnd = '#F43F5E',
      bgColor,
      textColor = '#FFFFFF',
      orderIndex = 0,
      isActive = true,
      startDate,
      endDate,
      // ✅ NEW FIELDS — Text styling
      textSize = 'medium',
      textWeight = 'bold',
      textOpacity = 1.0,
      textPosition = 'center-left',
      textShadow = 0,
      // ✅ NEW FIELDS — Image styling
      imagePosition = 'right',
      imageSize = 'medium',
      // ✅ NEW FIELD — Layout
      layout = 'gradient',
    } = body;

    if (!title && !image) {
      return fail(c, 'title or image is required.', 400);
    }

    const id = genId('abn');

    await c.env.DB.prepare(
      `INSERT INTO app_banners 
        (id, type, title, subtitle, description, emoji, image, cta_text, cta_link,
         gradient_start, gradient_end, bg_color, text_color, order_index, is_active,
         start_date, end_date, 
         text_size, text_weight, text_opacity, text_position, text_shadow,
         image_position, image_size, layout,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(
      id, type, title || null, subtitle || null, description || null,
      emoji || null, image || null, ctaText || null, ctaLink || null,
      gradientStart, gradientEnd, bgColor || null, textColor,
      parseInt(orderIndex) || 0, isActive ? 1 : 0,
      startDate || null, endDate || null,
      textSize, textWeight, parseFloat(textOpacity) || 1.0, textPosition,
      parseInt(textShadow) || 0,
      imagePosition, imageSize, layout
    ).run();

    const created = await c.env.DB.prepare(
      'SELECT * FROM app_banners WHERE id = ?'
    ).bind(id).first();

    return ok(c, created, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create banner: ${err.message}`, 500);
  }
});

// PUT /api/app-banners/:id — Update
appBanners.put('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));

    const existing = await c.env.DB.prepare(
      'SELECT * FROM app_banners WHERE id = ?'
    ).bind(id).first();
    if (!existing) return fail(c, 'Banner not found.', 404);

    const merged = {
      type: body.type ?? existing.type,
      title: body.title ?? existing.title,
      subtitle: body.subtitle ?? existing.subtitle,
      description: body.description ?? existing.description,
      emoji: body.emoji ?? existing.emoji,
      image: body.image ?? existing.image,
      cta_text: body.ctaText ?? existing.cta_text,
      cta_link: body.ctaLink ?? existing.cta_link,
      gradient_start: body.gradientStart ?? existing.gradient_start,
      gradient_end: body.gradientEnd ?? existing.gradient_end,
      bg_color: body.bgColor ?? existing.bg_color,
      text_color: body.textColor ?? existing.text_color,
      order_index: body.orderIndex !== undefined ? parseInt(body.orderIndex) : existing.order_index,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active,
      start_date: body.startDate !== undefined ? body.startDate : existing.start_date,
      end_date: body.endDate !== undefined ? body.endDate : existing.end_date,
      // ✅ NEW FIELDS
      text_size: body.textSize ?? existing.text_size ?? 'medium',
      text_weight: body.textWeight ?? existing.text_weight ?? 'bold',
      text_opacity: body.textOpacity !== undefined ? parseFloat(body.textOpacity) : (existing.text_opacity ?? 1.0),
      text_position: body.textPosition ?? existing.text_position ?? 'center-left',
      text_shadow: body.textShadow !== undefined ? parseInt(body.textShadow) : (existing.text_shadow ?? 0),
      image_position: body.imagePosition ?? existing.image_position ?? 'right',
      image_size: body.imageSize ?? existing.image_size ?? 'medium',
      layout: body.layout ?? existing.layout ?? 'gradient',
    };

    await c.env.DB.prepare(
      `UPDATE app_banners SET 
        type = ?, title = ?, subtitle = ?, description = ?, emoji = ?, image = ?,
        cta_text = ?, cta_link = ?, gradient_start = ?, gradient_end = ?,
        bg_color = ?, text_color = ?, order_index = ?, is_active = ?,
        start_date = ?, end_date = ?,
        text_size = ?, text_weight = ?, text_opacity = ?, text_position = ?, text_shadow = ?,
        image_position = ?, image_size = ?, layout = ?,
        updated_at = datetime('now')
       WHERE id = ?`
    ).bind(
      merged.type, merged.title, merged.subtitle, merged.description, merged.emoji, merged.image,
      merged.cta_text, merged.cta_link, merged.gradient_start, merged.gradient_end,
      merged.bg_color, merged.text_color, merged.order_index, merged.is_active,
      merged.start_date, merged.end_date,
      merged.text_size, merged.text_weight, merged.text_opacity, merged.text_position, merged.text_shadow,
      merged.image_position, merged.image_size, merged.layout,
      id
    ).run();

    const updated = await c.env.DB.prepare(
      'SELECT * FROM app_banners WHERE id = ?'
    ).bind(id).first();

    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update banner: ${err.message}`, 500);
  }
});

// PATCH /api/app-banners/:id/toggle — Active/Inactive
appBanners.patch('/:id/toggle', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare(
      'SELECT is_active FROM app_banners WHERE id = ?'
    ).bind(id).first();

    if (!existing) return fail(c, 'Banner not found.', 404);

    const newStatus = existing.is_active ? 0 : 1;

    await c.env.DB.prepare(
      `UPDATE app_banners SET is_active = ?, updated_at = datetime('now') WHERE id = ?`
    ).bind(newStatus, id).run();

    return ok(c, { id, is_active: newStatus });
  } catch (err) {
    return fail(c, `Failed to toggle banner: ${err.message}`, 500);
  }
});

// DELETE /api/app-banners/:id
appBanners.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      'DELETE FROM app_banners WHERE id = ?'
    ).bind(id).run();

    if (result.meta?.changes === 0) {
      return fail(c, 'Banner not found.', 404);
    }

    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete banner: ${err.message}`, 500);
  }
});

// PUT /api/app-banners/reorder/bulk — Bulk reorder
appBanners.put('/reorder/bulk', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { order } = body;

    if (!Array.isArray(order) || order.length === 0) {
      return fail(c, 'order array is required.', 400);
    }

    for (const item of order) {
      if (!item.id || item.orderIndex === undefined) continue;
      await c.env.DB.prepare(
        `UPDATE app_banners SET order_index = ?, updated_at = datetime('now') WHERE id = ?`
      ).bind(parseInt(item.orderIndex), item.id).run();
    }

    return ok(c, { reordered: order.length });
  } catch (err) {
    return fail(c, `Failed to reorder banners: ${err.message}`, 500);
  }
});

export default appBanners;
