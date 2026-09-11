// src/routes/payments.js
//
// PhonePe Payment Gateway — Standard Checkout v2 (OAuth Token flow)
// Docs: https://developer.phonepe.com/v1/docs/standard-checkout/
//
// Required Secrets (Cloudflare Dashboard → Settings → Variables):
//   PHONEPE_CLIENT_ID      - Client ID from PhonePe Dashboard
//   PHONEPE_CLIENT_SECRET  - Client Secret from PhonePe Dashboard
//   PHONEPE_CLIENT_VERSION - Client Version (usually 1)
//   PHONEPE_ENV            - "sandbox" or "production"
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const payments = new Hono();

// ============================================================
// ✅ Environment URLs (PhonePe Docs ke hisaab se)
// ============================================================
function getBaseUrls(env) {
  const isProd = env.PHONEPE_ENV === 'production';
  return {
    // OAuth token ke liye
    authUrl: isProd
      ? 'https://api.phonepe.com/apis/identity-manager'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox',
    // Pay / Status / Refund ke liye
    apiUrl: isProd
      ? 'https://api.phonepe.com/apis/pg'
      : 'https://api-preprod.phonepe.com/apis/pg-sandbox',
  };
}

// ============================================================
// ✅ PhonePe OAuth Access Token
// ============================================================
async function getAccessToken(env) {
  const { authUrl } = getBaseUrls(env);

  const response = await fetch(`${authUrl}/v1/oauth/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: env.PHONEPE_CLIENT_ID,
      client_version: env.PHONEPE_CLIENT_VERSION || '1',
      client_secret: env.PHONEPE_CLIENT_SECRET,
      grant_type: 'client_credentials',
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok || !data.access_token) {
    throw new Error(
      `OAuth failed [${response.status}]: ${JSON.stringify(data)}`
    );
  }

  return data.access_token;
}

// ============================================================
// ✅ POST /api/payments/initiate — Payment create karo
// ============================================================
payments.post('/initiate', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { orderId } = body;

    if (!orderId) return fail(c, 'orderId is required.', 400);

    const order = await c.env.DB.prepare(
      'SELECT * FROM orders WHERE id = ?'
    )
      .bind(orderId)
      .first();

    if (!order) return fail(c, 'Order not found.', 404);
    if (order.user_id !== user.id)
      return fail(c, 'You do not have access to this order.', 403);

    // ✅ Step 1: OAuth token lo
    const accessToken = await getAccessToken(c.env);
    const { apiUrl } = getBaseUrls(c.env);

    // ✅ merchantOrderId unique rakho
    const merchantOrderId = `TXN_${Date.now()}_${Math.floor(
      Math.random() * 1000
    )}`;

    // ✅ Step 2: Payload banao (Standard Checkout v2 format)
    const payload = {
      merchantOrderId: merchantOrderId,
      amount: Math.round(order.total_amount * 100), // paise
      expireAfter: 1200, // 20 minutes
      metaInfo: {
        udf1: order.id,
        udf2: user.id,
      },
      paymentFlow: {
        type: 'PG_CHECKOUT',
        message: 'Payment for your order',
        merchantUrls: {
          redirectUrl: `${c.env.FRONTEND_URL}/payment-callback?txnId=${merchantOrderId}`,
        },
      },
    };

    // ✅ Step 3: PhonePe Create Payment API call (v2 endpoint)
    const phonePeResponse = await fetch(`${apiUrl}/checkout/v2/pay`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `O-Bearer ${accessToken}`,
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await phonePeResponse.json().catch(() => ({}));

    if (!phonePeResponse.ok || !data.redirectUrl) {
      return fail(c, `PhonePe Error: ${JSON.stringify(data)}`, 500);
    }

    // ✅ Save payment record
    const paymentId = genId('pay');
    await c.env.DB.prepare(
      `INSERT INTO payments (id, order_id, provider, provider_payment_id, amount, currency, status, created_at)
       VALUES (?, ?, 'phonepe', ?, ?, 'INR', 'created', datetime('now'))`
    )
      .bind(paymentId, orderId, merchantOrderId, order.total_amount)
      .run();

    // ✅ Redirect URL frontend ko bhejo
    return ok(
      c,
      {
        paymentId,
        merchantTransactionId: merchantOrderId,
        redirectUrl: data.redirectUrl,
        amount: order.total_amount,
      },
      undefined,
      201
    );
  } catch (err) {
    return fail(c, `Failed to initiate payment: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ POST /api/payments/verify — Payment status check
// ============================================================
payments.post('/verify', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { merchantTransactionId } = body;

    if (!merchantTransactionId)
      return fail(c, 'merchantTransactionId is required.', 400);

    // ✅ OAuth token lo
    const accessToken = await getAccessToken(c.env);
    const { apiUrl } = getBaseUrls(c.env);

    // ✅ Order Status API (v2 endpoint)
    const endpoint = `/checkout/v2/order/${merchantTransactionId}/status`;

    const phonePeResponse = await fetch(`${apiUrl}${endpoint}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `O-Bearer ${accessToken}`,
        accept: 'application/json',
      },
    });

    const data = await phonePeResponse.json().catch(() => ({}));

    // ✅ PhonePe v2 state: COMPLETED, FAILED, PENDING
    if (data.state === 'COMPLETED') {
      await c.env.DB.prepare(
        `UPDATE payments SET status = 'success' WHERE provider_payment_id = ?`
      )
        .bind(merchantTransactionId)
        .run();

      const payment = await c.env.DB.prepare(
        'SELECT * FROM payments WHERE provider_payment_id = ?'
      )
        .bind(merchantTransactionId)
        .first();

      if (payment) {
        await c.env.DB.prepare(
          `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now') WHERE id = ?`
        )
          .bind(payment.order_id)
          .run();
      }

      return ok(c, { verified: true, status: 'success' });
    } else if (data.state === 'FAILED') {
      await c.env.DB.prepare(
        `UPDATE payments SET status = 'failed' WHERE provider_payment_id = ?`
      )
        .bind(merchantTransactionId)
        .run();

      return ok(c, {
        verified: false,
        status: 'failed',
        phonepeState: data.state,
      });
    } else {
      return ok(c, {
        verified: false,
        status: 'pending',
        phonepeState: data.state || 'PENDING',
      });
    }
  } catch (err) {
    return fail(c, `Failed to verify payment: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ POST /api/payments/webhook
// ============================================================
payments.post('/webhook', async (c) => {
  try {
    const rawBody = await c.req.text();
    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return fail(c, 'Invalid webhook payload.', 400);
    }

    await c.env.DB.prepare(
      `INSERT INTO webhook_events (id, provider, event_type, payload, created_at)
       VALUES (?, 'phonepe', ?, ?, datetime('now'))`
    )
      .bind(genId('evt'), event.type || 'unknown', rawBody)
      .run();

    // ✅ v2 webhook: state field check karo
    const orderIdFromEvent =
      event.payload?.merchantOrderId ||
      event.payload?.merchantTransactionId;

    if (orderIdFromEvent && (event.type === 'PAYMENT_SUCCESS' || event.state === 'COMPLETED')) {
      await c.env.DB.prepare(
        `UPDATE payments SET status = 'success' WHERE provider_payment_id = ?`
      )
        .bind(orderIdFromEvent)
        .run();

      const payment = await c.env.DB.prepare(
        'SELECT * FROM payments WHERE provider_payment_id = ?'
      )
        .bind(orderIdFromEvent)
        .first();

      if (payment) {
        await c.env.DB.prepare(
          `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now') WHERE id = ?`
        )
          .bind(payment.order_id)
          .run();
      }
    }

    return ok(c, { received: true });
  } catch (err) {
    return fail(c, `Webhook processing failed: ${err.message}`, 500);
  }
});

// ============================================================
// ✅ GET /api/payments/:orderId (admin)
// ============================================================
payments.get('/:orderId', authMiddleware, requireAdmin, async (c) => {
  try {
    const orderId = c.req.param('orderId');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM payments WHERE order_id = ?'
    )
      .bind(orderId)
      .all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load payments: ${err.message}`, 500);
  }
});

export default payments;
