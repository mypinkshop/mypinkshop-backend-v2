// src/routes/settings.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail } from '../lib/utils.js';

const settings = new Hono();

/* --------------------------------------------------------------------- */
/* Helper — fetch all settings from DB                                    */
/* --------------------------------------------------------------------- */
async function getAllSettings(db) {
  try {
    const { results } = await db.prepare('SELECT key, value FROM settings').all();
    const map = {};
    for (const row of results || []) {
      map[row.key] = row.value;
    }
    return map;
  } catch (err) {
    console.error('Failed to load settings:', err);
    return {};
  }
}

/* --------------------------------------------------------------------- */
/* Helper — safe type conversion                                          */
/* --------------------------------------------------------------------- */
function toNumber(val, fallback = 0) {
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  return val === 'true' || val === '1' || val === true;
}

/* --------------------------------------------------------------------- */
/* PUBLIC — GET /api/settings/public                                      */
/* Frontend (Cart, Checkout) use karega                                  */
/* --------------------------------------------------------------------- */
settings.get('/public', async (c) => {
  try {
    const map = await getAllSettings(c.env.DB);

    return ok(c, {
      freeShippingThreshold: toNumber(map.free_shipping_threshold, 499),
      shippingCharge: toNumber(map.shipping_charge, 49),
      expressShippingCharge: toNumber(map.express_shipping_charge, 99),
      taxPercent: toNumber(map.tax_percent, 5),
      codCharge: toNumber(map.cod_charge, 0),
      codAvailable: toBool(map.cod_available, true),
      minOrderValue: toNumber(map.min_order_value, 0),
    });
  } catch (err) {
    return fail(c, `Failed to load public settings: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* ADMIN — GET /api/admin/settings                                        */
/* --------------------------------------------------------------------- */
settings.get('/admin', authMiddleware, requireAdmin, async (c) => {
  try {
    const map = await getAllSettings(c.env.DB);
    return ok(c, map);
  } catch (err) {
    return fail(c, `Failed to load settings: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* ADMIN — PUT /api/admin/settings                                        */
/* Body: { freeShippingThreshold: 499, shippingCharge: 49, ... }          */
/* --------------------------------------------------------------------- */
settings.put('/admin', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    // Map frontend keys → DB keys
    const keyMap = {
      freeShippingThreshold: 'free_shipping_threshold',
      shippingCharge: 'shipping_charge',
      expressShippingCharge: 'express_shipping_charge',
      taxPercent: 'tax_percent',
      codCharge: 'cod_charge',
      codAvailable: 'cod_available',
      minOrderValue: 'min_order_value',
    };

    const updates = [];

    for (const [frontendKey, dbKey] of Object.entries(keyMap)) {
      if (body[frontendKey] !== undefined) {
        const val = typeof body[frontendKey] === 'boolean'
          ? String(body[frontendKey])
          : String(body[frontendKey]);
        updates.push({ key: dbKey, value: val });
      }
    }

    if (updates.length === 0) {
      return fail(c, 'No valid settings to update', 400);
    }

    // Upsert each setting
    for (const { key, value } of updates) {
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))`
      ).bind(key, value).run();
    }

    // Return updated settings
    const map = await getAllSettings(c.env.DB);

    return ok(c, {
      ...map,
      freeShippingThreshold: toNumber(map.free_shipping_threshold, 499),
      shippingCharge: toNumber(map.shipping_charge, 49),
      expressShippingCharge: toNumber(map.express_shipping_charge, 99),
      taxPercent: toNumber(map.tax_percent, 5),
      codCharge: toNumber(map.cod_charge, 0),
      codAvailable: toBool(map.cod_available, true),
      minOrderValue: toNumber(map.min_order_value, 0),
    });
  } catch (err) {
    console.error('Update settings error:', err);
    return fail(c, `Failed to update settings: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* HELPER — reusable for orders.js                                        */
/* --------------------------------------------------------------------- */
export async function getShippingConfig(db) {
  const map = await getAllSettings(db);
  return {
    freeShippingThreshold: toNumber(map.free_shipping_threshold, 499),
    shippingCharge: toNumber(map.shipping_charge, 49),
    taxPercent: toNumber(map.tax_percent, 5),
    codCharge: toNumber(map.cod_charge, 0),
    codAvailable: toBool(map.cod_available, true),
    minOrderValue: toNumber(map.min_order_value, 0),
  };
}

export default settings;
