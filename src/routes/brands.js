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
    active: b.active === 1,
    is_featured: b.is_featured === 1,
    sort_order: b.sort_order ?? 0,
    product_count: b.product_count ?? 0,
    created_at: b.created_at,
    updated_at: b.updated_at,
  };
}

/**
 * Check karo ki brands table exist karta hai ya nahi
 */
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

/* --------------------------------------------------------------------- */
/* PUBLIC                                                                */
/* --------------------------------------------------------------------- */

// GET /api/brands?search=&limit=&featured=
// Saare brands — brands table se (fallback: products se derive)
brands.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const search = url.searchParams.get('search') || '';
    const featured = url.searchParams.get('featured');
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 500, 1000);

    const hasBrandsTable = await brandsTableExists(c);

    // ================= Fallback: products se derive =================
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
        active: true,
        is_featured: false,
        product_count: r.product_count,
      }));

      return ok(c, list);
    }

    // ================= Main: brands table =================
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

// GET /api/brands/popular — Top 20 by product count
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

// GET /api/brands/:slug — ek brand ki detail
brands.get('/:slug', async (c) => {
  try {
    const slug = c.req.param('slug');
    const hasBrandsTable = await brandsTableExists(c);

    // Fallback: products se derive
    if (!hasBrandsTable) {
      // Slug ko name me convert karo (approx)
      const decodedName = slug.replace(/-/g, ' ');

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

// GET /api/brands/:slug/products?page=1&limit=20&sort=
brands.get('/:slug/products', async (c) => {
  try {
    const slug = c.req.param('slug');
    const url = new URL(c.req.url);
    const page = Math.max(parseInt(url.searchParams.get('page')) || 1, 1);
    const limit = Math.min(parseInt(url.searchParams.get('limit')) || 20, 100);
    const offset = (page - 1) * limit;
    const sort = url.searchParams.get('sort') || 'popular';

    // Brand ka actual naam dhundho
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

    // Sort clause
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

    // Products format karo (images, price etc.)
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

// POST /api/brands/ensure — check karo brand exist karta hai ya nahi
brands.post('/ensure', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { name } = body;

    if (!name || !name.trim()) return fail(c, 'Brand name is required', 400);

    const cleanName = name.trim();

    // Products me check karo
    const existing = await c.env.DB.prepare(
      `SELECT DISTINCT brand FROM products 
       WHERE LOWER(brand) = LOWER(?) LIMIT 1`
    ).bind(cleanName).first();

    if (existing) {
      return ok(c, { brand: existing.brand, exists: true, message: 'Brand already exists' });
    }

    // Brands table me check karo
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

    const body = await c.req.parseBody().catch(() => ({}));
    const name = (body.name || '').trim();
    if (!name) return fail(c, 'name is required', 400);

    const slug = (body.slug || slugify(name)).trim().toLowerCase();
    const description = body.description || '';
    const tagline = body.tagline || '';
    const is_featured = body.is_featured === 'true' || body.is_featured === true ? 1 : 0;
    const sort_order = parseInt(body.sort_order) || 0;
    const active = body.active === 'false' || body.active === false ? 0 : 1;

    // Logo upload
    let logo = typeof body.logo === 'string' ? body.logo : '';
    if (body.logo && typeof body.logo === 'object' && typeof body.logo.arrayBuffer === 'function') {
      logo = await fileToDataUrl(body.logo);
    }

    // Banner upload
    let banner = typeof body.banner === 'string' ? body.banner : '';
    if (body.banner && typeof body.banner === 'object' && typeof body.banner.arrayBuffer === 'function') {
      banner = await fileToDataUrl(body.banner);
    }

    // Duplicate check
    const dup = await c.env.DB.prepare(
      `SELECT id FROM brands WHERE slug = ? OR LOWER(name) = LOWER(?)`
    ).bind(slug, name).first();
    if (dup) return fail(c, 'Brand already exists', 409);

    const id = genId('brand');

    await c.env.DB.prepare(
      `INSERT INTO brands 
        (id, name, slug, logo, banner, description, tagline, active, is_featured, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(id, name, slug, logo, banner, description, tagline, active, is_featured, sort_order)
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
    return ok(c, formatBrand(created), undefined, 201);
  } catch (err) {
    console.error('Create brand error:', err);
    return fail(c, err.message, 500);
  }
});

// PUT /api/brands/:id — brand update
brands.put('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const hasBrandsTable = await brandsTableExists(c);
    if (!hasBrandsTable) return fail(c, 'Brands table not set up yet', 500);

    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Brand not found', 404);

    const body = await c.req.parseBody().catch(() => ({}));

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

    const merged = {
      name: body.name ?? existing.name,
      slug: body.slug ?? existing.slug,
      logo,
      banner,
      description: body.description ?? existing.description,
      tagline: body.tagline ?? existing.tagline,
      active: body.active !== undefined
        ? (body.active === 'false' || body.active === false ? 0 : 1)
        : existing.active,
      is_featured: body.is_featured !== undefined
        ? (body.is_featured === 'true' || body.is_featured === true ? 1 : 0)
        : existing.is_featured,
      sort_order: body.sort_order !== undefined ? parseInt(body.sort_order) : existing.sort_order,
    };

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

    const updated = await c.env.DB.prepare('SELECT * FROM brands WHERE id = ?').bind(id).first();
    return ok(c, formatBrand(updated));
  } catch (err) {
    console.error('Update brand error:', err);
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
