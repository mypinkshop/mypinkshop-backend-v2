import { Hono } from 'hono';

const adminPayments = new Hono();

// Helper for unique ID
const generateId = (prefix) => prefix + '_' + Math.random().toString(36).substring(2, 15);

// 1. GET Payment Requests
adminPayments.get('/payment-requests', async (c) => {
  try {
    const db = c.env.DB;
    const { results } = await db.prepare("SELECT * FROM payment_requests ORDER BY created_at DESC").all();
    return c.json(results || []);
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// 2. GET Transaction History
adminPayments.get('/transaction-history', async (c) => {
  try {
    const db = c.env.DB;
    const { results } = await db.prepare("SELECT * FROM transaction_history ORDER BY created_at DESC").all();
    return c.json(results || []);
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// 3. Approve Payment Request
adminPayments.patch('/payment-requests/:id/approve', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');
    await db.prepare("UPDATE payment_requests SET status = 'approved' WHERE id = ?").bind(id).run();
    return c.json({ success: true, message: 'Payment approved' });
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// 4. Reject Payment Request
adminPayments.patch('/payment-requests/:id/reject', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');
    await db.prepare("UPDATE payment_requests SET status = 'rejected' WHERE id = ?").bind(id).run();
    return c.json({ success: true, message: 'Payment rejected' });
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

// 5. Mark as Paid (Moves to Transaction History)
adminPayments.patch('/payment-requests/:id/paid', async (c) => {
  try {
    const db = c.env.DB;
    const id = c.req.param('id');
    
    // Get request details first
    const reqItem = await db.prepare("SELECT * FROM payment_requests WHERE id = ?").bind(id).first();
    if (!reqItem) {
      return c.json({ success: false, message: 'Request not found' }, 404);
    }

    // Update status to paid
    await db.prepare("UPDATE payment_requests SET status = 'paid' WHERE id = ?").bind(id).run();

    // Insert into transaction history
    const txId = generateId('tx');
    await db.prepare(
      `INSERT INTO transaction_history (id, vendor_id, vendor_name, amount, commission, net_payable, status) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      txId, 
      reqItem.vendor_id, 
      reqItem.vendor_name, 
      reqItem.amount, 
      reqItem.commission, 
      reqItem.net_payable, 
      'paid'
    ).run();

    return c.json({ success: true, message: 'Marked as paid successfully' });
  } catch (error) {
    return c.json({ success: false, message: error.message }, 500);
  }
});

export default adminPayments;
