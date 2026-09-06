// src/routes/payments.js
//
// Provider-agnostic payment scaffold. Wire up a real gateway (Razorpay,
// Stripe, etc.) by filling in the marked TODOs and adding the relevant
// secrets (e.g. RAZORPAY_KEY_SECRET) via `wrangler secret put`.
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId } from '../lib/utils.js';

const payments = new Hono();

// POST /api/payments/create-order
// Creates a local payment record tied to an existing order, ready to be
// handed off to a payment gateway's checkout flow on the frontend.
payments.post('/create-order', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { orderId, provider = 'razorpay' } = body;

    if (!orderId) return fail(c, 'orderId is required.', 400);

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();
    if (!order) return fail(c, 'Order not found.', 404);
    if (order.user_id !== user.id) return fail(c, 'You do not have access to this order.', 403);

    // TODO: call the real payment gateway API here to obtain a
    // provider-side payment/session id, e.g.:
    //   const gatewayResponse = await fetch('https://api.razorpay.com/v1/orders', { ... });
    // For now we generate a local placeholder reference.
    const paymentId = genId('pay');
    const providerPaymentId = `sandbox_${paymentId}`;

    await c.env.DB.prepare(
      `INSERT INTO payments (id, order_id, provider, provider_payment_id, amount, currency, status, created_at)
       VALUES (?, ?, ?, ?, ?, 'INR', 'created', datetime('now'))`
    )
      .bind(paymentId, orderId, provider, providerPaymentId, order.total_amount)
      .run();

    return ok(c, {
      paymentId,
      providerPaymentId,
      amount: order.total_amount,
      currency: 'INR',
      provider,
    }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create payment: ${err.message}`, 500);
  }
});

// POST /api/payments/verify
// Frontend calls this after the gateway checkout completes, passing back
// whatever signature/reference the gateway provided so we can confirm it.
payments.post('/verify', authMiddleware, async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { paymentId, providerPaymentId, signature } = body;

    if (!paymentId) return fail(c, 'paymentId is required.', 400);

    const payment = await c.env.DB.prepare('SELECT * FROM payments WHERE id = ?').bind(paymentId).first();
    if (!payment) return fail(c, 'Payment not found.', 404);

    // TODO: verify `signature` against the gateway's HMAC scheme using the
    // relevant webhook/API secret from c.env, e.g. c.env.RAZORPAY_KEY_SECRET.
    // Rejecting unverified payments here is critical in production.
    const verified = Boolean(providerPaymentId && signature);

    if (!verified) {
      await c.env.DB.prepare(`UPDATE payments SET status = 'failed' WHERE id = ?`).bind(paymentId).run();
      return fail(c, 'Payment verification failed.', 400);
    }

    await c.env.DB.prepare(
      `UPDATE payments SET status = 'success', provider_payment_id = ? WHERE id = ?`
    )
      .bind(providerPaymentId, paymentId)
      .run();

    await c.env.DB.prepare(
      `UPDATE orders SET payment_status = 'paid', status = 'confirmed', updated_at = datetime('now')
       WHERE id = ?`
    )
      .bind(payment.order_id)
      .run();

    return ok(c, { paymentId, verified: true });
  } catch (err) {
    return fail(c, `Failed to verify payment: ${err.message}`, 500);
  }
});

// POST /api/payments/webhook
// Public endpoint for the payment gateway's server-to-server webhook calls.
payments.post('/webhook', async (c) => {
  try {
    const rawBody = await c.req.text();

    // TODO: validate the webhook signature header against c.env secrets
    // before trusting `rawBody`, e.g. using the gateway's HMAC scheme.

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return fail(c, 'Invalid webhook payload.', 400);
    }

    await c.env.DB.prepare(
      `INSERT INTO webhook_events (id, provider, event_type, payload, created_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    )
      .bind(genId('evt'), event.provider || 'unknown', event.type || 'unknown', rawBody)
      .run();

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
