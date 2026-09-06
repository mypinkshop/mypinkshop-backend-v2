// src/routes/banners.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const banners = new Hono();

/* --------------------------------------------------------------------- */
/* Public                                                                 */
/* --------------------------------------------------------------------- */

// GET /api/banners/active
banners.get('/active', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM banners WHERE active = 1 ORDER BY sort_order ASC, created_at DESC`
    ).all();

    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load active banners: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* Admin                                                                  */
/* --------------------------------------------------------------------- */

// GET /api/banners  (all banners, admin)
banners.get('/', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM banners ORDER BY sort_order ASC, created_at DESC'
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load banners: ${err.message}`, 500);
  }
});

// POST /api/banners/create
banners.post('/create', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      title,
      subtitle = '',
      buttonText = 'Shop Now',
      link = '/shop',
      image = '',
      imageKey = '',
      order = 0,
      active = true,
    } = body;

    if (!title) return fail(c, 'title is required.', 400);

    const id = genId('ban');

    await c.env.DB.prepare(
      `INSERT INTO banners
        (id, title, subtitle, button_text, link, image, image_key, sort_order, active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(id, title, subtitle, buttonText, link, image, imageKey, order, active ? 1 : 0)
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
    return ok(c, created, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create banner: ${err.message}`, 500);
  }
});

// PUT /api/banners/:id
banners.put('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Banner not found.', 404);

    const body = await c.req.json().catch(() => ({}));
    const merged = {
      title: body.title ?? existing.title,
      subtitle: body.subtitle ?? existing.subtitle,
      button_text: body.buttonText ?? existing.button_text,
      link: body.link ?? existing.link,
      image: body.image ?? existing.image,
      image_key: body.imageKey ?? existing.image_key,
      sort_order: body.order ?? existing.sort_order,
      active: body.active !== undefined ? (body.active ? 1 : 0) : existing.active,
    };

    await c.env.DB.prepare(
      `UPDATE banners SET title = ?, subtitle = ?, button_text = ?, link = ?, image = ?,
        image_key = ?, sort_order = ?, active = ? WHERE id = ?`
    )
      .bind(
        merged.title,
        merged.subtitle,
        merged.button_text,
        merged.link,
        merged.image,
        merged.image_key,
        merged.sort_order,
        merged.active,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update banner: ${err.message}`, 500);
  }
});

// DELETE /api/banners/:id
banners.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare('DELETE FROM banners WHERE id = ?').bind(id).run();
    if (result.meta?.changes === 0) return fail(c, 'Banner not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete banner: ${err.message}`, 500);
  }
});

export default banners;
