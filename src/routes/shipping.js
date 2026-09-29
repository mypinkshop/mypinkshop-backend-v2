// src/routes/shipping.js
import { Hono } from 'hono';
import { ok, fail } from '../lib/utils.js';
import { getShippingConfig } from './settings.js';

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

/* --------------------------------------------------------------------- */
/* Shiprocket token cache (D1-backed, ~9 days)                            */
/* --------------------------------------------------------------------- */
const TOKEN_TTL_DAYS = 9;

async function getCachedToken(db) {
  try {
    const row = await db.prepare('SELECT token, expires_at FROM shiprocket_auth WHERE id = 1').first();
    if (row && new Date(row.expires_at) > new Date()) {
      return row.token;
    }
  } catch (err) {
    console.error('Failed to read cached Shiprocket token:', err);
  }
  return null;
}

async function cacheToken(db, token) {
  try {
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    await db.prepare(
      `INSERT INTO shiprocket_auth (id, token, expires_at) VALUES (1, ?, ?)
       ON CONFLICT(id) DO UPDATE SET token = excluded.token, expires_at = excluded.expires_at`
    ).bind(token, expiresAt).run();
  } catch (err) {
    console.error('Failed to cache Shiprocket token:', err);
  }
}

async function getShiprocketToken(env) {
  const db = env?.DB;
  if (db) {
    const cached = await getCachedToken(db);
    if (cached) return cached;
  }

  try {
    const email = env?.SHIPROCKET_EMAIL;
    const password = env?.SHIPROCKET_PASSWORD;
    if (!email || !password) {
      console.warn('Shiprocket credentials missing in environment variables.');
      return null;
    }

    const response = await fetch(`${SHIPROCKET_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    const data = await response.json();
    const token = data.token || null;
    if (token && db) await cacheToken(db, token);
    return token;
  } catch (error) {
    console.error('Shiprocket Auth Error:', error);
    return null;
  }
}

const shipping = new Hono();

/* --------------------------------------------------------------------- */
/* GET /api/shipping/settings — now pulls from settings table             */
/* --------------------------------------------------------------------- */
shipping.get('/settings', async (c) => {
  try {
    const config = await getShippingConfig(c.env.DB);
    return ok(c, {
      freeShippingThreshold: config.freeShippingThreshold,
      standardRate: config.shippingCharge,
      expressRate: config.expressShippingCharge,
      codFee: config.codCharge,
      codAvailable: config.codAvailable,
      taxPercent: config.taxPercent,
      minOrderValue: config.minOrderValue,
      deliveryDays: config.deliveryDaysMax,
      deliveryDaysMin: config.deliveryDaysMin,
      cutOffTime: config.cutOffTime,
      freeShippingEnabled: config.freeShippingEnabled,
      warehouseAddress: {
        pincode: config.warehousePincode,
        city: config.warehouseCity,
        state: config.warehouseState,
      },
    });
  } catch (err) {
    return fail(c, `Failed to load shipping settings: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* POST /api/shipping/check-delivery — uses settings table                */
/* --------------------------------------------------------------------- */
shipping.post('/check-delivery', async (c) => {
  try {
    const { pincode, cartTotal = 0, isExpress } = await c.req.json().catch(() => ({}));

    if (!pincode || pincode.length !== 6 || /^(\d)\1{5}$/.test(pincode)) {
      return ok(c, {
        deliverable: false,
        message: '❌ Sorry, delivery is not available to this pincode.',
      });
    }

    const config = await getShippingConfig(c.env.DB);
    const freeShippingThreshold = config.freeShippingEnabled ? config.freeShippingThreshold : Infinity;
    const standardRate = config.shippingCharge;
    const expressRate = config.expressShippingCharge;

    const pickupPincode = config.warehousePincode;
    const token = await getShiprocketToken(c.env);

    if (!token) {
      // Fallback — Shiprocket down / unconfigured
      const shippingCharge = cartTotal >= freeShippingThreshold
        ? 0
        : (isExpress ? expressRate : standardRate);
      return ok(c, {
        deliverable: true,
        shippingCharge,
        shippingType: isExpress ? 'express' : 'standard',
        estimatedDelivery: null,
        freeShippingThreshold: config.freeShippingThreshold,
        cutOffTime: config.cutOffTime,
        fallback: true,
      });
    }

    const weight = 0.5;
    const cod = 1;
    const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${pincode}&weight=${weight}&cod=${cod}`;

    const srRes = await fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const srData = await srRes.json();

    if (srData.data?.available_courier_companies?.length > 0) {
      const couriers = srData.data.available_courier_companies;
      let bestCourier = couriers[0];
      for (const courier of couriers) {
        if (courier.estimated_delivery_days) {
          bestCourier = courier;
          break;
        }
      }

      const shippingCharge = cartTotal >= freeShippingThreshold
        ? 0
        : (isExpress ? expressRate : (bestCourier.rate || standardRate));
      const shippingType = isExpress ? 'express' : 'standard';

      let estimatedDaysMin = config.deliveryDaysMin;
      let estimatedDaysMax = config.deliveryDaysMax;

      const rawDays = String(bestCourier.estimated_delivery_days || '');
      const matches = rawDays.match(/\d+/g);
      if (matches && matches.length > 0) {
        const minParsed = parseInt(matches[0], 10);
        const maxParsed = matches.length > 1 ? parseInt(matches[1], 10) : minParsed + 2;
        estimatedDaysMin = Math.max(1, minParsed);
        estimatedDaysMax = Math.max(estimatedDaysMin + 1, maxParsed);
      }

      const today = new Date();
      const minDate = new Date(today);
      minDate.setDate(today.getDate() + estimatedDaysMin);
      const maxDate = new Date(today);
      maxDate.setDate(today.getDate() + estimatedDaysMax);

      return ok(c, {
        deliverable: true,
        shippingCharge,
        shippingType,
        estimatedDelivery: {
          minDate: minDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          maxDate: maxDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
          minDays: estimatedDaysMin,
          maxDays: estimatedDaysMax,
        },
        freeShippingThreshold: config.freeShippingThreshold,
        cutOffTime: config.cutOffTime,
      });
    } else {
      return ok(c, {
        deliverable: false,
        message: '❌ Sorry, delivery is not available to this pincode.',
      });
    }
  } catch (err) {
    console.error('check-delivery error:', err);
    return ok(c, {
      deliverable: false,
      message: '❌ Unable to verify delivery for this pincode right now.',
    });
  }
});

/* --------------------------------------------------------------------- */
/* POST /api/shipping/shipping-rates                                      */
/* --------------------------------------------------------------------- */
shipping.post('/shipping-rates', async (c) => {
  try {
    const { pickupPincode, deliveryPincode, weight = 0.5 } = await c.req.json().catch(() => ({}));
    if (!pickupPincode || !deliveryPincode) {
      return fail(c, 'Pickup and delivery pincodes are required.', 400);
    }

    const config = await getShippingConfig(c.env.DB);
    const token = await getShiprocketToken(c.env);

    if (token) {
      const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=1`;
      const srRes = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
      const srData = await srRes.json();
      if (srData.data?.available_courier_companies?.length > 0) {
        const courier = srData.data.available_courier_companies[0];
        return ok(c, {
          courier_name: courier.courier_name || 'Standard',
          estimated_days: parseInt(courier.estimated_days || courier.estimated_delivery_days) || config.deliveryDaysMin,
          rates: courier.rate || config.shippingCharge,
        });
      }
    }

    return fail(c, 'Shipping rates unavailable', 400);
  } catch (err) {
    return fail(c, `Failed to get shipping rates: ${err.message}`, 500);
  }
});

/* --------------------------------------------------------------------- */
/* GET /api/shipping/tracking/:orderId                                    */
/* --------------------------------------------------------------------- */
shipping.get('/tracking/:orderId', async (c) => {
  try {
    const orderId = c.req.param('orderId');
    const token = await getShiprocketToken(c.env);

    if (!token) {
      return ok(c, {
        success: false,
        status: 'pending',
        message: 'Tracking info unavailable',
        orderId,
      });
    }

    const srRes = await fetch(`${SHIPROCKET_BASE_URL}/courier/track/order/${orderId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    const srData = await srRes.json();

    if (srRes.ok && srData) {
      return ok(c, { success: true, orderId, trackingData: srData });
    } else {
      return ok(c, {
        success: true,
        status: 'Processing',
        message: 'Order is confirmed and being prepared for dispatch.',
        orderId,
      });
    }
  } catch (err) {
    return fail(c, `Failed to get tracking details: ${err.message}`, 500);
  }
});

export default shipping;
