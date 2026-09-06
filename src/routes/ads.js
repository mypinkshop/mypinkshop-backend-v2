// src/routes/ads.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const ads = new Hono();

const VALID_POSITIONS = ['homepage_top', 'homepage_mid', 'category_top', 'sidebar', 'checkout'];

/* --------------------------------------------------------------------- */
/* Public                                                                 */
/* --------------------------------------------------------------------- */

// GET /api/ads/public/banners
ads.get('/public/banners', async (c) => {
  try {
    const url = new URL(c.req.url);
    const position = url.searchParams.get('position');

    const conditions = [
      'is_active = 1',
      "(start_date IS NULL OR start_date <= datetime('now'))",
      "(end_date IS NULL OR end_date >= datetime('now'))",
    ];
    const bindings = [];

    if (position) {
      conditions.push('position = ?');
      bindings.push(position);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT id, title, image, link, vendor_id, position, clicks, impressions, created_at
       FROM ads WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`
    )
      .bind(...bindings)
      .all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load ad banners: ${err.message}`, 500);
  }
});

// GET /api/ads/public/sponsored-products
ads.get('/public/sponsored-products', async (c) => {
  try {
    const url = new URL(c.req.url);
    let limit = parseInt(url.searchParams.get('limit') || '4', 10);
    if (limit > 20) limit = 20;

    // Is query mein hum sponsored products select karte hain
    const { results } = await c.env.DB.prepare(
      `SELECT id, name, price, original_price, images, is_active, is_featured
       FROM products
       WHERE is_active = 1 AND is_featured = 1
       ORDER BY created_at DESC
       LIMIT ?`
    )
      .bind(limit)
      .all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load sponsored products: ${err.message}`, 500);
  }
});

// POST /api/ads/:id/click - increment click count (public, fire-and-forget from frontend)
ads.post('/:id/click', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare('UPDATE ads SET clicks = clicks + 1 WHERE id = ?').bind(id).run();
    return ok(c, { id, tracked: true });
  } catch (err) {
    return fail(c, `Failed to track click: ${err.message}`, 500);
  }
});

// POST /api/ads/:id/impression
ads.post('/:id/impression', async (c) => {
  try {
    const id = c.req.param('id');
    await c.env.DB.prepare('UPDATE ads SET impressions = impressions + 1 WHERE id = ?').bind(id).run();
    return ok(c, { id, tracked: true });
  } catch (err) {
    return fail(c, `Failed to track impression: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* Admin                                                                  */
/* --------------------------------------------------------------------- */

// GET /api/ads - list all ads (admin)
ads.get('/', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare('SELECT * FROM ads ORDER BY created_at DESC').all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load ads: ${err.message}`, 500);
  }
});

// POST /api/ads/create
ads.post('/create', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      title,
      image,
      link = '/shop',
      vendorId = 'admin',
      position = 'homepage_top',
      isActive = true,
      startDate = null,
      endDate = null,
    } = body;

    if (!title || !image) return fail(c, 'title and image are required.', 400);
    if (!VALID_POSITIONS.includes(position)) {
      return fail(c, `position must be one of: ${VALID_POSITIONS.join(', ')}`, 400);
    }

    const id = genId('ad');

    await c.env.DB.prepare(
      `INSERT INTO ads
        (id, title, image, link, vendor_id, position, is_active, start_date, end_date,
         clicks, impressions, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, datetime('now'))`
    )
      .bind(id, title, image, link, vendorId, position, isActive ? 1 : 0, startDate, endDate)
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM ads WHERE id = ?').bind(id).first();
    return ok(c, created, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create ad: ${err.message}`, 500);
  }
});

// PUT /api/ads/:id
ads.put('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM ads WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Ad not found.', 404);

    const body = await c.req.json().catch(() => ({}));
    const merged = {
      title: body.title ?? existing.title,
      image: body.image ?? existing.image,
      link: body.link ?? existing.link,
      position: body.position ?? existing.position,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active,
      start_date: body.startDate ?? existing.start_date,
      end_date: body.endDate ?? existing.end_date,
    };

    await c.env.DB.prepare(
      `UPDATE ads SET title = ?, image = ?, link = ?, position = ?, is_active = ?,
        start_date = ?, end_date = ? WHERE id = ?`
    )
      .bind(
        merged.title,
        merged.image,
        merged.link,
        merged.position,
        merged.is_active,
        merged.start_date,
        merged.end_date,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM ads WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update ad: ${err.message}`, 500);
  }
});

// DELETE /api/ads/:id
ads.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare('DELETE FROM ads WHERE id = ?').bind(id).run();
    if (result.meta?.changes === 0) return fail(c, 'Ad not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete ad: ${err.message}`, 500);
  }
});

export default ads;
