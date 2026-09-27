// src/routes/brands.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const brands = new Hono();

/* --------------------------------------------------------------------- */
/* Helpers                                                               */
/* --------------------------------------------------------------------- */

function slugify(str) {
  return String(str || '')
    .toLowerCase()
    .trim()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * ✅ SAFE BODY PARSER
 * JSON aur FormData dono handle karta hai
 * Ye `name is required` error fix karega
 */
async function parseBodySafe(c) {
  try {
    const contentType = c.req.header('content-type') || '';

    // JSON body
    if (contentType.includes('application/json')) {
      const json = await c.req.json().catch(() => ({}));
      return json || {};
    }

    // FormData / multipart
    if (
      contentType.includes('multipart/form-data') ||
      contentType.includes('application/x-www-form-urlencoded')
    ) {
      const form = await c.req.parseBody().catch(() => ({}));
      return form || {};
    }

    // Fallback: try JSON first, then FormData
    try {
      return await c.req.json();
    } catch {
      return await c.req.parseBody().catch(() => ({}));
    }
  } catch (err) {
    console.error('parseBodySafe error:', err);
    return {};
  }
}

/**
 * JSON string parse karo safely
 */
function parseJSON(str, fallback = []) {
  if (!str) return fallback;
  if (Array.isArray(str) || typeof str === 'object') return str;
  try {
    const parsed = JSON.parse(str);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * ✅ SAFE BOOL — string ya boolean dono handle karo
 */
function safeBool(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  return val === 'true' || val === '1' || val === 1;
}

/**
 * ✅ SAFE INT
 */
function safeInt(val, defaultVal = 0) {
  const n = parseInt(val);
  return Number.isFinite(n) ? n : defaultVal;
}

function formatBrand(b) {
  return {
    _id: b.id,
    id: b.id,
    name: b.name,
    slug: b.slug,
    logo: b.logo || '',
    banner: b.banner || '',
    description: b.description || '',
    tagline: b.tagline || '',
    highlights: parseJSON(b.highlights, []),
    offers: parseJSON(b.offers, []),
    featured_products: parseJSON(b.featured_products, []),
    active: b.active === 1,
    is_featured: b.is_featured === 1,
    sort_order: b.sort_order ?? 0,
    product_count: b.product_count ?? 0,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

async function brandsTableExists(c) {
  try {
    const r = await c.env.DB.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name='brands'`
    ).first();
    return !!r;
  } catch {
    return false;
  }
}

async function hasNewColumns(c) {
  try {
    const { results } = await c.env.DB.prepare(`PRAGMA table_info(brands)`).all();
    const cols = (results || []).map((r) => r.name);
    return {
      highlights: cols.includes('highlights'),
      offers: cols.includes('offers'),
      featured_products: cols.includes('featured_products'),
    };
  } catch {
    return { highlights: false, offers: false, featured_products: false };
  }
}

/* --------------------------------------------------------------------- */
/* PUBLIC                                                                */
/* --------------------------------------------------------------------- */

// GET /api/brands?search=&limit=&featured=
brands.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const search = url.searchParams.get('search') || '';
    const featured = url.searchParams.get('featured');
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 500, 1000);

    const hasBrandsTable = await brandsTableExists(c);

    if (!hasBrandsTable) {
      let query = `
        SELECT brand AS name, COUNT(*) as product_count
        FROM products
        WHERE brand IS NOT NULL AND brand != '' AND is_active = 1
      `;
      const bindings = [];

      if (search) {
        query += ` AND LOWER(brand) LIKE ?`;
        bindings.push(`%${search.toLowerCase()}%`);
      }

      query += ` GROUP BY brand ORDER BY product_count DESC, brand ASC LIMIT ?`;
      bindings.push(limit);

      const { results } = await c.env.DB.prepare(query).bind(...bindings).all();

      const list = (results || []).map((r) => ({
        name: r.name,
        slug: slugify(r.name),
        logo: '',
        banner: '',
        description: '',
        tagline: '',
        highlights: [],
        offers: [],
        featured_products: [],
        active: true,
        is_featured: false,
        product_count: r.product_count,
      }));

      return ok(c, list);
    }

    let query = `
      SELECT b.*, 
        (SELECT COUNT(*) FROM products p 
         WHERE LOWER(p.brand) = LOWER(b.name) AND p.is_active = 1) as product_count
      FROM brands b
      WHERE b.active = 1
    `;
    const bindings = [];

    if (search) {
      query += ` AND LOWER(b.name) LIKE ?`;
      bindings.push(`%${search.toLowerCase()}%`);
    }

    if (featured === 'true') {
      query += ` AND b.is_featured = 1`;
    }

    query += ` ORDER BY b.is_featured DESC, b.sort_order ASC, b.name ASC LIMIT ?`;
    bindings.push(limit);

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
    return ok(c, (results || []).map(formatBrand));
  } catch (err) {
    console.error('Brands list error:', err);
    return fail(c, err.message, 500);
  }
});

// GET /api/brands/admin/all
brands.get('/admin/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const hasBrandsTable = await brandsTableExists(c);
    if (!hasBrandsTable) return ok(c, []);

    const { results } = await c.env.DB.prepare(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM products p 
         WHERE LOWER(p.brand) = LOWER(b.name) AND p.is_active = 1) as product_count
       FROM brands b
       ORDER BY b.is_featured DESC, b.sort_order ASC, b.name ASC`
    ).all();

    return ok(c, (results || []).map(formatBrand));
  } catch (err) {
    console.error('Admin brands list error:', err);
    return fail(c, err.message, 500);
  }
});

// GET /api/brands/popular
brands.get('/popular', async (c) => {
  try {
    const hasBrandsTable = await brandsTableExists(c);

    if (!hasBrandsTable) {
      const { results } = await c.env.DB.prepare(
        `SELECT brand AS name, COUNT(*) as product_count
         FROM products
         WHERE brand IS NOT NULL AND brand != '' AND is_active = 1
         GROUP BY brand
         ORDER BY product_count DESC
         LIMIT 20`
      ).all();

      return ok(c, (results || []).map((r) => ({
        name: r.name,
        slug: slugify(r.name),
        productCount: r.product_count,
      })));
    }

    const { results } = await c.env.DB.prepare(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM products p 
         WHERE LOWER(p.brand) = LOWER(b.name) AND p.is_active = 1) as product_count
       FROM brands b
       WHERE b.active = 1
       ORDER BY product_count DESC, b.name ASC
       LIMIT 20`
    ).all();

    return ok(c, (results || []).map(formatBrand));
  } catch (err) {
    console.error('Popular brands error:', err);
    return fail(c, err.message, 500);
  }
});

// GET /api/brands/:slug
brands.get('/:slug', async (c) => {
  try {
    const slug = c.req.param('slug');
    const hasBrandsTable = await brandsTableExists(c);

    if (!hasBrandsTable) {
      const match = await c.env.DB.prepare(
        `SELECT brand AS name FROM products 
         WHERE LOWER(REPLACE(brand, ' ', '-')) = LOWER(?) 
         LIMIT 1`
      ).bind(slug).first();

      if (!match) return fail(c, 'Brand not found', 404);

      const countRow = await c.env.DB.prepare(
        `SELECT COUNT(*) as product_count FROM products
         WHERE LOWER(brand) = LOWER(?) AND is_active = 1`
      ).bind(match.name).first();

      return ok(c, {
        name: match.name,
        slug: slugify(match.name),
        logo: '',
        banner: '',
        description: '',
        tagline: '',
        highlights: [],
        offers: [],
        featured_products: [],
        active: true,
        is_featured: false,
        product_count: countRow?.product_count || 0,
      });
    }

    const brand = await c.env.DB.prepare(
      `SELECT b.*, 
        (SELECT COUNT(*) FROM products p 
         WHERE LOWER(p.brand) = LOWER(b.name) AND p.is_active = 1) as product_count
       FROM brands b
       WHERE b.slug = ? AND b.active = 1`
    ).bind(slug).first();

    if (!brand) return fail(c, 'Brand not found', 404);

    return ok(c, formatBrand(brand));
  } catch (err) {
    console.error('Brand detail error:', err);
    return fail(c, err.message, 500);
  }
});

// GET /api/brands/:slug/products
brands.get('/:slug/products', async (c) => {
  try {
    const slug = c.req.param('slug');
    const url = new URL(c.req.url);
    const page = Math.max(parseInt(url.searchParams.get('page')) || 1, 1);
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
    const offset = (page - 1) * limit;
    const sort = url.searchParams.get('sort') || 'popular';

    const hasBrandsTable = await brandsTableExists(c);
    let brandName = null;

    if (hasBrandsTable) {
      const b = await c.env.DB.prepare(
        `SELECT name FROM brands WHERE slug = ? AND active = 1`
      ).bind(slug).first();
      if (b) brandName = b.name;
    }

    if (!brandName) {
      const b = await c.env.DB.prepare(
        `SELECT brand AS name FROM products 
         WHERE LOWER(REPLACE(brand, ' ', '-')) = LOWER(?) 
         LIMIT 1`
      ).bind(slug).first();
      if (b) brandName = b.name;
    }

    if (!brandName) return fail(c, 'Brand not found', 404);

    let orderBy = 'review_count DESC, rating DESC, created_at DESC';
    if (sort === 'price_low') orderBy = 'price ASC';
    else if (sort === 'price_high') orderBy = 'price DESC';
    else if (sort === 'newest') orderBy = 'created_at DESC';
    else if (sort === 'rating') orderBy = 'rating DESC, review_count DESC';

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM products
       WHERE LOWER(brand) = LOWER(?) AND is_active = 1
       ORDER BY ${orderBy}
       LIMIT ? OFFSET ?`
    ).bind(brandName, limit, offset).all();

    const totalRow = await c.env.DB.prepare(
      `SELECT COUNT(*) as total FROM products
       WHERE LOWER(brand) = LOWER(?) AND is_active = 1`
    ).bind(brandName).first();

    const total = totalRow?.total || 0;

    const products = (results || []).map((p) => {
      let images = [];
      try {
        images = typeof p.images === 'string' ? JSON.parse(p.images) : (p.images || []);
      } catch { images = []; }

      return {
        _id: p.id,
        id: p.id,
        name: p.name,
        title: p.name,
        brand: p.brand,
        slug: p.slug,
        price: p.price,
        originalPrice: p.original_price,
        discount: p.discount_percent,
        stock: p.stock,
        sku: p.sku,
        images,
        image: images[0] || '',
        rating: p.rating,
        reviewCount: p.review_count,
        mainCategory: p.main_category,
        subCategory: p.sub_category,
        shortDescription: p.short_description,
      };
    });

    return ok(c, {
      brand: { name: brandName, slug },
      products,
      pagination: {
        page,
        limit,
        total,
        hasMore: offset + products.length < total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (err) {
    console.error('Brand products error:', err);
    return fail(c, err.message, 500);
  }
});

// POST /api/brands/ensure
brands.post('/ensure', authMiddleware, async (c) => {
  try {
    const body = await parseBodySafe(c);
    const { name } = body;

    if (!name || !name.trim()) return fail(c, 'Brand name is required', 400);

    const cleanName = name.trim();

    const existing = await c.env.DB.prepare(
      `SELECT DISTINCT brand FROM products 
       WHERE LOWER(brand) = LOWER(?) LIMIT 1`
    ).bind(cleanName).first();

    if (existing) {
      return ok(c, { brand: existing.brand, exists: true, message: 'Brand already exists' });
    }

    const hasBrandsTable = await brandsTableExists(c);
    if (hasBrandsTable) {
      const b = await c.env.DB.prepare(
        `SELECT * FROM brands WHERE LOWER(name) = LOWER(?) LIMIT 1`
      ).bind(cleanName).first();

      if (b) {
        return ok(c, { brand: b.name, exists: true, brandData: formatBrand(b) });
      }
    }

    return ok(c, {
      brand: cleanName,
      slug: slugify(cleanName),
      exists: false,
      message: 'New brand',
    });
  } catch (err) {
    console.error('Brand ensure error:', err);
    return fail(c, err.message, 500);
  }
});

/* --------------------------------------------------------------------- */
/* ADMIN — Brand CRUD                                                    */
/* --------------------------------------------------------------------- */

// POST /api/brands — naya brand banao
brands.post('/', authMiddleware, requireAdmin, async (c) => {
  try {
    const hasBrandsTable = await brandsTableExists(c);
    if (!hasBrandsTable) return fail(c, 'Brands table not set up yet', 500);

    // ✅ JSON + FormData dono handle
    const body = await parseBodySafe(c);

    console.log('[Brand Create] Received body keys:', Object.keys(body));
    console.log('[Brand Create] name:', body.name);

    const name = (body.name || '').toString().trim();
    if (!name) {
      return fail(c, 'name is required (body me "name" field missing hai)', 400);
    }

    const slug = (body.slug || slugify(name)).toString().trim().toLowerCase();
    const description = body.description || '';
    const tagline = body.tagline || '';
    const is_featured = safeBool(body.is_featured, false) ? 1 : 0;
    const sort_order = safeInt(body.sort_order, 0);
    const active = body.active !== undefined ? (safeBool(body.active, true) ? 1 : 0) : 1;

    // NAYE FIELDS
    const highlights = body.highlights
      ? (typeof body.highlights === 'string' ? body.highlights : JSON.stringify(body.highlights))
      : '[]';
    const offers = body.offers
      ? (typeof body.offers === 'string' ? body.offers : JSON.stringify(body.offers))
      : '[]';
    const featured_products = body.featured_products
      ? (typeof body.featured_products === 'string'
          ? body.featured_products
          : JSON.stringify(body.featured_products))
      : '[]';

    // Logo
    let logo = typeof body.logo === 'string' ? body.logo : '';
    if (body.logo && typeof body.logo === 'object' && typeof body.logo.arrayBuffer === 'function') {
      logo = await fileToDataUrl(body.logo);
    }

    // Banner
    let banner = typeof body.banner === 'string' ? body.banner : '';
    if (body.banner && typeof body.banner === 'object' && typeof body.banner.arrayBuffer === 'function') {
      banner = await fileToDataUrl(body.banner);
    }

    // Duplicate check
    const dup = await c.env.DB.prepare(
      `SELECT id FROM brands WHERE slug = ? OR LOWER(name) = LOWER(?)`
    ).bind(slug, name).first();
    if (dup) return fail(c, 'Brand already exists (same name ya slug)', 409);

    const id = genId('brand');
    const cols = await hasNewColumns(c);

    let insertSql, bindings;

    if (cols.highlights && cols.offers && cols.featured_products) {
      insertSql = `INSERT INTO brands 
        (id, name, slug, logo, banner, description, tagline,
         highlights, offers, featured_products,
         active, is_featured, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;
      bindings = [
        id, name, slug, logo, banner, description, tagline,
        highlights, offers, featured_products,
        active, is_featured, sort_order,
      ];
    } else {
      insertSql = `INSERT INTO brands 
        (id, name, slug, logo, banner, description, tagline,
         active, is_featured, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`;
      bindings = [
        id, name, slug, logo, banner, description, tagline,
        active, is_featured, sort_order,
      ];
    }

    await c.env.DB.prepare(insertSql).bind(...bindings).run();

    const created = await c.env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
    return ok(c, formatBrand(created), undefined, 201);
  } catch (err) {
    console.error('Create brand error:', err);
    return fail(c, `Failed to create brand: ${err.message}`, 500);
  }
});

// PUT /api/brands/:id
brands.put('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const hasBrandsTable = await brandsTableExists(c);
    if (!hasBrandsTable) return fail(c, 'Brands table not set up yet', 500);

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Brand not found', 404);

    const body = await parseBodySafe(c);

    let logo = existing.logo;
    if (body.logo && typeof body.logo === 'object' && typeof body.logo.arrayBuffer === 'function') {
      logo = await fileToDataUrl(body.logo);
    } else if (typeof body.logo === 'string' && body.logo) {
      logo = body.logo;
    }

    let banner = existing.banner;
    if (body.banner && typeof body.banner === 'object' && typeof body.banner.arrayBuffer === 'function') {
      banner = await fileToDataUrl(body.banner);
    } else if (typeof body.banner === 'string' && body.banner) {
      banner = body.banner;
    }

    const highlights = body.highlights !== undefined
      ? (typeof body.highlights === 'string' ? body.highlights : JSON.stringify(body.highlights))
      : (existing.highlights || '[]');
    const offers = body.offers !== undefined
      ? (typeof body.offers === 'string' ? body.offers : JSON.stringify(body.offers))
      : (existing.offers || '[]');
    const featured_products = body.featured_products !== undefined
      ? (typeof body.featured_products === 'string'
          ? body.featured_products
          : JSON.stringify(body.featured_products))
      : (existing.featured_products || '[]');

    const merged = {
      name: body.name ?? existing.name,
      slug: body.slug ?? existing.slug,
      logo,
      banner,
      description: body.description ?? existing.description,
      tagline: body.tagline ?? existing.tagline,
      active: body.active !== undefined ? (safeBool(body.active, true) ? 1 : 0) : existing.active,
      is_featured: body.is_featured !== undefined
        ? (safeBool(body.is_featured, false) ? 1 : 0)
        : existing.is_featured,
      sort_order: body.sort_order !== undefined ? safeInt(body.sort_order, existing.sort_order) : existing.sort_order,
    };

    const cols = await hasNewColumns(c);

    if (cols.highlights && cols.offers && cols.featured_products) {
      await c.env.DB.prepare(
        `UPDATE brands SET 
          name = ?, slug = ?, logo = ?, banner = ?, description = ?, tagline = ?,
          highlights = ?, offers = ?, featured_products = ?,
          active = ?, is_featured = ?, sort_order = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
        .bind(
          merged.name, merged.slug, merged.logo, merged.banner, merged.description, merged.tagline,
          highlights, offers, featured_products,
          merged.active, merged.is_featured, merged.sort_order, id
        )
        .run();
    } else {
      await c.env.DB.prepare(
        `UPDATE brands SET 
          name = ?, slug = ?, logo = ?, banner = ?, description = ?, tagline = ?,
          active = ?, is_featured = ?, sort_order = ?, updated_at = datetime('now')
         WHERE id = ?`
      )
        .bind(
          merged.name, merged.slug, merged.logo, merged.banner, merged.description, merged.tagline,
          merged.active, merged.is_featured, merged.sort_order, id
        )
        .run();
    }

    const updated = await c.env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
    return ok(c, formatBrand(updated));
  } catch (err) {
    console.error('Update brand error:', err);
    return fail(c, `Failed to update brand: ${err.message}`, 500);
  }
});

// PATCH /api/brands/:id — quick toggle
brands.patch('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const hasBrandsTable = await brandsTableExists(c);
    if (!hasBrandsTable) return fail(c, 'Brands table not set up yet', 500);

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Brand not found', 404);

    const body = await parseBodySafe(c);

    const updates = [];
    const bindings = [];

    if (body.active !== undefined) {
      updates.push('active = ?');
      bindings.push(safeBool(body.active, false) ? 1 : 0);
    }
    if (body.is_featured !== undefined) {
      updates.push('is_featured = ?');
      bindings.push(safeBool(body.is_featured, false) ? 1 : 0);
    }
    if (body.sort_order !== undefined) {
      updates.push('sort_order = ?');
      bindings.push(safeInt(body.sort_order, 0));
    }

    if (updates.length === 0) return fail(c, 'No valid fields to update', 400);

    updates.push(`updated_at = datetime('now')`);
    bindings.push(id);

    await c.env.DB.prepare(
      `UPDATE brands SET ${updates.join(', ')} WHERE id = ?`
    ).bind(...bindings).run();

    const updated = await c.env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
    return ok(c, formatBrand(updated));
  } catch (err) {
    console.error('Patch brand error:', err);
    return fail(c, err.message, 500);
  }
});

// DELETE /api/brands/:id
brands.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const hasBrandsTable = await brandsTableExists(c);
    if (!hasBrandsTable) return fail(c, 'Brands table not set up yet', 500);

    const id = c.req.param('id');
    const result = await c.env.DB.prepare('DELETE FROM brands WHERE id = ?').bind(id).run();
    if (result.meta?.changes === 0) return fail(c, 'Brand not found', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    console.error('Delete brand error:', err);
    return fail(c, err.message, 500);
  }
});

/* --------------------------------------------------------------------- */
/* Helper: File → Data URL                                               */
/* --------------------------------------------------------------------- */

async function fileToDataUrl(file) {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const base64 = btoa(binary);
    return `data:${file.type || 'image/jpeg'};base64,${base64}`;
  } catch (e) {
    console.error('File conversion error:', e);
    return '';
  }
}

export default brands;
