// src/lib/utils.js
// Small shared helpers used across route modules.
// Ecommerce-grade storage manager with auto-cleanup, quota handling, and safety.

// ============================================================
// ✅ RESPONSE HELPERS (Backend / API)
// ============================================================

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

// ============================================================
// ✅ ID / ORDER GENERATORS
// ============================================================

export function genId(prefix = '') {
  const random = crypto.randomUUID().replace(/-/g, '').slice(0, 20);
  return prefix ? `${prefix}_${random}` : random;
}

// ✅ ORDER NUMBER: MPS-XX-XXXX-XXXXXX style
export function genOrderNumber() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const randomPart1 = Math.floor(1000 + Math.random() * 9000).toString();
  const randomPart2 = Math.floor(100000 + Math.random() * 900000).toString();
  return `MPS-${month}-${randomPart1}-${randomPart2}`;
}

// ============================================================
// ✅ PAGINATION / PARSERS
// ============================================================

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
// ✅ GLOBAL STORAGE MANAGER (Ecommerce-grade)
// Amazon/Flipkart pattern:
// - Cache alag namespace me
// - User data (cart/checkout) kabhi auto-delete nahi
// - Quota exceeded par LRU-style eviction
// - TTL support
// - localStorage + sessionStorage dono support
// ============================================================

// 🔑 Cache key prefixes — sirf yeh auto-delete honge
const CACHE_PREFIXES = [
  'product_',
  'products_cache',
  'banners_cache',
  'category_cache',
  'home_cache',
  'product_cache_time_',
  'search_cache_',
  'api_cache_',
];

// 🔒 Protected prefixes — inhe KABHI auto-delete nahi karna
const PROTECTED_PREFIXES = [
  'checkout_',
  'cart_',
  'cart',
  'user_',
  'user',
  'auth_',
  'auth',
  'token',
  'wishlist_',
  'wishlist',
  'order_',
  'address_',
  'coupon_',
  'session_',
];

// 🕒 Max age for cache (7 days default)
const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const AUTO_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24 hours
const CLEANUP_FLAG_KEY = 'last_auto_cleanup_v2';

// ------------------------------------------------------------
// Helpers: key classification
// ------------------------------------------------------------
function isProtectedKey(key) {
  if (!key) return false;
  return PROTECTED_PREFIXES.some(p => key === p || key.startsWith(p));
}

function isCacheKey(key) {
  if (!key) return false;
  if (isProtectedKey(key)) return false;
  return CACHE_PREFIXES.some(p => key === p || key.startsWith(p));
}

// ------------------------------------------------------------
// 1️⃣ Safe SetItem — Quota exceeded par smart cleanup
// ✅ Works for BOTH localStorage and sessionStorage
// ------------------------------------------------------------
export function safeSetItem(storage, key, value, options = {}) {
  const { protected: isProtected = false } = options;

  try {
    storage.setItem(key, value);
    return true;
  } catch (e) {
    const isQuota =
      e.name === 'QuotaExceededError' ||
      e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 ||
      e.code === 1014;

    if (!isQuota) {
      console.warn('⚠️ Storage setItem failed:', e);
      return false;
    }

    console.warn('⚠️ Storage quota exceeded. Starting smart cleanup...');

    // Step 1: Delete expired cache keys
    removeExpiredCache(storage);

    // Step 2: Delete oldest cache keys (LRU)
    const removed = removeOldestCache(storage, 10);

    // Step 3: Retry
    try {
      storage.setItem(key, value);
      console.log(`✅ Saved after cleanup (freed ${removed} items)`);
      return true;
    } catch (e2) {
      // Step 4: Last resort — clear ALL cache (protected safe)
      if (!isProtected) {
        console.warn('⚠️ Still full. Clearing all cache...');
        clearAllCache(storage);
        try {
          storage.setItem(key, value);
          console.log('✅ Saved after full cache clear');
          return true;
        } catch (e3) {
          console.error('❌ Storage completely full. Save skipped.');
          return false;
        }
      }
      console.error('❌ Cannot save protected key — storage full.');
      return false;
    }
  }
}

