// src/routes/products.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId, parsePagination, safeJsonArray } from '../lib/utils.js';

const products = new Hono();

function serializeProduct(row) {
  if (!row) return null;
  const images = safeJsonArray(row.images);
  return {
    ...row,
    id: row.id,
    _id: row.id,
    images: images,
    aboutThisItem: safeJsonArray(row.about_this_item),
    isActive: !!row.is_active,
    isFeatured: !!row.is_featured,
    status: row.is_active ? 'active' : 'inactive',
    is_active: row.is_active,
    category: row.main_category,
    mainCategory: row.main_category,
    subcategory: row.sub_category,
    subCategory: row.sub_category,
    // 🔥 Google Shopping & AI Search Engine Optimization (JSON-LD & OpenGraph Rich Snippet Meta)
    seoMeta: {
      "@context": "https://schema.org/",
      "@type": "Product",
      "name": row.name,
      "image": images,
      "description": row.description || `Buy ${row.name} online at best price in India on MyPinkShop. Free Shipping & COD available.`,
      "brand": {
        "@type": "Brand",
        "name": row.brand || "MyPinkShop"
      },
      "sku": row.sku || row.id,
      "offers": {
        "@type": "Offer",
        "url": `https://www.mypinkshop.com/product/${row.id}`,
        "priceCurrency": "INR",
        "price": row.price,
        "priceValidUntil": "2027-12-31",
        "itemCondition": "https://schema.org/NewCondition",
        "availability": row.stock > 0 ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
        "seller": {
          "@type": "Organization",
          "name": "MyPinkShop"
        }
      }
    }
  };
}

/* --------------------------------------------------------------------- */
/* Public Routes                                                         */
/* --------------------------------------------------------------------- */

products.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');
    const subCategory = url.searchParams.get('subCategory');
    const search = url.searchParams.get('search');
    const minPrice = url.searchParams.get('minPrice');
    const maxPrice = url.searchParams.get('maxPrice');
    const featured = url.searchParams.get('featured');
    const sort = url.searchParams.get('sort') || 'newest';
    const { page, limit, offset } = parsePagination(c);

    const conditions = ['is_active = 1'];
    const bindings = [];

    if (category) {
      conditions.push('main_category = ?');
      bindings.push(category);
    }
    if (subCategory) {
      conditions.push('sub_category = ?');
      bindings.push(subCategory);
    }
    if (search) {
      conditions.push('(name LIKE ? OR brand LIKE ? OR description LIKE ?)');
      const like = `%${search}%`;
      bindings.push(like, like, like);
    }
    if (minPrice && !Number.isNaN(Number(minPrice))) {
      conditions.push('price >= ?');
      bindings.push(Number(minPrice));
    }
    if (maxPrice && !Number.isNaN(Number(maxPrice))) {
      conditions.push('price <= ?');
      bindings.push(Number(maxPrice));
    }
    if (featured === 'true') {
      conditions.push('is_featured = 1');
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    let orderClause = 'ORDER BY created_at DESC';
    if (sort === 'price_asc' || sort === 'price_low') orderClause = 'ORDER BY price ASC';
    else if (sort === 'price_desc' || sort === 'price_high') orderClause = 'ORDER BY price DESC';
    else if (sort === 'rating') orderClause = 'ORDER BY rating DESC';
    else if (sort === 'newest') orderClause = 'ORDER BY created_at DESC';

    const listQuery = `SELECT * FROM products ${whereClause} ${orderClause} LIMIT ? OFFSET ?`;
    const countQuery = `SELECT COUNT(*) as total FROM products ${whereClause}`;

    const { results } = await c.env.DB.prepare(listQuery)
      .bind(...bindings, limit, offset)
      .all();

    const countRow = await c.env.DB.prepare(countQuery).bind(...bindings).first();
    const total = countRow?.total || 0;

    return ok(
      c,
      (results || []).map(serializeProduct),
      {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      }
    );
  } catch (err) {
    return fail(c, `Failed to load products: ${err.message}`, 500);
  }
});

