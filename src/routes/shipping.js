// src/routes/shipping.js
import { Hono } from 'hono';
import { ok, fail } from '../lib/utils.js';

const SHIPROCKET_BASE_URL = 'https://apiv2.shiprocket.in/v1/external';

// Helper: Get Shiprocket Auth Token with caching or direct fetch
async function getShiprocketToken(env) {
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
    return data.token || null;
  } catch (error) {
    console.error('Shiprocket Auth Error:', error);
    return null;
  }
}

const shipping = new Hono();

// ✅ GET /api/shipping/settings - Shipping settings for Checkout page
shipping.get('/settings', async (c) => {
  try {
    return ok(c, {
      freeShippingThreshold: 499,
      standardRate: 49,
      expressRate: 99,
      codFee: 20,
      deliveryDays: 3,
      defaultDays: [3, 7],
      expressDays: [1, 3],
      shippingCharges: 50,
      expressCharges: 99,
      codCharges: 30,
      cutOffTime: '16:00',
      sundayDelivery: false,
      deliverablePincodes: [],
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

// ✅ POST /api/shipping/check-delivery - Real-time Shiprocket Serviceability Check
shipping.post('/check-delivery', async (c) => {
  try {
    const { pincode, cartTotal = 0, isExpress } = await c.req.json().catch(() => ({}));
    if (!pincode) return fail(c, 'Pincode is required.', 400);
    
    const freeShippingThreshold = 499;
    const standardRate = 49;
    const expressRate = 99;

    const pickupPincode = c.env?.PICKUP_PINCODE || '400072';
    const token = await getShiprocketToken(c.env);

    let shippingCharge = cartTotal >= freeShippingThreshold ? 0 : (isExpress ? expressRate : standardRate);
    let shippingType = isExpress ? 'express' : 'standard';
    let estimatedDaysMin = 2;
    let estimatedDaysMax = 5;
    let deliverable = true;

    if (token) {
      try {
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
        
        if (srData.status === 200 && srData.data?.available_courier_companies?.length > 0) {
          deliverable = true;
          const couriers = srData.data.available_courier_companies;
          
          // Find the courier with real dynamic delivery days (or fallback to first)
          let bestCourier = couriers[0];
          for (const courier of couriers) {
            if (courier.estimated_delivery_days && parseInt(courier.estimated_delivery_days, 10) > 0) {
              bestCourier = courier;
              break;
            }
          }
          
          if (cartTotal < freeShippingThreshold) {
            shippingCharge = bestCourier.rate || standardRate;
          }
          
          if (bestCourier.estimated_delivery_days) {
            const parsedDays = parseInt(bestCourier.estimated_delivery_days, 10) || 3;
            // Dynamic calculation based on actual distance/days returned by Shiprocket
            estimatedDaysMin = Math.max(2, parsedDays - 1);
            estimatedDaysMax = parsedDays + 2;
          }
        } else {
          deliverable = false;
        }
      } catch (srErr) {
        console.error('Shiprocket API fallback to default:', srErr);
        deliverable = true;
      }
    }

    if (!deliverable) {
      return ok(c, {
        deliverable: false,
        error: 'Delivery not available at this pincode'
      });
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
      freeShippingThreshold: freeShippingThreshold,
      cutOffTime: '16:00'
    });
  } catch (err) {
    return fail(c, `Failed to check delivery: ${err.message}`, 500);
  }
});

// ✅ POST /api/shipping/shipping-rates - Get shipping rates
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
      if (srData.status === 200 && srData.data?.available_courier_companies?.length > 0) {
        const courier = srData.data.available_courier_companies[0];
        return ok(c, {
          courier_name: courier.courier_name || 'Standard',
          estimated_days: parseInt(courier.estimated_days || courier.estimated_delivery_days) || 3,
          rates: courier.rate || 49
        });
      }
    }

    return ok(c, {
      courier_name: 'Standard',
      estimated_days: 3,
      rates: 49
    });
  } catch (err) {
    return fail(c, `Failed to get shipping rates: ${err.message}`, 500);
  }
});

// ✅ GET /api/shipping/tracking/:orderId - Live Shiprocket Tracking API (Step 11)
shipping.get('/tracking/:orderId', async (c) => {
  try {
    const orderId = c.req.param('orderId');
    const token = await getShiprocketToken(c.env);

    if (!token) {
      return ok(c, {
        success: false,
        status: 'pending',
        message: 'Tracking info unavailable (Auth missing)',
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