// ------------------------------------------------------------
// 2️⃣ Safe GetItem
// ------------------------------------------------------------
export function safeGetItem(storage, key, parseJson = false) {
  try {
    const raw = storage.getItem(key);
    if (raw === null) return null;
    if (!parseJson) return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// 3️⃣ Safe RemoveItem
// ------------------------------------------------------------
export function safeRemoveItem(storage, key) {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// 4️⃣ Cache with TTL (timestamp + expiry payload)
// ------------------------------------------------------------
export function setCacheWithTTL(storage, key, value, ttlMs = CACHE_MAX_AGE_MS) {
  const payload = JSON.stringify({
    v: value,
    t: Date.now(),
    exp: Date.now() + ttlMs,
  });
  return safeSetItem(storage, key, payload);
}

export function getCacheWithTTL(storage, key) {
  const raw = safeGetItem(storage, key);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.exp && Date.now() > parsed.exp) {
      safeRemoveItem(storage, key);
      return null;
    }
    return parsed.v;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------
// 5️⃣ Remove expired cache keys
// ------------------------------------------------------------
function removeExpiredCache(storage) {
  let removed = 0;
  const now = Date.now();
  const keys = [];

  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (isCacheKey(k)) keys.push(k);
  }

  for (const k of keys) {
    try {
      const raw = storage.getItem(k);
      if (!raw) continue;
      if (raw.startsWith('{"v":')) {
        const parsed = JSON.parse(raw);
        if (parsed.exp && now > parsed.exp) {
          storage.removeItem(k);
          removed++;
        }
      } else if (k.startsWith('product_cache_time_')) {
        const ts = parseInt(raw, 10);
        if (Number.isFinite(ts) && now - ts > CACHE_MAX_AGE_MS) {
          storage.removeItem(k);
          removed++;
        }
      }
    } catch {
      storage.removeItem(k);
      removed++;
    }
  }
  return removed;
}

// ------------------------------------------------------------
// 6️⃣ Remove oldest cache keys (LRU)
// ------------------------------------------------------------
function removeOldestCache(storage, count = 10) {
  const entries = [];
  const now = Date.now();

  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!isCacheKey(k)) continue;
    try {
      const raw = storage.getItem(k);
      let ts = 0;
      if (raw && raw.startsWith('{"v":')) {
        const parsed = JSON.parse(raw);
        ts = parsed.t || 0;
      } else if (k.startsWith('product_cache_time_')) {
        ts = parseInt(raw || '0', 10) || 0;
      }
      entries.push({ key: k, age: now - ts });
    } catch {
      entries.push({ key: k, age: Infinity });
    }
  }

  entries.sort((a, b) => b.age - a.age); // oldest first

  let removed = 0;
  for (let i = 0; i < Math.min(count, entries.length); i++) {
    storage.removeItem(entries[i].key);
    removed++;
  }
  return removed;
}

// ------------------------------------------------------------
// 7️⃣ Auto Cleanup — app start par call karo
// ------------------------------------------------------------
export function runAutoCleanup(storage = localStorage) {
  try {
    const last = storage.getItem(CLEANUP_FLAG_KEY);
    const now = Date.now();

    if (last && now - parseInt(last, 10) < AUTO_CLEANUP_INTERVAL_MS) {
      return { skipped: true };
    }

    const expired = removeExpiredCache(storage);
    const oldest = removeOldestCache(storage, 20);

    storage.setItem(CLEANUP_FLAG_KEY, String(now));
    console.log(`✅ Auto-cleanup done (expired: ${expired}, oldest: ${oldest})`);
    return { expired, oldest };
  } catch (e) {
    console.warn('Cleanup error:', e);
    return { error: true };
  }
}

// ------------------------------------------------------------
// 8️⃣ Manual Clear — sirf cache (protected safe)
// ✅ Storage param so it works for both local & session
// ------------------------------------------------------------
export function clearAllCache(storage = localStorage) {
  const keys = [];
  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (isCacheKey(k)) keys.push(k);
  }
  keys.forEach(k => storage.removeItem(k));
  console.log(`✅ Cleared ${keys.length} cache items`);
  return keys.length;
}

// ------------------------------------------------------------
// 9️⃣ Nuclear Option — logout ke liye
// ------------------------------------------------------------
export function clearAllStorage(storage = localStorage) {
  try {
    storage.clear();
    console.log('✅ All storage cleared');
    return true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------
// 🔟 Storage Health Check
// ------------------------------------------------------------
export function getStorageUsage(storage = localStorage) {
  let total = 0;
  let cacheBytes = 0;
  let protectedBytes = 0;
  let cacheCount = 0;
  let protectedCount = 0;

  for (let i = 0; i < storage.length; i++) {
    const k = storage.key(i);
    if (!k) continue;
    const size = ((storage.getItem(k) || '').length + k.length) * 2;
    total += size;
    if (isCacheKey(k)) {
      cacheBytes += size;
      cacheCount++;
    } else if (isProtectedKey(k)) {
      protectedBytes += size;
      protectedCount++;
    }
  }

  const QUOTA = 5 * 1024 * 1024;
  return {
    totalBytes: total,
    totalKB: (total / 1024).toFixed(2),
    totalMB: (total / (1024 * 1024)).toFixed(2),
    percent: ((total / QUOTA) * 100).toFixed(2),
    cacheBytes,
    cacheKB: (cacheBytes / 1024).toFixed(2),
    cacheCount,
    protectedBytes,
    protectedKB: (protectedBytes / 1024).toFixed(2),
    protectedCount,
  };
}

// ------------------------------------------------------------
// 1️⃣1️⃣ App start hone par yeh call karo
// ------------------------------------------------------------
export function initStorageManager() {
  if (typeof window === 'undefined') return;
  try {
    runAutoCleanup(localStorage);
    runAutoCleanup(sessionStorage); // ✅ sessionStorage bhi
    window.addEventListener('beforeunload', () => {
      try {
        removeExpiredCache(localStorage);
        removeExpiredCache(sessionStorage);
      } catch {}
    });
  } catch (e) {
    console.warn('Storage manager init failed:', e);
  }
}
