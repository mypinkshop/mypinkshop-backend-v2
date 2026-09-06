// src/routes/shipping.js
import { Hono } from 'hono';
import { ok, fail } from '../lib/utils.js';

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
        pincode: '110001',
        city: 'New Delhi',
        state: 'Delhi'
      }
    });
  } catch (err) {
    return fail(c, `Failed to load shipping settings: ${err.message}`, 500);
  }
});

// ✅ POST /api/shipping/check-delivery - Check delivery availability
shipping.post('/check-delivery', async (c) => {
  try {
    const { pincode, cartTotal, isExpress } = await c.req.json().catch(() => ({}));
    if (!pincode) return fail(c, 'Pincode is required.', 400);
    
    // Calculate shipping charges
    let shippingCharge = 0;
    let shippingType = 'standard';
    
    const freeShippingThreshold = 499;
    const standardRate = 49;
    const expressRate = 99;
    
    if (cartTotal >= freeShippingThreshold) {
      shippingCharge = 0;
    } else if (isExpress) {
      shippingCharge = expressRate;
      shippingType = 'express';
    } else {
      shippingCharge = standardRate;
    }
    
    // Calculate estimated delivery
    const today = new Date();
    const deliveryDate = new Date(today);
    deliveryDate.setDate(today.getDate() + 3);
    
    return ok(c, {
      deliverable: true,
      shippingCharge,
      shippingType,
      estimatedDelivery: {
        minDate: today.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        maxDate: deliveryDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        minDays: 2,
        maxDays: 4
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
    
    return ok(c, {
      courier_name: 'Standard',
      estimated_days: 3,
      rates: 49
    });
  } catch (err) {
    return fail(c, `Failed to get shipping rates: ${err.message}`, 500);
  }
});

// ✅ GET /api/shipping/tracking/:orderId - Get tracking details
shipping.get('/tracking/:orderId', async (c) => {
  try {
    const orderId = c.req.param('orderId');
    return ok(c, {
      status: 'pending',
      message: 'Tracking information will be available soon',
      orderId
    });
  } catch (err) {
    return fail(c, `Failed to get tracking details: ${err.message}`, 500);
  }
});

export default shipping;
