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
    keyFeatures: safeJsonArray(row.key_features),
    variations: safeJsonArray(row.variations),
    isActive: !!row.is_active,
    isFeatured: !!row.is_featured,
    hasVariations: !!row.has_variations,
    status: row.is_active ? 'active' : 'inactive',
    is_active: row.is_active,
    category: row.main_category,
    mainCategory: row.main_category,
    subcategory: row.sub_category,
    subCategory: row.sub_category,
    metaTitle: row.meta_title,
    metaDescription: row.meta_description,
    metaKeywords: row.meta_keywords,
    slug: row.slug,
    skinType: row.skin_type,
    hairType: row.hair_type,
    hairConcerns: row.hair_concerns,
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

const toSafeString = (val) => {
  if (val === null || val === undefined) return '';
  if (Array.isArray(val)) return val.join(', ');
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val);
};

const toSafeJsonString = (val) => {
  if (!val) return JSON.stringify([]);
  if (typeof val === 'string') {
    try { JSON.parse(val); return val; } catch { return JSON.stringify([val]); }
  }
  return JSON.stringify(val);
};

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

products.post('/create', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const {
      id: frontendId,
      name,
      brand = 'Richfem',
      mainCategory = 'Other',
      subCategory = '',
      description = [],
      keyFeatures = [],
      price,
      originalPrice = 0,
      discountPercent = 0,
      tax = 18,
      stock = 10,
      sku = null,
      weight = '',
      dimensions = '',
      images = [],
      skinType = 'all',
      concerns = [],
      ingredients = '',
      finish = '',
      coverage = '',
      shade = '',
      hairType = 'all',
      hairConcerns = [],
      fabric = '',
      material = '',
      gender = 'unisex',
      variations = [],
      hasVariations = false,
      metaTitle = '',
      metaDescription = '',
      metaKeywords = '',
      slug = '',
      isActive = true,
      isFeatured = false,
      vendorId = 'admin',
      vendorName = 'MyPinkShop',
    } = body;

    if (!name || price === undefined || price === null) {
      return fail(c, 'name and price are required.', 400);
    }

    const id = frontendId || genId('prod');

    // Frontend pre-generates a client-side id (and uses it as the slug) so
    // the SEO URL it previews to the admin matches the real saved product.
    // If that id is already taken, don't silently overwrite — fail clearly.
    if (frontendId) {
      const existing = await c.env.DB.prepare('SELECT id FROM products WHERE id = ?').bind(id).first();
      if (existing) {
        return fail(c, `A product with id "${id}" already exists.`, 409);
      }
    }

    await c.env.DB.prepare(
      `INSERT INTO products
        (id, vendor_id, vendor_name, name, brand, main_category, sub_category, category_slug,
         description, about_this_item, key_features, price, original_price, discount_percent, tax, stock, sku,
         weight, dimensions, images, skin_type, concerns, ingredients, finish, coverage, shade,
         hair_type, hair_concerns, fabric, material, gender, variations, has_variations,
         meta_title, meta_description, meta_keywords, slug, rating, review_count, is_active, is_featured, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 4.8, 0, ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        vendorId,
        vendorName,
        toSafeString(name),
        toSafeString(brand),
        toSafeString(mainCategory),
        toSafeString(subCategory),
        toSafeString(slug),
        toSafeString(Array.isArray(description) ? description.join('\n') : description),
        toSafeJsonString(description),
        toSafeJsonString(keyFeatures),
        parseFloat(price) || 0,
        parseFloat(originalPrice) || 0,
        parseFloat(discountPercent) || 0,
        parseFloat(tax) || 18,
        parseInt(stock, 10) || 10,
        toSafeString(sku),
        toSafeString(weight),
        toSafeString(dimensions),
        toSafeJsonString(images),
        toSafeString(skinType),
        toSafeJsonString(concerns),
        toSafeString(ingredients),
        toSafeString(finish),
        toSafeString(coverage),
        toSafeString(shade),
        toSafeString(hairType),
        toSafeJsonString(hairConcerns),
        toSafeString(fabric),
        toSafeString(material),
        toSafeString(gender),
        toSafeJsonString(variations),
        hasVariations ? 1 : 0,
        toSafeString(metaTitle),
        toSafeString(metaDescription),
        toSafeString(metaKeywords),
        toSafeString(slug || id),
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

// PUT /api/products/:id — edit an existing product (used by AdminEditProduct.jsx)
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
      description:
        body.description !== undefined
          ? toSafeString(Array.isArray(body.description) ? body.description.join('\n') : body.description)
          : existing.description,
      about_this_item: body.description !== undefined ? toSafeJsonString(body.description) : existing.about_this_item,
      key_features: body.keyFeatures !== undefined ? toSafeJsonString(body.keyFeatures) : existing.key_features,
      price: body.price !== undefined ? parseFloat(body.price) || 0 : existing.price,
      original_price: body.originalPrice !== undefined ? parseFloat(body.originalPrice) || 0 : existing.original_price,
      discount_percent: body.discountPercent !== undefined ? parseFloat(body.discountPercent) || 0 : existing.discount_percent,
      tax: body.tax !== undefined ? parseFloat(body.tax) || 18 : existing.tax,
      stock: body.stock !== undefined ? parseInt(body.stock, 10) || 0 : existing.stock,
      sku: body.sku !== undefined ? toSafeString(body.sku) : existing.sku,
      weight: body.weight !== undefined ? toSafeString(body.weight) : existing.weight,
      dimensions: body.dimensions !== undefined ? toSafeString(body.dimensions) : existing.dimensions,
      images: body.images !== undefined ? toSafeJsonString(body.images) : existing.images,
      skin_type: body.skinType !== undefined ? toSafeString(body.skinType) : existing.skin_type,
      concerns: body.concerns !== undefined ? toSafeJsonString(body.concerns) : existing.concerns,
      ingredients: body.ingredients !== undefined ? toSafeString(body.ingredients) : existing.ingredients,
      finish: body.finish !== undefined ? toSafeString(body.finish) : existing.finish,
      coverage: body.coverage !== undefined ? toSafeString(body.coverage) : existing.coverage,
      shade: body.shade !== undefined ? toSafeString(body.shade) : existing.shade,
      hair_type: body.hairType !== undefined ? toSafeString(body.hairType) : existing.hair_type,
      hair_concerns: body.hairConcerns !== undefined ? toSafeJsonString(body.hairConcerns) : existing.hair_concerns,
      fabric: body.fabric !== undefined ? toSafeString(body.fabric) : existing.fabric,
      material: body.material !== undefined ? toSafeString(body.material) : existing.material,
      gender: body.gender !== undefined ? toSafeString(body.gender) : existing.gender,
      variations: body.variations !== undefined ? toSafeJsonString(body.variations) : existing.variations,
      has_variations:
        body.hasVariations !== undefined ? (body.hasVariations ? 1 : 0) : existing.has_variations,
      meta_title: body.metaTitle !== undefined ? toSafeString(body.metaTitle) : existing.meta_title,
      meta_description: body.metaDescription !== undefined ? toSafeString(body.metaDescription) : existing.meta_description,
      meta_keywords: body.metaKeywords !== undefined ? toSafeString(body.metaKeywords) : existing.meta_keywords,
      slug: body.slug !== undefined ? toSafeString(body.slug) : existing.slug,
      is_active: body.isActive !== undefined ? (body.isActive ? 1 : 0) : existing.is_active,
      is_featured: body.isFeatured !== undefined ? (body.isFeatured ? 1 : 0) : existing.is_featured,
    };

    await c.env.DB.prepare(
      `UPDATE products SET
        name = ?, brand = ?, main_category = ?, sub_category = ?,
        description = ?, about_this_item = ?, key_features = ?,
        price = ?, original_price = ?, discount_percent = ?, tax = ?, stock = ?, sku = ?,
        weight = ?, dimensions = ?, images = ?,
        skin_type = ?, concerns = ?, ingredients = ?, finish = ?, coverage = ?, shade = ?,
        hair_type = ?, hair_concerns = ?, fabric = ?, material = ?, gender = ?,
        variations = ?, has_variations = ?,
        meta_title = ?, meta_description = ?, meta_keywords = ?, slug = ?,
        is_active = ?, is_featured = ?, updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(
        merged.name,
        merged.brand,
        merged.main_category,
        merged.sub_category,
        merged.description,
        merged.about_this_item,
        merged.key_features,
        merged.price,
        merged.original_price,
        merged.discount_percent,
        merged.tax,
        merged.stock,
        merged.sku,
        merged.weight,
        merged.dimensions,
        merged.images,
        merged.skin_type,
        merged.concerns,
        merged.ingredients,
        merged.finish,
        merged.coverage,
        merged.shade,
        merged.hair_type,
        merged.hair_concerns,
        merged.fabric,
        merged.material,
        merged.gender,
        merged.variations,
        merged.has_variations,
        merged.meta_title,
        merged.meta_description,
        merged.meta_keywords,
        merged.slug,
        merged.is_active,
        merged.is_featured,
        id
      )
      .run();

    const updated = await c.env.DB.prepare('SELECT * FROM products WHERE id = ?').bind(id).first();
    return ok(c, serializeProduct(updated));
  } catch (err) {
    return fail(c, `Failed to update product: ${err.message}`, 500);
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
