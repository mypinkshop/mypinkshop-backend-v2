// src/routes/banners.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const banners = new Hono();

/* --------------------------------------------------------------------- */
/* Helpers                                                               */
/* --------------------------------------------------------------------- */

/**
 * DB row → API response format
 */
function formatBanner(b) {
  let images = [];
  if (b.images) {
    try {
      const parsed = typeof b.images === 'string' ? JSON.parse(b.images) : b.images;
      if (Array.isArray(parsed)) images = parsed.filter(Boolean);
    } catch {
      // ignore
    }
  }
  if (images.length === 0 && b.image) {
    images = [b.image];
  }

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
    showTextOverlay: b.show_text_overlay !== 0,
    category: b.category || null,
    position: b.position || 'home_hero',
    size: b.size || 'large',
    display_style: b.display_style || 'single',
    link_type: b.link_type || 'custom',
    created_at: b.created_at || null,
  };
}

/**
 * Single/multiple files → base64 data URLs
 */
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

  // Fallback: single `image` field
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

/**
 * Safe boolean from body
 */
function boolFromBody(val, defaultVal = false) {
  if (val === undefined || val === null || val === '') return defaultVal;
  if (typeof val === 'boolean') return val;
  return val === 'true' || val === '1' || val === 1;
}

/**
 * Safe int from body
 */
function intFromBody(val, defaultVal = 0) {
  const n = parseInt(val);
  return Number.isFinite(n) ? n : defaultVal;
}

/* --------------------------------------------------------------------- */
/* OPTIONS — saare dropdown options ek jagah (public)                    */
/* --------------------------------------------------------------------- */

banners.get('/options', async (c) => {
  return ok(c, {
    sizes: [
      { value: 'small',  label: 'Small',  hint: '300×200' },
      { value: 'medium', label: 'Medium', hint: '600×300' },
      { value: 'large',  label: 'Large',  hint: '1200×400' },
      { value: 'xl',     label: 'XL',     hint: '1600×500' },
      { value: 'full',   label: 'Full',   hint: '1920×600' },
    ],
    styles: [
      { value: 'single',  label: 'Single',  hint: 'Ek banner full width' },
      { value: 'slide',   label: 'Slide',   hint: 'Multiple rotate' },
      { value: 'split',   label: 'Split',   hint: 'Text left + Image right' },
      { value: 'overlay', label: 'Overlay', hint: 'Image pe text' },
      { value: 'grid',    label: 'Grid',    hint: '2-4 side by side' },
    ],
    positions: [
      { value: 'home_hero',       label: '🏠 Home Hero',       size: 'full',  style: 'slide',   px: '1920×600', ratio: '16:5' },
      { value: 'category_hero',   label: '🎯 Category Hero',   size: 'xl',    style: 'single',  px: '1600×500', ratio: '16:5' },
      { value: 'category_mid_1',  label: '📢 Mid 1',           size: 'large', style: 'split',   px: '1200×400', ratio: '3:1' },
      { value: 'category_mid_2',  label: '📢 Mid 2',           size: 'large', style: 'grid',    px: '1200×400', ratio: '3:1' },
      { value: 'category_mid_3',  label: '📢 Mid 3',           size: 'large', style: 'slide',   px: '1200×400', ratio: '3:1' },
      { value: 'category_bottom', label: '⬇️ Bottom',           size: 'xl',    style: 'overlay', px: '1600×500', ratio: '16:5' },
    ],
    link_types: [
      { value: 'category',    label: '📂 Category' },
      { value: 'subcategory', label: '📁 Subcategory' },
      { value: 'brand',       label: '🏷️ Brand' },
      { value: 'product',     label: '🛍️ Specific Product' },
      { value: 'custom',      label: '🔗 Custom URL' },
    ],
  });
});

/* --------------------------------------------------------------------- */
/* Public                                                                */
/* --------------------------------------------------------------------- */

// GET /api/banners/active?category=electronics&position=category_hero
banners.get('/active', async (c) => {
  try {
    const url = new URL(c.req.url);
    const category = url.searchParams.get('category');
    const position = url.searchParams.get('position');

    let query = 'SELECT * FROM banners WHERE active = 1';
    const bindings = [];

    if (category) {
      query += ' AND (category = ? OR category IS NULL)';
      bindings.push(category);
    }

    if (position) {
      query += ' AND position = ?';
      bindings.push(position);
    }

    query += ' ORDER BY sort_order ASC, created_at DESC';

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
    return c.json((results || []).map(formatBanner));
  } catch (err) {
    return fail(c, `Failed to load active banners: ${err.message}`, 500);
  }
});

