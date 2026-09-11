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

// ============================================================
// ✅ GLOBAL STORAGE MANAGER (Frontend ke liye)
// Poori website par kaam karega — storage full hone par auto-cleanup
// ============================================================

// 1️⃣ Safe SetItem - Auto cleanup if quota exceeded
export function safeSetItem(storage, key, value) {
  try {
    storage.setItem(key, value);
    return true;
  } catch (e) {
    if (e.name === 'QuotaExceededError' || e.code === 22 || e.code === 1014) {
      console.warn('⚠️ Storage full, auto-cleanup starting...');
      
      const keysToRemove = [];
      for (let i = 0; i < storage.length; i++) {
        const k = storage.key(i);
        if (k && (
          k.startsWith('product_') || 
          k.startsWith('products_cache') || 
          k.startsWith('banners_cache') ||
          k.startsWith('product_cache_time_') ||
          k.startsWith('checkout_')
        )) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => storage.removeItem(k));
      
      try {
        storage.setItem(key, value);
        console.log('✅ Storage cleanup successful');
        return true;
      } catch (e2) {
        console.warn('❌ Storage still full, skipping this save');
        return false;
      }
    }
    return false;
  }
}

// 2️⃣ Safe GetItem
export function safeGetItem(storage, key) {
  try {
    return storage.getItem(key);
  } catch (e) {
    return null;
  }
}

// 3️⃣ Auto Cleanup - Har 24 ghante mein purana data hatao
export function runAutoCleanup() {
  try {
    const lastCleanup = localStorage.getItem('last_auto_cleanup');
    const now = Date.now();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    
    if (!lastCleanup || (now - parseInt(lastCleanup)) > ONE_DAY) {
      const keysToRemove = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && (
          k.startsWith('product_') || 
          k.startsWith('products_cache') || 
          k.startsWith('banners_cache') ||
          k.startsWith('product_cache_time_')
        )) {
          keysToRemove.push(k);
        }
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      localStorage.setItem('last_auto_cleanup', now.toString());
      console.log('✅ Auto-cleanup complete');
    }
  } catch (e) {
    console.warn('Cleanup error:', e);
  }
}

// 4️⃣ Clear All Cache (Manual button ke liye)
export function clearAllCache() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k && (
      k.startsWith('product_') || 
      k.startsWith('products_cache') || 
      k.startsWith('banners_cache') ||
      k.startsWith('product_cache_time_') ||
      k.startsWith('checkout_')
    )) {
      keysToRemove.push(k);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
  console.log(`✅ Cleared ${keysToRemove.length} cache items`);
}

// 5️⃣ Storage Health Check (Optional)
export function getStorageUsage() {
  let total = 0;
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (k) {
      total += (localStorage.getItem(k) || '').length;
    }
  }
  return {
    bytes: total,
    kb: (total / 1024).toFixed(2),
    percent: ((total / (5 * 1024 * 1024)) * 100).toFixed(2)
  };
}
