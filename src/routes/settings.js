// src/routes/settings.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail } from '../lib/utils.js';

const settings = new Hono();

const DEFAULTS = {
  free_shipping_threshold: 499,
  shipping_charge: 49,
  express_shipping_charge: 99,
  tax_percent: 5,
  cod_charge: 0,
  cod_available: true,
  min_order_value: 0,
  delivery_days_min: 3,
  delivery_days_max: 5,
  cut_off_time: '16:00',
  warehouse_pincode: '400072',
  warehouse_city: 'Mumbai',
  warehouse_state: 'Maharashtra',
  free_shipping_enabled: true,
  express_shipping_enabled: true,
  payment_methods: 'cod,upi,card,netbanking',
};

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

function toNumber(val, fallback = 0) {
  if (val === undefined || val === null || val === '') return fallback;
  const n = parseFloat(val);
  return Number.isFinite(n) ? n : fallback;
}

function toBool(val, fallback = false) {
  if (val === undefined || val === null) return fallback;
  if (val === true || val === 'true' || val === '1' || val === 1) return true;
  if (val === false || val === 'false' || val === '0' || val === 0) return false;
  return fallback;
}

export function buildShippingConfig(map) {
  return {
    freeShippingThreshold: toNumber(map.free_shipping_threshold, DEFAULTS.free_shipping_threshold),
    shippingCharge: toNumber(map.shipping_charge, DEFAULTS.shipping_charge),
    expressShippingCharge: toNumber(map.express_shipping_charge, DEFAULTS.express_shipping_charge),
    taxPercent: toNumber(map.tax_percent, DEFAULTS.tax_percent),
    codCharge: toNumber(map.cod_charge, DEFAULTS.cod_charge),
    codAvailable: toBool(map.cod_available, DEFAULTS.cod_available),
    minOrderValue: toNumber(map.min_order_value, DEFAULTS.min_order_value),
    deliveryDaysMin: toNumber(map.delivery_days_min, DEFAULTS.delivery_days_min),
    deliveryDaysMax: toNumber(map.delivery_days_max, DEFAULTS.delivery_days_max),
    cutOffTime: map.cut_off_time || DEFAULTS.cut_off_time,
    warehousePincode: map.warehouse_pincode || DEFAULTS.warehouse_pincode,
    warehouseCity: map.warehouse_city || DEFAULTS.warehouse_city,
    warehouseState: map.warehouse_state || DEFAULTS.warehouse_state,
    freeShippingEnabled: toBool(map.free_shipping_enabled, DEFAULTS.free_shipping_enabled),
    expressShippingEnabled: toBool(map.express_shipping_enabled, DEFAULTS.express_shipping_enabled),
    paymentMethods: (map.payment_methods || DEFAULTS.payment_methods)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

/* PUBLIC — GET /api/settings/public */
settings.get('/public', async (c) => {
  try {
    const map = await getAllSettings(c.env.DB);
    const config = buildShippingConfig(map);
    return ok(c, config);
  } catch (err) {
    return fail(c, `Failed to load public settings: ${err.message}`, 500);
  }
});

/* ADMIN — GET /api/settings/admin */
settings.get('/admin', authMiddleware, requireAdmin, async (c) => {
  try {
    const map = await getAllSettings(c.env.DB);
    const config = buildShippingConfig(map);
    return ok(c, {
      ...DEFAULTS,
      ...map,
      parsed: config,
    });
  } catch (err) {
    return fail(c, `Failed to load settings: ${err.message}`, 500);
  }
});

/* ADMIN — PUT /api/settings/admin */
settings.put('/admin', authMiddleware, requireAdmin, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));

    const keyMap = {
      freeShippingThreshold: 'free_shipping_threshold',
      shippingCharge: 'shipping_charge',
      expressShippingCharge: 'express_shipping_charge',
      taxPercent: 'tax_percent',
      codCharge: 'cod_charge',
      codAvailable: 'cod_available',
      minOrderValue: 'min_order_value',
      deliveryDaysMin: 'delivery_days_min',
      deliveryDaysMax: 'delivery_days_max',
      cutOffTime: 'cut_off_time',
      warehousePincode: 'warehouse_pincode',
      warehouseCity: 'warehouse_city',
      warehouseState: 'warehouse_state',
      freeShippingEnabled: 'free_shipping_enabled',
      expressShippingEnabled: 'express_shipping_enabled',
      paymentMethods: 'payment_methods',
    };

    const updates = [];

    for (const [frontendKey, dbKey] of Object.entries(keyMap)) {
      if (body[frontendKey] !== undefined) {
        let val;
        if (typeof body[frontendKey] === 'boolean') {
          val = body[frontendKey] ? 'true' : 'false';
        } else if (Array.isArray(body[frontendKey])) {
          val = body[frontendKey].join(',');
        } else {
          val = String(body[frontendKey]);
        }
        updates.push({ key: dbKey, value: val });
      }
    }

    if (updates.length === 0) {
      return fail(c, 'No valid settings to update', 400);
    }

    for (const { key, value } of updates) {
      await c.env.DB.prepare(
        `INSERT OR REPLACE INTO settings (key, value, updated_at)
         VALUES (?, ?, datetime('now'))`
      ).bind(key, value).run();
    }

    const map = await getAllSettings(c.env.DB);
    const config = buildShippingConfig(map);

    return ok(c, {
      ...DEFAULTS,
      ...map,
      parsed: config,
    });
  } catch (err) {
    console.error('Update settings error:', err);
    return fail(c, `Failed to update settings: ${err.message}`, 500);
  }
});

/* HELPER */
export async function getShippingConfig(db) {
  const map = await getAllSettings(db);
  return buildShippingConfig(map);
}

export default settings;
