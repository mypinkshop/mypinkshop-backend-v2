// src/routes/banners.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const banners = new Hono();

/* --------------------------------------------------------------------- */
/* Helpers                                                               */
/* --------------------------------------------------------------------- */

function parseArray(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') {
    try {
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
      return val.trim() ? [val.trim()] : [];
    } catch {
      return val.trim() ? [val.trim()] : [];
    }
  }
  return [];
}

function parseJSONArrayFromForm(body, key) {
  const val = body[key];
  if (val === undefined || val === null) return [];
  if (Array.isArray(val)) return val.filter(Boolean);
  if (typeof val === 'string') {
    if (val.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed.filter(Boolean);
      } catch {}
    }
    if (val.includes(',')) {
      return val.split(',').map((s) => s.trim()).filter(Boolean);
    }
    return val.trim() ? [val.trim()] : [];
  }
  return [];
}

function formatBanner(b) {
  let images = [];
  if (b.images) {
    try {
      const parsed = typeof b.images === 'string' ? JSON.parse(b.images) : b.images;
      if (Array.isArray(parsed)) images = parsed.filter(Boolean);
    } catch {}
  }
  if (images.length === 0 && b.image) {
    images = [b.image];
  }

  const categories = parseArray(b.category);
  const positions = parseArray(b.position);
  const subcategories = parseArray(b.subcategories);

  return {
    _id: b.id,
    id: b.id,
    title: b.title || '',
    subtitle: b.subtitle || '',
    buttonText: b.button_text || '',
    link: b.link || '/shop',
    images,
    order: b.sort_order ?? 0,
    active: b.active === 1,
    showTextOverlay: b.show_text_overlay === 1,
    categories,
    positions,
    subcategories,
    // Backward compatibility
    category: categories[0] || null,
    position: positions[0] || 'home_hero',
    size: b.size || 'large',
    display_style: b.display_style || 'single',
    link_type: b.link_type || 'custom',
    created_at: b.created_at || null,
  };
}

async function handleImageUpload(body) {
  const rawImages = body.images;
  const uploadedFiles = Array.isArray(rawImages)
    ? rawImages
    : rawImages
      ? [rawImages]
      : [];

  const urls = [];

  for (const file of uploadedFiles) {
    if (file && typeof file === 'object' && typeof file.arrayBuffer === 'function') {
      try {
        const buffer = await file.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const base64 = btoa(binary);
        urls.push(`data:${file.type || 'image/jpeg'};base64,${base64}`);
      } catch (e) {
        console.error('Image conversion error:', e);
      }
    }
  }

  if (urls.length === 0 && body.image) {
    if (typeof body.image === 'string') {
      urls.push(body.image);
    } else if (typeof body.image === 'object' && typeof body.image.arrayBuffer === 'function') {
      try {
        const buffer = await body.image.arrayBuffer();
        const bytes = new Uint8Array(buffer);
        let binary = '';
        const chunk = 0x8000;
        for (let i = 0; i < bytes.length; i += chunk) {
          binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
        }
        const base64 = btoa(binary);
        urls.push(`data:${body.image.type || 'image/jpeg'};base64,${base64}`);
      } catch (e) {
        console.error('Image conversion error:', e);
      }
    }
  }

  return urls;
}

function boolFromBody(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  return val === 'true' || val === '1' || val === 1;
}

function intFromBody(val, defaultVal = 0) {
  const n = parseInt(val);
  return Number.isFinite(n) ? n : defaultVal;
}

/* --------------------------------------------------------------------- */
/* ✅ CATEGORY POSITIONS — 9 categories × 3 banners = 27 new positions   */
/* --------------------------------------------------------------------- */

