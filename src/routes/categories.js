// src/routes/categories.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail } from '../lib/utils.js';

const categories = new Hono();

// ============================================================
// ✅ Helpers
// ============================================================
const generateId = () => 'cat_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 8);

const generateSlug = (name) => {
  return name.toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
};

// ============================================================
// ✅ PUBLIC: GET /api/categories
// Saari active categories (main + sub)
// ============================================================
categories.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const type = url.searchParams.get('type');        // 'main' | 'sub' | null
    const parentId = url.searchParams.get('parent_id'); // parent filter
    const includeInactive = url.searchParams.get('all') === 'true';

    let whereClause = includeInactive ? 'WHERE 1=1' : "WHERE status = 'active'";
    const bindings = [];

    if (type) {
      whereClause += ' AND type = ?';
      bindings.push(type);
    }

    if (parentId) {
      whereClause += ' AND parent_id = ?';
      bindings.push(parentId);
    }

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM categories 
       ${whereClause}
       ORDER BY "order" ASC, name ASC`
    ).bind(...bindings).all();

    return ok(c, results || []);
  } catch (error) {
    console.error('Categories list error:', error);
    return fail(c, error.message, 500);
  }
});

// ============================================================
// ✅ PUBLIC: GET /api/categories/tree
// Nested structure — main categories with their subs
// ============================================================
categories.get('/tree', async (c) => {
  try {
    const { results: all } = await c.env.DB.prepare(
      `SELECT * FROM categories 
       WHERE status = 'active'
       ORDER BY "order" ASC, name ASC`
    ).all();

    const mains = (all || []).filter(cat => cat.type === 'main' || !cat.parent_id);
    const subs = (all || []).filter(cat => cat.type === 'sub' && cat.parent_id);

    const tree = mains.map(main => ({
      ...main,
      children: subs.filter(sub => sub.parent_id === main.id)
    }));

    return ok(c, tree);
  } catch (error) {
    console.error('Categories tree error:', error);
    return fail(c, error.message, 500);
  }
});

// ============================================================
// ✅ PUBLIC: GET /api/categories/:id
// ============================================================
categories.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const category = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    if (!category) return fail(c, 'Category not found', 404);
    return ok(c, category);
  } catch (error) {
    return fail(c, error.message, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: POST /api/categories
// Naya category ya sub-category banao
// ============================================================
categories.post('/', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { name, slug, icon, status, order, description, type, parent_id, image } = body;

    if (!name || !name.trim()) {
      return fail(c, 'Category name is required', 400);
    }

    // ✅ Duplicate check
    const existing = await c.env.DB.prepare(
      'SELECT id FROM categories WHERE LOWER(name) = LOWER(?)'
    ).bind(name.trim()).first();

    if (existing) {
      // Agar already hai to existing return karo (auto-create case)
      return c.json({
        success: true,
        message: 'Category already exists',
        id: existing.id,
        existing: true
      });
    }

    const id = generateId();
    const catSlug = slug || generateSlug(name);
    const catType = type || 'main';

    // ✅ Agar sub category hai to parent validate karo
    if (catType === 'sub' && parent_id) {
      const parent = await c.env.DB.prepare('SELECT id FROM categories WHERE id = ?').bind(parent_id).first();
      if (!parent) return fail(c, 'Parent category not found', 404);
    }

    await c.env.DB.prepare(
      `INSERT INTO categories 
        (id, name, slug, icon, status, "order", description, type, parent_id, image)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      name.trim(),
      catSlug,
      icon || '📁',
      status || 'active',
      parseInt(order) || 0,
      description || '',
      catType,
      parent_id || null,
      image || null
    ).run();

    const created = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();

    return ok(c, { category: created, id }, undefined, 201);
  } catch (error) {
    console.error('Category create error:', error);
    return fail(c, error.message, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: PUT /api/categories/:id
// ============================================================
categories.put('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { name, slug, icon, status, order, description, type, parent_id, image } = body;

    const existing = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Category not found', 404);

    if (!name || !name.trim()) {
      return fail(c, 'Category name is required', 400);
    }

    const catSlug = slug || generateSlug(name);

    await c.env.DB.prepare(
      `UPDATE categories SET 
        name = ?, slug = ?, icon = ?, status = ?, "order" = ?, 
        description = ?, type = ?, parent_id = ?, image = ?
       WHERE id = ?`
    ).bind(
      name.trim(),
      catSlug,
      icon || existing.icon || '📁',
      status || existing.status || 'active',
      parseInt(order) ?? existing.order ?? 0,
      description ?? existing.description ?? '',
      type || existing.type || 'main',
      parent_id ?? existing.parent_id ?? null,
      image ?? existing.image ?? null,
      id
    ).run();

    const updated = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    return ok(c, { category: updated });
  } catch (error) {
    console.error('Category update error:', error);
    return fail(c, error.message, 500);
  }
});

