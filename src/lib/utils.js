// src/lib/utils.js
// Small shared helpers used across route modules.

export function ok(c, data, meta = undefined, status = 200) {
  const body = { success: true, data };
  if (meta) body.meta = meta;
  return c.json(body, status);
}

export function fail(c, message, status = 400, details = undefined) {
  const body = { success: false, error: message };
  if (details) body.details = details;
  return c.json(body, status);
}

export function genId(prefix = '') {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return prefix ? `${prefix}_${random}` : random;
}

export function genOrderNumber() {
  const now = new Date();
  const datePart = now.toISOString().slice(0, 10).replace(/-/g, '');
  const randomPart = Math.floor(1000 + Math.random() * 9000);
  return `ORD-${datePart}-${randomPart}`;
}

export function parsePagination(c) {
  const url = new URL(c.req.url);
  let page = parseInt(url.searchParams.get('page') || '1', 10);
  let limit = parseInt(url.searchParams.get('limit') || '20', 10);
  if (!Number.isFinite(page) || page < 1) page = 1;
  if (!Number.isFinite(limit) || limit < 1) limit = 20;
  if (limit > 100) limit = 100;
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

// Safely parse a JSON text column (e.g. images, aboutThisItem) that may be
// null/undefined/empty/invalid; always returns an array.
export function safeJsonArray(text) {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function toBool(value) {
  return value === 1 || value === true || value === '1' || value === 'true';
}
