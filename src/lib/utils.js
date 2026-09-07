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

// ✅ ORDER NUMBER: MPS-XX-XXXX-XXXXXX style
export function genOrderNumber() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0'); // 2 digit month (01-12)
  const randomPart1 = Math.floor(1000 + Math.random() * 9000).toString(); // 4 digit
  const randomPart2 = Math.floor(100000 + Math.random() * 900000).toString(); // 6 digit
  return `MPS-${month}-${randomPart1}-${randomPart2}`;
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