// ============================================================
// 🛡️ ADMIN: DELETE /api/categories/:id
// ============================================================
categories.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');

    const existing = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Category not found', 404);

    // ✅ Check: kitne products is category mein hain
    const productCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM products WHERE main_category = ? OR sub_category = ?'
    ).bind(existing.name, existing.name).first();

    if (productCount?.count > 0) {
      return fail(c, `Cannot delete. ${productCount.count} products use this category.`, 400);
    }

    // ✅ Check: sub categories hain?
    const subCount = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM categories WHERE parent_id = ?'
    ).bind(id).first();

    if (subCount?.count > 0) {
      return fail(c, `Cannot delete. ${subCount.count} sub-categories exist.`, 400);
    }

    await c.env.DB.prepare('DELETE FROM categories WHERE id = ?').bind(id).run();
    return ok(c, { id, deleted: true });
  } catch (error) {
    console.error('Category delete error:', error);
    return fail(c, error.message, 500);
  }
});

// ============================================================
// ✅ PUBLIC: POST /api/categories/ensure
// Frontend se call karega — auto-create category/sub
// (Ye endpoint admin auth ke bina bhi kaam karega — kyunki product add ke saath call hoga)
// ============================================================
categories.post('/ensure', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { mainCategory, subCategory } = body;

    const result = { main: null, sub: null };

    // ✅ Main category ensure karo
    if (mainCategory && mainCategory.trim()) {
      const name = mainCategory.trim();
      let existing = await c.env.DB.prepare(
        'SELECT * FROM categories WHERE LOWER(name) = LOWER(?)'
      ).bind(name).first();

      if (!existing) {
        const id = generateId();
        await c.env.DB.prepare(
          `INSERT INTO categories (id, name, slug, icon, status, "order", type) 
           VALUES (?, ?, ?, '📁', 'active', 999, 'main')`
        ).bind(id, name, generateSlug(name)).run();

        existing = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
      }
      result.main = existing;
    }

    // ✅ Sub category ensure karo
    if (subCategory && subCategory.trim() && result.main) {
      const name = subCategory.trim();
      let existing = await c.env.DB.prepare(
        'SELECT * FROM categories WHERE LOWER(name) = LOWER(?) AND parent_id = ?'
      ).bind(name, result.main.id).first();

      if (!existing) {
        const id = generateId();
        await c.env.DB.prepare(
          `INSERT INTO categories (id, name, slug, icon, status, "order", type, parent_id) 
           VALUES (?, ?, ?, '📁', 'active', 999, 'sub', ?)`
        ).bind(id, name, generateSlug(name), result.main.id).run();

        existing = await c.env.DB.prepare('SELECT * FROM categories WHERE id = ?').bind(id).first();
      }
      result.sub = existing;
    }

    return ok(c, result);
  } catch (error) {
    console.error('Category ensure error:', error);
    return fail(c, error.message, 500);
  }
});

export default categories;