// GET /api/banners?category=&position=&all=true
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
      query += ' AND (category = ? OR category IS NULL)';
      bindings.push(category);
    }

    if (position) {
      query += ' AND position = ?';
      bindings.push(position);
    }

    query += ' ORDER BY sort_order ASC, created_at DESC';

    const { results } = await c.env.DB.prepare(query).bind(...bindings).all();
    return c.json((results || []).map(formatBanner));
  } catch (err) {
    return fail(c, `Failed to load banners: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* Admin                                                                 */
/* --------------------------------------------------------------------- */

// GET /api/banners/all — saare (including inactive)
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
/* Shared create/update logic                                            */
/* --------------------------------------------------------------------- */

async function createBanner(c) {
  const body = await c.req.parseBody().catch(() => ({}));
  const title = body.title;
  if (!title) return fail(c, 'title is required.', 400);

  const subtitle = body.subtitle || '';
  const buttonText = body.buttonText || 'Shop Now';
  const link = body.link || '/shop';
  const imageKey = body.imageKey || '';
  const order = intFromBody(body.order, 0);
  const active = boolFromBody(body.active, true) ? 1 : 0;

  const category = body.category || null;
  const position = body.position || 'home_hero';
  const size = body.size || 'large';
  const display_style = body.display_style || 'single';
  const link_type = body.link_type || 'custom';
  const show_text_overlay = boolFromBody(body.showTextOverlay, true) ? 1 : 0;

  const imageUrls = await handleImageUpload(body);
  const imagesJson = JSON.stringify(imageUrls);
  const primaryImage = imageUrls[0] || '';

  const id = genId('ban');

  await c.env.DB.prepare(
    `INSERT INTO banners
      (id, title, subtitle, button_text, link, image, images, image_key,
       sort_order, active, category, position, size, display_style, link_type,
       show_text_overlay, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
  )
    .bind(
      id, title, subtitle, buttonText, link,
      primaryImage, imagesJson, imageKey,
      order, active, category, position, size, display_style, link_type,
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

  const merged = {
    title: body.title ?? existing.title,
    subtitle: body.subtitle ?? existing.subtitle,
    button_text: body.buttonText ?? existing.button_text,
    link: body.link ?? existing.link,
    image: primaryImage,
    images: imagesJson,
    image_key: body.imageKey ?? existing.image_key,
    sort_order: body.order !== undefined ? intFromBody(body.order, existing.sort_order) : existing.sort_order,
    active: body.active !== undefined ? (boolFromBody(body.active, true) ? 1 : 0) : existing.active,
    category: body.category !== undefined ? (body.category || null) : existing.category,
    position: body.position !== undefined ? body.position : existing.position,
    size: body.size !== undefined ? body.size : (existing.size || 'large'),
    display_style: body.display_style !== undefined ? body.display_style : (existing.display_style || 'single'),
    link_type: body.link_type !== undefined ? body.link_type : (existing.link_type || 'custom'),
    show_text_overlay:
      body.showTextOverlay !== undefined
        ? (boolFromBody(body.showTextOverlay, true) ? 1 : 0)
        : (existing.show_text_overlay ?? 1),
  };

  await c.env.DB.prepare(
    `UPDATE banners SET
      title = ?, subtitle = ?, button_text = ?, link = ?,
      image = ?, images = ?, image_key = ?,
      sort_order = ?, active = ?,
      category = ?, position = ?, size = ?, display_style = ?, link_type = ?,
      show_text_overlay = ?
     WHERE id = ?`
  )
    .bind(
      merged.title, merged.subtitle, merged.button_text, merged.link,
      merged.image, merged.images, merged.image_key,
      merged.sort_order, merged.active,
      merged.category, merged.position, merged.size, merged.display_style, merged.link_type,
      merged.show_text_overlay,
      id
    )
    .run();

  const updated = await c.env.DB.prepare('SELECT * FROM banners WHERE id = ?').bind(id).first();
  return ok(c, formatBanner(updated));
}

/* --------------------------------------------------------------------- */
/* Create / Update / Delete                                              */
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