products.get('/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const product = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    if (!product) return fail(c, 'Product not found.', 404);
    return ok(c, serializeProduct(product));
  } catch (err) {
    return fail(c, `Failed to load product: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* Admin Routes                                                          */
/* --------------------------------------------------------------------- */

products.post('/create', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      name,
      brand = 'Richfem',
      mainCategory = 'Other',
      subCategory = '',
      categorySlug = '',
      description = '',
      aboutThisItem = [],
      price,
      originalPrice = 0,
      discountPercent = 0,
      tax = 5,
      stock = 10,
      sku = null,
      weight = '',
      dimensions = '',
      images = [],
      isActive = true,
      isFeatured = false,
      vendorId = 'admin',
      vendorName = 'MyPinkShop',
    } = body;

    if (!name || price === undefined || price === null) {
      return fail(c, 'name and price are required.', 400);
    }

    const id = genId('prod');

    await c.env.DB.prepare(
      `INSERT INTO products
        (id, vendor_id, vendor_name, name, brand, main_category, sub_category, category_slug,
         description, about_this_item, price, original_price, discount_percent, tax, stock, sku,
         weight, dimensions, images, rating, review_count, is_active, is_featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        vendorId,
        vendorName,
        name,
        brand,
        mainCategory,
        subCategory,
        categorySlug,
        description,
        JSON.stringify(aboutThisItem || []),
        price,
        originalPrice,
        discountPercent,
        tax,
        stock,
        sku,
        weight,
        dimensions,
        JSON.stringify(images || []),
        isActive ? 1 : 0,
        isFeatured ? 1 : 0
      )
      .run();

    const created = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    return ok(c, serializeProduct(created), undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create product: ${err.message}`, 500);
  }
});

products.put('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const existing = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    if (!existing) return fail(c, 'Product not found.', 404);

    const body = await c.req.json().catch(() => ({}));
    const merged = {
      name: body.name ?? existing.name,
      brand: body.brand ?? existing.brand,
      main_category: body.mainCategory ?? existing.main_category,
      sub_category: body.subCategory ?? existing.sub_category,
      category_slug: body.categorySlug ?? existing.category_slug,
      description: body.description ?? existing.description,
      about_this_item:
        body.aboutThisItem !== undefined ? JSON.stringify(body.aboutThisItem) : existing.about_this_item,
      price: body.price ?? existing.price,
      original_price: body.originalPrice ?? existing.original_price,
      discount_percent: body.discountPercent ?? existing.discount_percent,
      tax: body.tax ?? existing.tax,
      stock: body.stock ?? existing.stock,
      sku: body.sku ?? existing.sku,
      weight: body.weight ?? existing.weight,
      dimensions: body.dimensions ?? existing.dimensions,
      images: body.images !== undefined ? JSON.stringify(body.images) : existing.images,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active,
      is_featured: body.isFeatured !== undefined ? (body.isFeatured ? 1 : 0) : existing.is_featured,
    };

    await c.env.DB.prepare(
      `UPDATE products SET name = ?, brand = ?, main_category = ?, sub_category = ?, category_slug = ?,
        description = ?, about_this_item = ?, price = ?, original_price = ?, discount_percent = ?,
        tax = ?, stock = ?, sku = ?, weight = ?, dimensions = ?, images = ?, is_active = ?,
        is_featured = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        merged.name,
        merged.brand,
        merged.main_category,
        merged.sub_category,
        merged.category_slug,
        merged.description,
        merged.about_this_item,
        merged.price,
        merged.original_price,
        merged.discount_percent,
        merged.tax,
        merged.stock,
        merged.sku,
        merged.weight,
        merged.dimensions,
        merged.images,
        merged.is_active,
        merged.is_featured,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    return ok(c, serializeProduct(updated));
  } catch (err) {
    return fail(c, `Failed to load product: ${err.message}`, 500);
  }
});

products.delete('/:id', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
    if (result.meta?.changes === 0) return fail(c, 'Product not found.', 404);
    return ok(c, { id, deleted: true });
  } catch (err) {
    return fail(c, `Failed to delete product: ${err.message}`, 500);
  }
});

export default products;
