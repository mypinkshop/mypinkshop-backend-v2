// src/routes/banners.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const banners = new Hono();

/* --------------------------------------------------------------------- */
/* Public                                                                */
/* --------------------------------------------------------------------- */

// GET /api/banners/active
// Query params: ?category=electronics & ?position=category_hero
banners.get('/active', async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');
    const position = url.searchParams.get('position');

    let query = 'SELECT * FROM banners WHERE active = 1';
    const bindings = [];

    if (category) {
      // Category-specific + global (jinka category NULL hai)
      query += ' AND (category = ? OR category IS NULL)';
      bindings.push(category);
    }

    if (position) {
      query += ' AND position = ?';
      bindings.push(position);
    }

    query += ' ORDER BY sort_order ASC, created_at DESC';

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

    const formatted = (results || []).map(b => ({
      _id: b.id,
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      buttonText: b.button_text,
      link: b.link,
      images: b.image ? [b.image] : [],
      order: b.sort_order,
      active: b.active === 1,
      showTextOverlay: true,
      category: b.category || null,
      position: b.position || 'home_hero',
    }));

    return c.json(formatted);
  } catch (err) {
    return fail(c, `Failed to load active banners: ${err.message}`, 500);
  }
});

// GET /api/banners?category=electronics&position=category_hero
banners.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');
    const position = url.searchParams.get('position');
    const all = url.searchParams.get('all') === 'true';

    let query = 'SELECT * FROM banners WHERE 1=1';
    const bindings = [];

    if (!all) {
      query += ' AND active = 1';
    }

    if (category) {
      query += ' AND (category = ? OR category IS NULL)';
      bindings.push(category);
    }

    if (position) {
      query += ' AND position = ?';
      bindings.push(position);
    }

    query += ' ORDER BY sort_order ASC, created_at DESC';

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

    const formatted = (results || []).map(b => ({
      _id: b.id,
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      buttonText: b.button_text,
      link: b.link,
      images: b.image ? [b.image] : [],
      order: b.sort_order,
      active: b.active === 1,
      showTextOverlay: true,
      category: b.category || null,
      position: b.position || 'home_hero',
    }));

    return c.json(formatted);
  } catch (err) {
    return fail(c, `Failed to load banners: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* Admin                                                                 */
/* --------------------------------------------------------------------- */

// GET /api/banners/all (admin — saare, including inactive)
banners.get('/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM banners ORDER BY sort_order ASC, created_at DESC'
    ).all();

    const formatted = (results || []).map(b => ({
      _id: b.id,
      id: b.id,
      title: b.title,
      subtitle: b.subtitle,
      buttonText: b.button_text,
      link: b.link,
      images: b.image ? [b.image] : [],
      order: b.sort_order,
      active: b.active === 1,
      showTextOverlay: true,
      category: b.category || null,
      position: b.position || 'home_hero',
    }));

    return c.json(formatted);
  } catch (err) {
    return fail(c, `Failed to load banners: ${err.message}`, 500);
  }
});

// Helper: image upload
async function handleImageUpload(body) {
  let imageUrl = body.image || '';
  const uploadedFile = body.images || body.image;

  if (uploadedFile && typeof uploadedFile === 'object' && typeof uploadedFile.arrayBuffer === 'function') {
    try {
      const buffer = await uploadedFile.arrayBuffer();
      const base64 = btoa(String.fromCharCode(...new Uint8Array(buffer)));
      imageUrl = `data:${uploadedFile.type || 'image/jpeg'};base64,${base64}`;
    } catch (e) {
      console.error('Image conversion error:', e);
    }
  }
  return imageUrl;
}

// POST /api/banners
banners.post('/', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.parseBody().catch(() => ({}));
    const title = body.title;
    const subtitle = body.subtitle || '';
    const buttonText = body.buttonText || 'Shop Now';
    const link = body.link || '/shop';
    const image = await handleImageUpload(body);
    const imageKey = body.imageKey || '';
    const order = parseInt(body.order) || 0;
    const active = body.active === 'false' || body.active === false ? 0 : 1;
    const category = body.category || null;          // ✅ NAYA
    const position = body.position || 'home_hero';   // ✅ NAYA

    if (!title) return fail(c, 'title is required.', 400);

    const id = genId('ban');

    await c.env.DB.prepare(
      `INSERT INTO banners
        (id, title, subtitle, button_text, link, image, image_key, sort_order, active, category, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(id, title, subtitle, buttonText, link, image, imageKey, order, active, category, position)
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
    return ok(c, created, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create banner: ${err.message}`, 500);
  }
});

// POST /api/banners/create (Alias)
banners.post('/create', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.parseBody().catch(() => ({}));
    const title = body.title;
    const subtitle = body.subtitle || '';
    const buttonText = body.buttonText || 'Shop Now';
    const link = body.link || '/shop';
    const image = await handleImageUpload(body);
    const imageKey = body.imageKey || '';
    const order = parseInt(body.order) || 0;
    const active = body.active === 'false' || body.active === false ? 0 : 1;
    const category = body.category || null;
    const position = body.position || 'home_hero';

    if (!title) return fail(c, 'title is required.', 400);

    const id = genId('ban');

    await c.env.DB.prepare(
      `INSERT INTO banners
        (id, title, subtitle, button_text, link, image, image_key, sort_order, active, category, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    )
      .bind(id, title, subtitle, buttonText, link, image, imageKey, order, active, category, position)
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

    const body = await c.req.parseBody().catch(() => ({}));
    const newImage = await handleImageUpload(body);

    const merged = {
      title: body.title ?? existing.title,
      subtitle: body.subtitle ?? existing.subtitle,
      button_text: body.buttonText ?? existing.button_text,
      link: body.link ?? existing.link,
      image: newImage || existing.image,
      image_key: body.imageKey ?? existing.image_key,
      sort_order: body.order !== undefined ? parseInt(body.order) : existing.sort_order,
      active: body.active !== undefined
        ? (body.active === 'false' || body.active === false ? 0 : 1)
        : existing.active,
      category: body.category !== undefined ? (body.category || null) : existing.category,    // ✅ NAYA
      position: body.position !== undefined ? body.position : existing.position,                // ✅ NAYA
    };

    await c.env.DB.prepare(
      `UPDATE banners SET 
        title = ?, subtitle = ?, button_text = ?, link = ?, image = ?,
        image_key = ?, sort_order = ?, active = ?, category = ?, position = ?
       WHERE id = ?`
    )
      .bind(
        merged.title, merged.subtitle, merged.button_text, merged.link, merged.image,
        merged.image_key, merged.sort_order, merged.active, merged.category, merged.position,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update banner: ${err.message}`, 500);
  }
});

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
