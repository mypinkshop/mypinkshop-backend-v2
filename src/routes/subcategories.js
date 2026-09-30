// src/routes/subcategories.js
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';

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
/* GET /api/subcategories/:categorySlug                                */
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
    throw new HTTPException(500, { message: 'Failed to fetch subcategories' });
  }
});

/* ------------------------------------------------------------------ */
/* GET /api/subcategories                                              */
/* Saari subcategories (admin ke liye)                                 */
/* ------------------------------------------------------------------ */
subcategories.get('/', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT * FROM subcategories ORDER BY category_slug ASC, name ASC`
    ).all();

    return c.json({
      success: true,
      data: results || [],
      count: results?.length || 0,
    });
  } catch (error) {
    console.error('Get all subcategories error:', error);
    throw new HTTPException(500, { message: 'Failed to fetch subcategories' });
  }
});

/* ------------------------------------------------------------------ */
/* POST /api/subcategories                                             */
/* Nayi subcategory add karo                                            */
/* ------------------------------------------------------------------ */
subcategories.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const { category_slug, name, icon } = body;

    // Validation
    if (!category_slug || !name) {
      throw new HTTPException(400, { message: 'category_slug and name are required' });
    }

    const cleanName = String(name).trim();
    if (cleanName.length < 2) {
      throw new HTTPException(400, { message: 'Name must be at least 2 characters' });
    }

    // Check duplicate (case-insensitive)
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

    // ID generate
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
    if (error instanceof HTTPException) throw error;
    console.error('Create subcategory error:', error);
    throw new HTTPException(500, { message: error.message || 'Failed to create subcategory' });
  }
});

/* ------------------------------------------------------------------ */
/* DELETE /api/subcategories/:id                                       */
/* Subcategory delete karo                                              */
/* ------------------------------------------------------------------ */
subcategories.delete('/:id', async (c) => {
  try {
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare(
      `SELECT id FROM subcategories WHERE id = ?`
    ).bind(id).first();

    if (!existing) {
      throw new HTTPException(404, { message: 'Subcategory not found' });
    }

    await c.env.DB.prepare(
      `DELETE FROM subcategories WHERE id = ?`
    ).bind(id).run();

    return c.json({
      success: true,
      message: 'Subcategory deleted',
    });
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    console.error('Delete subcategory error:', error);
    throw new HTTPException(500, { message: 'Failed to delete subcategory' });
  }
});

export default subcategories;
