// src/routes/shipping.js
import { Hono } from 'hono';
import { ok, fail } from '../lib/utils.js';

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

// Shiprocket tokens are valid for ~10 days. We cache the token in D1 (one
// row) and only re-authenticate with email+password when the cached token
// is missing or close to expiry — repeatedly logging in on every request
// risks tripping Shiprocket's "too many failed attempts" account lock.
const TOKEN_TTL_DAYS = 9; // stay a day under Shiprocket's ~10-day expiry

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

// Helper: Get Shiprocket Auth Token (cached in D1, refreshed only when needed)
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

    if (token && db) {
      await cacheToken(db, token);
    }

    return token;
  } catch (error) {
    console.error('Shiprocket Auth Error:', error);
    return null;
  }
}

const shipping = new Hono();

// ✅ GET /api/shipping/settings
shipping.get('/settings', async (c) => {
  try {
    return ok(c, {
      freeShippingThreshold: 499,
      standardRate: 49,
      expressRate: 99,
      codFee: 20,
      deliveryDays: 3,
      cutOffTime: '16:00',
      warehouseAddress: {
        pincode: c.env?.PICKUP_PINCODE || '400072',
        city: 'Mumbai',
        state: 'Maharashtra'
      }
    });
  } catch (err) {
    return fail(c, `Failed to load shipping settings: ${err.message}`, 500);
  }
});

// ✅ POST /api/shipping/check-delivery - Real-time Shiprocket Serviceability (Relaxed Check)
shipping.post('/check-delivery', async (c) => {
  try {
    const { pincode, cartTotal = 0, isExpress } = await c.req.json().catch(() => ({}));
    
    // Strict Pincode Validation: 6 digits hone chahiye aur saare zero nahi hone chahiye
    if (!pincode || pincode.length !== 6 || /^(\d)\1{5}$/.test(pincode)) {
      return ok(c, {
        deliverable: false,
        message: '❌ Sorry, delivery is not available to this pincode.'
      });
    }
    
    const freeShippingThreshold = 499;
    const standardRate = 49;
    const expressRate = 99;

    const pickupPincode = c.env?.PICKUP_PINCODE || '400072';
    const token = await getShiprocketToken(c.env);

    if (!token) {
      // ✅ FIX: fall back to standard rates instead of a hard 500, so the
      // cart page stays usable even if Shiprocket is down/unconfigured.
      const shippingCharge = cartTotal >= freeShippingThreshold ? 0 : (isExpress ? expressRate : standardRate);
      return ok(c, {
        deliverable: true,
        shippingCharge,
        shippingType: isExpress ? 'express' : 'standard',
        estimatedDelivery: null,
        freeShippingThreshold,
        cutOffTime: '16:00',
        fallback: true,
      });
    }

    const weight = 0.5;
    const cod = 1;
    const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${pincode}&weight=${weight}&cod=${cod}`;

    const srRes = await fetch(url, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    const srData = await srRes.json();
    
    // ✅ Relaxed & Correct Check: Agar available couriers ki list milti hai toh deliverable true karo
    if (srData.data?.available_courier_companies && srData.data.available_courier_companies.length > 0) {
      const couriers = srData.data.available_courier_companies;
      
      let bestCourier = couriers[0];
      for (const courier of couriers) {
        if (courier.estimated_delivery_days) {
          bestCourier = courier;
          break;
        }
      }

      let shippingCharge = cartTotal >= freeShippingThreshold ? 0 : (isExpress ? expressRate : (bestCourier.rate || standardRate));
      let shippingType = isExpress ? 'express' : 'standard';
      
      let estimatedDaysMin = 2;
      let estimatedDaysMax = 5;

      const rawDays = String(bestCourier.estimated_delivery_days || '3');
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
          maxDays: estimatedDaysMax
        },
        freeShippingThreshold,
        cutOffTime: '16:00'
      });
    } else {
      // Agar Shiprocket ke mutabiq pin code serviceable nahi hai
      return ok(c, {
        deliverable: false,
        message: '❌ Sorry, delivery is not available to this pincode.'
      });
    }
  } catch (err) {
    return ok(c, {
      deliverable: false,
      message: '❌ Unable to verify delivery for this pincode right now.'
    });
  }
});

// ✅ POST /api/shipping/shipping-rates
shipping.post('/shipping-rates', async (c) => {
  try {
    const { pickupPincode, deliveryPincode, weight = 0.5 } = await c.req.json().catch(() => ({}));
    if (!pickupPincode || !deliveryPincode) return fail(c, 'Pickup and delivery pincodes are required.', 400);
    
    const token = await getShiprocketToken(c.env);
    if (token) {
      const url = `${SHIPROCKET_BASE_URL}/courier/serviceability/?pickup_postcode=${pickupPincode}&delivery_postcode=${deliveryPincode}&weight=${weight}&cod=1`;
      const srRes = await fetch(url, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const srData = await srRes.json();
      if (srData.data?.available_courier_companies?.length > 0) {
        const courier = srData.data.available_courier_companies[0];
        return ok(c, {
          courier_name: courier.courier_name || 'Standard',
          estimated_days: parseInt(courier.estimated_days || courier.estimated_delivery_days) || 3,
          rates: courier.rate || 49
        });
      }
    }

    return fail(c, 'Shipping rates unavailable', 400);
  } catch (err) {
    return fail(c, `Failed to get shipping rates: ${err.message}`, 500);
  }
});

// ✅ GET /api/shipping/tracking/:orderId - Live Tracking API (Step 11)
shipping.get('/tracking/:orderId', async (c) => {
  try {
    const orderId = c.req.param('orderId');
    const token = await getShiprocketToken(c.env);

    if (!token) {
      return ok(c, {
        success: false,
        status: 'pending',
        message: 'Tracking info unavailable',
        orderId
      });
    }

    const srRes = await fetch(`${SHIPROCKET_BASE_URL}/courier/track/order/${orderId}`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${token}` }
    });

    const srData = await srRes.json();

    if (srRes.ok && srData) {
      return ok(c, {
        success: true,
        orderId,
        trackingData: srData
      });
    } else {
      return ok(c, {
        success: true,
        status: 'Processing',
        message: 'Order is confirmed and being prepared for dispatch.',
        orderId
      });
    }
  } catch (err) {
    return fail(c, `Failed to get tracking details: ${err.message}`, 500);
  }
});

export default shipping;
