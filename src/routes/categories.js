import { Hono } from 'hono';

const categories = new Hono();

// Helper to generate unique ID
const generateId = () => 'cat_' + Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);

// 1. GET ALL CATEGORIES
categories.get('/', async (c) => {
  try {
    const db = c.env.DB;
    const { results } = await db.prepare("SELECT * FROM categories ORDER BY \"order\" ASC, created_at DESC").all();
    return c.json(results);
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// 2. CREATE CATEGORY
categories.post('/', async (c) => {
  try {
    const db = c.env.DB;
    const body = await c.req.json();
    const { name, slug, icon, status, order, description } = body;

    if (!name) {
      return c.json({ success: false, message: 'Category name is required' }, 400);
    }

    const id = generateId();
    const catSlug = slug || name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');

    await db.prepare(
      `INSERT INTO categories (id, name, slug, icon, status, "order", description) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id, 
      name, 
      catSlug, 
      icon || '📁', 
      status || 'active', 
      parseInt(order) || 0, 
      description || ''
    ).run();

    return c.json({ success: true, message: 'Category created successfully', id });
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// 3. UPDATE CATEGORY
categories.put('/:id', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');
    const body = await c.req.json();
    const { name, slug, icon, status, order, description } = body;

    if (!name) {
      return c.json({ success: false, message: 'Category name is required' }, 400);
    }

    const catSlug = slug || name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');

    await db.prepare(
      `UPDATE categories SET name = ?, slug = ?, icon = ?, status = ?, "order" = ?, description = ? WHERE id = ?`
    ).bind(
      name, 
      catSlug, 
      icon || '📁', 
      status || 'active', 
      parseInt(order) || 0, 
      description || '', 
      id
    ).run();

    return c.json({ success: true, message: 'Category updated successfully' });
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// 4. DELETE CATEGORY
categories.delete('/:id', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');

    await db.prepare("DELETE FROM categories WHERE id = ?").bind(id).run();

    return c.json({ success: true, message: 'Category deleted successfully' });
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

export default categories;
