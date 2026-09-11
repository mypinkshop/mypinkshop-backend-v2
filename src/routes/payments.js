// src/routes/payments.js
//
// PhonePe Payment Gateway Integration (Standard Checkout v2)
// Docs: https://developer.phonepe.com/v1/docs/standard-checkout/
//
// Required Secrets (wrangler secret put <NAME>):
//   PHONEPE_CLIENT_ID      - Client ID from PhonePe Dashboard
//   PHONEPE_CLIENT_SECRET  - Client Secret from PhonePe Dashboard
//   PHONEPE_CLIENT_VERSION - Client Version (usually 1)
//   PHONEPE_ENV            - "sandbox" or "production"
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const payments = new Hono();

// ✅ SHA-256 Helper (Cloudflare Workers Web Crypto)
async function sha256Hex(str) {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// ✅ Generate PhonePe X-VERIFY Checksum (Client Secret based)
async function generateChecksum(payloadBase64, endpoint, clientSecret, clientVersion) {
  const stringToHash = payloadBase64 + endpoint + clientSecret;
  const hash = await sha256Hex(stringToHash);
  return `${hash}###${clientVersion}`;
}

// ✅ POST /api/payments/initiate - Create PhonePe payment session
payments.post('/initiate', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { orderId } = body;

    if (!orderId) return fail(c, 'orderId is required.', 400);

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (!order) return fail(c, 'Order not found.', 404);
    if (order.user_id !== user.id) return fail(c, 'You do not have access to this order.', 403);

    // ✅ Naye credentials use karo
    const { PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION, PHONEPE_ENV } = c.env;
    
    // PhonePe API URL (Sandbox vs Production)
    const baseUrl = PHONEPE_ENV === 'production' 
      ? 'https://api.phonepe.com/apis/hermes' 
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

    // ✅ Prepare Payload
    const merchantTransactionId = `TXN_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const payload = {
      merchantId: PHONEPE_CLIENT_ID, // ✅ Client ID use karo
      merchantTransactionId: merchantTransactionId,
      merchantUserId: user.id,
      amount: Math.round(order.total_amount * 100), // Convert to paise
      redirectUrl: `${c.env.FRONTEND_URL}/payment-callback?txnId=${merchantTransactionId}`,
      redirectMode: 'REDIRECT',
      callbackUrl: `${c.env.FRONTEND_URL}/api/payments/webhook`,
      mobileNumber: '',
      paymentInstrument: {
        type: 'PAY_PAGE'
      }
    };

    const payloadBase64 = btoa(JSON.stringify(payload));
    const endpoint = '/pg/v1/pay';
    // ✅ Naya checksum function use karo
    const checksum = await generateChecksum(payloadBase64, endpoint, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION);

    // ✅ Call PhonePe API
    const phonePeResponse = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
        'accept': 'application/json'
      },
      body: JSON.stringify({
        request: payloadBase64
      })
    });

    const data = await phonePeResponse.json();

    if (!phonePeResponse.ok || !data.success) {
      return fail(c, `PhonePe Error: ${JSON.stringify(data)}`, 500);
    }

    // ✅ Save payment record in DB
    const paymentId = genId('pay');
    await c.env.DB.prepare(
      `INSERT INTO payments (id, order_id, provider, provider_payment_id, amount, currency, status, created_at)
       VALUES (?, ?, 'phonepe', ?, ?, 'INR', 'created', datetime('now'))`
    )
      .bind(paymentId, orderId, merchantTransactionId, order.total_amount)
      .run();

    // ✅ Return the redirect URL to frontend
    return ok(c, {
      paymentId,
      merchantTransactionId,
      redirectUrl: data.data.instrumentResponse.redirectInfo.url,
      amount: order.total_amount
    }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to initiate payment: ${err.message}`, 500);
  }
});

// ✅ POST /api/payments/verify - Verify payment status
payments.post('/verify', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { merchantTransactionId } = body;

    if (!merchantTransactionId) return fail(c, 'merchantTransactionId is required.', 400);

    // ✅ Naye credentials use karo
    const { PHONEPE_CLIENT_ID, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION, PHONEPE_ENV } = c.env;
    
    const baseUrl = PHONEPE_ENV === 'production' 
      ? 'https://api.phonepe.com/apis/hermes' 
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox';

    const endpoint = `/pg/v1/status/${PHONEPE_CLIENT_ID}/${merchantTransactionId}`;
    // ✅ Naya checksum function use karo
    const checksum = await generateChecksum('', endpoint, PHONEPE_CLIENT_SECRET, PHONEPE_CLIENT_VERSION);

    const phonePeResponse = await fetch(`${baseUrl}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-VERIFY': checksum,
        'X-MERCHANT-ID': PHONEPE_CLIENT_ID,
        'accept': 'application/json'
      }
    });

    const data = await phonePeResponse.json();

    // ✅ Update payment record
    if (data.success && data.code === 'PAYMENT_SUCCESS') {
      await c.env.DB.prepare(
        `UPDATE payments SET status = 'success' WHERE provider_payment_id = ?`
      ).bind(merchantTransactionId).run();

      // ✅ Update order status
      const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE provider_payment_id = ?').bind(merchantTransactionId).first();
      if (payment) {
        await c.env.DB.prepare(
          `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now') WHERE id = ?`
        ).bind(payment.order_id).run();
      }

      return ok(c, { verified: true, status: 'success' });
    } else {
      await c.env.DB.prepare(
        `UPDATE payments SET status = 'failed' WHERE provider_payment_id = ?`
      ).bind(merchantTransactionId).run();
      return ok(c, { verified: false, status: 'failed' });
    }
  } catch (err) {
    return fail(c, `Failed to verify payment: ${err.message}`, 500);
  }
});

// ✅ POST /api/payments/webhook - PhonePe Webhook
payments.post('/webhook', async (c) => {
  try {
    const rawBody = await c.req.text();
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return fail(c, 'Invalid webhook payload.', 400);
    }

    // Save webhook event
    await c.env.DB.prepare(
      `INSERT INTO webhook_events (id, provider, event_type, payload, created_at)
       VALUES (?, 'phonepe', ?, ?, datetime('now'))`
    )
      .bind(genId('evt'), event.type || 'unknown', rawBody)
      .run();

    // Update payment if webhook gives success
    if (event.type === 'PAYMENT_SUCCESS' && event.payload?.merchantTransactionId) {
      await c.env.DB.prepare(
        `UPDATE payments SET status = 'success' WHERE provider_payment_id = ?`
      ).bind(event.payload.merchantTransactionId).run();

      const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE provider_payment_id = ?').bind(event.payload.merchantTransactionId).first();
      if (payment) {
        await c.env.DB.prepare(
          `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now') WHERE id = ?`
        ).bind(payment.order_id).run();
      }
    }

    return ok(c, { received: true });
  } catch (err) {
    return fail(c, `Webhook processing failed: ${err.message}`, 500);
  }
});

// GET /api/payments/:orderId (admin) - inspect payment records for an order
payments.get('/:orderId', authMiddleware, requireAdmin, async (c) => {
  try {
    const orderId = c.req.param('orderId');
    const { results } = await c.env.DB.prepare('SELECT * FROM payments WHERE order_id = ?')
      .bind(orderId)
      .all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load payments: ${err.message}`, 500);
  }
});

export default payments;
