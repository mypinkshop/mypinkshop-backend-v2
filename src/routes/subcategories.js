// src/routes/subcategories.js
import { Hono } from 'hono';
import { authMiddleware } from './auth.js';

const subcategories = new Hono();

/* ------------------------------------------------------------------ */
/* Helper: slugify                                                     */
/* ------------------------------------------------------------------ */
function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/* ------------------------------------------------------------------ */
/* ✅ PUBLIC: GET /api/subcategories                                    */
/* Saari subcategories (optional category filter ke saath)             */
/* ------------------------------------------------------------------ */
subcategories.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const categorySlug = url.searchParams.get('category');

    let query = 'SELECT * FROM subcategories';
    const bindings = [];

    if (categorySlug) {
      query += ' WHERE category_slug = ?';
      bindings.push(categorySlug);
    }

    query += ' ORDER BY category_slug ASC, name ASC';

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

    return c.json({
      success: true,
      data: results || [],
      count: results?.length || 0,
    });
  } catch (error) {
    console.error('Get subcategories error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/* ------------------------------------------------------------------ */
/* ✅ PUBLIC: GET /api/subcategories/:categorySlug                     */
/* Category ki saari subcategories                                      */
/* ------------------------------------------------------------------ */
subcategories.get('/:categorySlug', async (c) => {
  try {
    const categorySlug = c.req.param('categorySlug');
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM subcategories 
       WHERE category_slug = ? 
       ORDER BY name ASC`
    ).bind(categorySlug).all();

    return c.json({
      success: true,
      data: results || [],
      count: results?.length || 0,
    });
  } catch (error) {
    console.error('Get subcategories error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/* ------------------------------------------------------------------ */
/* 🛡️ ADMIN: POST /api/subcategories                                   */
/* Nayi subcategory add karo                                            */
/* ------------------------------------------------------------------ */
subcategories.post('/', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { category_slug, name, icon } = body;

    if (!category_slug || !name) {
      return c.json({
        success: false,
        error: 'category_slug and name are required',
      }, 400);
    }

    const cleanName = String(name).trim();
    if (cleanName.length < 2) {
      return c.json({
        success: false,
        error: 'Name must be at least 2 characters',
      }, 400);
    }

    // Duplicate check (case-insensitive)
    const existing = await c.env.DB.prepare(
      `SELECT id FROM subcategories 
       WHERE category_slug = ? AND LOWER(name) = LOWER(?)`
    ).bind(category_slug, cleanName).first();

    if (existing) {
      return c.json({
        success: false,
        error: `Subcategory "${cleanName}" already exists in this category`,
      }, 409);
    }

    const id = `sub_${slugify(category_slug)}_${slugify(cleanName)}`;
    const iconValue = icon || '🌸';

    await c.env.DB.prepare(
      `INSERT INTO subcategories (id, category_slug, name, icon, created_at, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`
    ).bind(id, category_slug, cleanName, iconValue).run();

    return c.json({
      success: true,
      message: 'Subcategory created',
      data: {
        id,
        category_slug,
        name: cleanName,
        icon: iconValue,
      },
    }, 201);
  } catch (error) {
    console.error('Create subcategory error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

/* ------------------------------------------------------------------ */
/* 🛡️ ADMIN: DELETE /api/subcategories/:id                             */
/* Subcategory delete karo                                              */
/* ------------------------------------------------------------------ */
subcategories.delete('/:id', authMiddleware, async (c) => {
  try {
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare(
      `SELECT id FROM subcategories WHERE id = ?`
    ).bind(id).first();

    if (!existing) {
      return c.json({ success: false, error: 'Subcategory not found' }, 404);
    }

    await c.env.DB.prepare(
      `DELETE FROM subcategories WHERE id = ?`
    ).bind(id).run();

    return c.json({
      success: true,
      message: 'Subcategory deleted',
    });
  } catch (error) {
    console.error('Delete subcategory error:', error);
    return c.json({ success: false, error: error.message }, 500);
  }
});

export default subcategories;
