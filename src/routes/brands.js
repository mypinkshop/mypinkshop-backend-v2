// src/routes/brands.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail } from '../lib/utils.js';

const brands = new Hono();

// ============================================================
// ✅ PUBLIC: GET /api/brands
// Saare unique brands (products se derive)
// ============================================================
brands.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const search = url.searchParams.get('search') || '';
    const limit = parseInt(url.searchParams.get('limit')) || 500;

    let query = `
      SELECT DISTINCT brand, COUNT(*) as product_count
      FROM products
      WHERE brand IS NOT NULL
        AND brand != ''
        AND is_active = 1
    `;
    const bindings = [];

    if (search) {
      query += ` AND LOWER(brand) LIKE ?`;
      bindings.push(`%${search.toLowerCase()}%`);
    }

    query += ` GROUP BY brand ORDER BY product_count DESC, brand ASC LIMIT ?`;
    bindings.push(limit);

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

    const brandList = (results || []).map(r => r.brand);

    return ok(c, brandList);
  } catch (err) {
    console.error('Brands list error:', err);
    return fail(c, err.message, 500);
  }
});

// ============================================================
// ✅ PUBLIC: GET /api/brands/popular
// Top 20 brands (by product count)
// ============================================================
brands.get('/popular', async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT brand, COUNT(*) as product_count
       FROM products
       WHERE brand IS NOT NULL
         AND brand != ''
         AND is_active = 1
       GROUP BY brand
       ORDER BY product_count DESC
       LIMIT 20`
    ).all();

    const brandList = (results || []).map(r => ({
      name: r.brand,
      productCount: r.product_count
    }));

    return ok(c, brandList);
  } catch (err) {
    console.error('Popular brands error:', err);
    return fail(c, err.message, 500);
  }
});

// ============================================================
// ✅ PUBLIC: POST /api/brands/ensure
// Naya brand check karo (agar exist karta hai to return karo)
// ============================================================
brands.post('/ensure', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { name } = body;

    if (!name || !name.trim()) {
      return fail(c, 'Brand name is required', 400);
    }

    const cleanName = name.trim();

    // ✅ Check if brand exists in products
    const existing = await c.env.DB.prepare(
      `SELECT DISTINCT brand FROM products 
       WHERE LOWER(brand) = LOWER(?) 
       LIMIT 1`
    ).bind(cleanName).first();

    if (existing) {
      return ok(c, {
        brand: existing.brand,
        exists: true,
        message: 'Brand already exists'
      });
    }

    // ✅ Brand doesn't exist yet — return as "new"
    return ok(c, {
      brand: cleanName,
      exists: false,
      message: 'New brand — will be created with first product'
    });
  } catch (err) {
    console.error('Brand ensure error:', err);
    return fail(c, err.message, 500);
  }
});

export default brands;