const CATEGORY_POSITIONS = [
  // Skincare
  { value: 'skincare_mid_1',    label: '🧴 Skincare — Mid 1',    size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'skincare_mid_2',    label: '🧴 Skincare — Mid 2',    size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'skincare_bottom',   label: '🧴 Skincare — Bottom',   size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

  // Makeup
  { value: 'makeup_mid_1',      label: '💄 Makeup — Mid 1',      size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'makeup_mid_2',      label: '💄 Makeup — Mid 2',      size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'makeup_bottom',     label: '💄 Makeup — Bottom',     size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

  // Haircare
  { value: 'haircare_mid_1',    label: '💇‍♀️ Haircare — Mid 1',   size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'haircare_mid_2',    label: '💇‍♀️ Haircare — Mid 2',   size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'haircare_bottom',   label: '💇‍♀️ Haircare — Bottom',  size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

  // Fashion
  { value: 'fashion_mid_1',     label: '👗 Fashion — Mid 1',     size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'fashion_mid_2',     label: '👗 Fashion — Mid 2',     size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'fashion_bottom',    label: '👗 Fashion — Bottom',    size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

  // Accessories
  { value: 'accessories_mid_1', label: '👜 Accessories — Mid 1', size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'accessories_mid_2', label: '👜 Accessories — Mid 2', size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'accessories_bottom',label: '👜 Accessories — Bottom',size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

  // Electronics
  { value: 'electronics_mid_1', label: '📱 Electronics — Mid 1', size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'electronics_mid_2', label: '📱 Electronics — Mid 2', size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'electronics_bottom',label: '📱 Electronics — Bottom',size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

  // Home & Kitchen
  { value: 'home_kitchen_mid_1',    label: '🏠 Home & Kitchen — Mid 1',    size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'home_kitchen_mid_2',    label: '🏠 Home & Kitchen — Mid 2',    size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'home_kitchen_bottom',   label: '🏠 Home & Kitchen — Bottom',   size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

  // Health & Wellness
  { value: 'health_mid_1',      label: '💊 Health — Mid 1',      size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'health_mid_2',      label: '💊 Health — Mid 2',      size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'health_bottom',     label: '💊 Health — Bottom',     size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

  // Books & Stationery
  { value: 'books_mid_1',       label: '📚 Books — Mid 1',       size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
  { value: 'books_mid_2',       label: '📚 Books — Mid 2',       size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
  { value: 'books_bottom',      label: '📚 Books — Bottom',      size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },
];

/* --------------------------------------------------------------------- */
/* OPTIONS                                                               */
/* --------------------------------------------------------------------- */

banners.get('/options', async (c) => {
  return ok(c, {
    sizes: [
      { value: 'small',  label: 'Small',  hint: '300×200',   aspect: '3/2' },
      { value: 'medium', label: 'Medium', hint: '600×300',   aspect: '2/1' },
      { value: 'large',  label: 'Large',  hint: '1200×400',  aspect: '3/1' },
      { value: 'xl',     label: 'XL',     hint: '1600×500',  aspect: '16/5' },
      { value: 'full',   label: 'Full',   hint: '1920×600',  aspect: '16/5' },
      { value: 'square', label: 'Square', hint: '500×500',   aspect: '1/1' },
      { value: 'tall',   label: 'Tall',   hint: '400×800',   aspect: '1/2' },
    ],
    styles: [
      { value: 'single',  label: 'Single',  hint: 'One full-width banner' },
      { value: 'slide',   label: 'Slide',   hint: 'Multiple rotating' },
      { value: 'split',   label: 'Split',   hint: 'Text + image' },
      { value: 'overlay', label: 'Overlay', hint: 'Text on image' },
      { value: 'grid',    label: 'Grid',    hint: '2–4 side by side' },
    ],
    positions: [
      // ✅ GLOBAL POSITIONS
      { value: 'home_hero',       label: '🏠 Home Hero',       size: 'full',  style: 'slide',   px: '1920×600', ratio: '16:5' },
      { value: 'category_hero',   label: '📄 Category Hero',   size: 'xl',    style: 'single',  px: '1600×500', ratio: '16:5' },
      { value: 'category_mid_1',  label: '📄 Global Mid 1',    size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
      { value: 'category_mid_2',  label: '📄 Global Mid 2',    size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
      { value: 'category_mid_3',  label: '📄 Global Mid 3',    size: 'large', style: 'slide',   px: '1200×400', ratio: '3:1' },
      { value: 'category_bottom', label: '📄 Global Bottom',   size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },

      // ✅ NAYE — 27 CATEGORY-SPECIFIC POSITIONS
      ...CATEGORY_POSITIONS,
    ],
    link_types: [
      { value: 'category',    label: 'Category' },
      { value: 'subcategory', label: 'Subcategory' },
      { value: 'brand',       label: 'Brand' },
      { value: 'product',     label: 'Product' },
      { value: 'custom',      label: 'Custom URL' },
    ],
  });
});

/* --------------------------------------------------------------------- */
/* PUBLIC                                                                */
/* --------------------------------------------------------------------- */

banners.get('/active', async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');
    const position = url.searchParams.get('position');

    let query = 'SELECT * FROM banners WHERE active = 1';
    const bindings = [];

    if (category) {
      query += ` AND (
        category IS NULL OR category = '' OR category = '[]'
        OR category LIKE ?
      )`;
      bindings.push(`%"${category}"%`);
    }

    if (position) {
      query += ` AND (
        position IS NULL OR position = '' OR position = '[]'
        OR position LIKE ?
      )`;
      bindings.push(`%"${position}"%`);
    }

    query += ' ORDER BY sort_order ASC, created_at DESC';

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
    return c.json((results || []).map(formatBanner));
  } catch (err) {
    return fail(c, `Failed to load active banners: ${err.message}`, 500);
  }
});

banners.get('/', async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');
    const position = url.searchParams.get('position');
    const all = url.searchParams.get('all') === 'true';

    let query = 'SELECT * FROM banners WHERE 1=1';
    const bindings = [];

    if (!all) query += ' AND active = 1';

    if (category) {
      query += ` AND (
        category IS NULL OR category = '' OR category = '[]'
        OR category LIKE ?
      )`;
      bindings.push(`%"${category}"%`);
    }

    if (position) {
      query += ` AND (
        position IS NULL OR position = '' OR position = '[]'
        OR position LIKE ?
      )`;
      bindings.push(`%"${position}"%`);
    }

    query += ' ORDER BY sort_order ASC, created_at DESC';

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
    return c.json((results || []).map(formatBanner));
  } catch (err) {
    return fail(c, `Failed to load banners: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* ADMIN                                                                 */
/* --------------------------------------------------------------------- */

banners.get('/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM banners ORDER BY sort_order ASC, created_at DESC'
    ).all();
    return c.json((results || []).map(formatBanner));
  } catch (err) {
    return fail(c, `Failed to load banners: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* CREATE / UPDATE                                                       */
/* --------------------------------------------------------------------- */

async function createBanner(c) {
  const body = await c.req.parseBody().catch(() => ({}));

  const title = (body.title && String(body.title).trim()) || 'Untitled Banner';
  const subtitle = body.subtitle || '';
  const buttonText = body.buttonText || 'Shop Now';
  const link = body.link || '/shop';
  const imageKey = body.imageKey || '';
  const order = intFromBody(body.order, 0);
  const active = boolFromBody(body.active, true) ? 1 : 0;

  const categories = parseJSONArrayFromForm(body, 'categories');
  const positions = parseJSONArrayFromForm(body, 'positions');
  const subcategories = parseJSONArrayFromForm(body, 'subcategories');

  if (positions.length === 0 && body.position) {
    positions.push(body.position);
  }
  if (positions.length === 0) {
    positions.push('home_hero');
  }

  const size = body.size || 'large';
  const display_style = body.display_style || 'single';
  const link_type = body.link_type || 'custom';
  const show_text_overlay = boolFromBody(body.showTextOverlay, false) ? 1 : 0;

  const imageUrls = await handleImageUpload(body);
  const imagesJson = JSON.stringify(imageUrls);
  const primaryImage = imageUrls[0] || '';

  const id = genId('ban');

  await c.env.DB.prepare(
    `INSERT INTO banners
      (id, title, subtitle, button_text, link, image, images, image_key,
       sort_order, active, category, position, subcategories,
       size, display_style, link_type,
       show_text_overlay, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  )
    .bind(
      id, title, subtitle, buttonText, link,
      primaryImage, imagesJson, imageKey,
      order, active,
      JSON.stringify(categories),
      JSON.stringify(positions),
      JSON.stringify(subcategories),
      size, display_style, link_type,
      show_text_overlay
    )
    .run();

  const created = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
  return ok(c, formatBanner(created), undefined, 201);
}

async function updateBanner(c) {
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
  if (!existing) return fail(c, 'Banner not found.', 404);

  const body = await c.req.parseBody().catch(() => ({}));
  const newImageUrls = await handleImageUpload(body);

  let imagesJson = existing.images || '[]';
  let primaryImage = existing.image || '';

  if (newImageUrls.length > 0) {
    imagesJson = JSON.stringify(newImageUrls);
    primaryImage = newImageUrls[0];
  }

  let categories = parseJSONArrayFromForm(body, 'categories');
  let positions = parseJSONArrayFromForm(body, 'positions');
  let subcategories = parseJSONArrayFromForm(body, 'subcategories');

  if (categories.length === 0 && body.categories === undefined) {
    categories = parseArray(existing.category);
  }
  if (positions.length === 0 && body.positions === undefined) {
    positions = parseArray(existing.position);
  }
  if (subcategories.length === 0 && body.subcategories === undefined) {
    subcategories = parseArray(existing.subcategories);
  }

  const merged = {
    title: body.title !== undefined
      ? ((body.title && String(body.title).trim()) || 'Untitled Banner')
      : existing.title,
    subtitle: body.subtitle ?? existing.subtitle,
    button_text: body.buttonText ?? existing.button_text,
    link: body.link ?? existing.link,
    image: primaryImage,
    images: imagesJson,
    image_key: body.imageKey ?? existing.image_key,
    sort_order: body.order !== undefined ? intFromBody(body.order, existing.sort_order) : existing.sort_order,
    active: body.active !== undefined ? (boolFromBody(body.active, true) ? 1 : 0) : existing.active,
    category: JSON.stringify(categories),
    position: JSON.stringify(positions),
    subcategories: JSON.stringify(subcategories),
    size: body.size !== undefined ? body.size : (existing.size || 'large'),
    display_style: body.display_style !== undefined ? body.display_style : (existing.display_style || 'single'),
    link_type: body.link_type !== undefined ? body.link_type : (existing.link_type || 'custom'),
    show_text_overlay:
      body.showTextOverlay !== undefined
        ? (boolFromBody(body.showTextOverlay, false) ? 1 : 0)
        : (existing.show_text_overlay ?? 0),
  };

  await c.env.DB.prepare(
    `UPDATE banners SET
      title = ?, subtitle = ?, button_text = ?, link = ?,
      image = ?, images = ?, image_key = ?,
      sort_order = ?, active = ?,
      category = ?, position = ?, subcategories = ?,
      size = ?, display_style = ?, link_type = ?,
      show_text_overlay = ?
     WHERE id = ?`
  )
    .bind(
      merged.title, merged.subtitle, merged.button_text, merged.link,
      merged.image, merged.images, merged.image_key,
      merged.sort_order, merged.active,
      merged.category, merged.position, merged.subcategories,
      merged.size, merged.display_style, merged.link_type,
      merged.show_text_overlay,
      id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
  return ok(c, formatBanner(updated));
}

/* --------------------------------------------------------------------- */
/* ROUTES                                                                */
/* --------------------------------------------------------------------- */

banners.post('/', authMiddleware, requireAdmin, createBanner);
banners.post('/create', authMiddleware, requireAdmin, createBanner);
banners.put('/:id', authMiddleware, requireAdmin, updateBanner);

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
