// src/routes/orders.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail, genId, genOrderNumber, parsePagination } from '../lib/utils.js';

const orders = new Hono();

const VALID_STATUSES = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded'];

/* --------------------------------------------------------------------- */
/* Customer                                                               */
/* --------------------------------------------------------------------- */

// ✅ POST /api/orders - Create new order (Frontend Checkout.js isko hit karta hai)
orders.post('/', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    
    // Validation
    if (!body.items || !Array.isArray(body.items) || body.items.length === 0) {
      return fail(c, 'items must be a non-empty array.', 400);
    }
    if (!body.address) {
      return fail(c, 'address is required.', 400);
    }

    const id = genId('order');
    const orderNumber = genOrderNumber();
    
    // Calculate totals
    let subtotal = 0;
    for (const item of body.items) {
      subtotal += (item.price || 0) * (item.quantity || 1);
    }
    
    const taxAmount = Math.round(subtotal * 0.05 * 100) / 100;
    const shippingAmount = subtotal >= 499 ? 0 : 49;
    const totalAmount = subtotal + taxAmount + shippingAmount;

    // ✅ Order Insert
    await c.env.DB.prepare(
      `INSERT INTO orders 
        (id, user_id, order_number, status, subtotal, tax_amount, shipping_amount, discount_amount,
         total_amount, payment_status, payment_method, shipping_address, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'pending', ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(
        id,
        user.id,
        orderNumber,
        subtotal,
        taxAmount,
        shippingAmount,
        body.discount || 0,
        totalAmount,
        body.paymentMethod || 'cod',
        JSON.stringify(body.address)
      )
      .run();

    // ✅ Order Items Insert
    for (const item of body.items) {
      const itemId = genId('oi');
      await c.env.DB.prepare(
        `INSERT INTO order_items (id, order_id, product_id, product_name, price, quantity, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(itemId, id, item.productId || item.id, item.name || 'Product', item.price || 0, item.quantity || 1, (item.price || 0) * (item.quantity || 1))
        .run();
    }

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    return ok(c, { order, orderId: id, orderNumber }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create order: ${err.message}`, 500);
  }
});

// POST /api/orders/create
orders.post('/create', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const body = await c.req.json().catch(() => ({}));
    const { items, shippingAddress, paymentMethod = 'cod' } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return fail(c, 'items must be a non-empty array of { productId, quantity }.', 400);
    }
    if (!shippingAddress) {
      return fail(c, 'shippingAddress is required.', 400);
    }

    // Resolve product prices from the DB (never trust client-supplied prices).
    let subtotal = 0;
    const resolvedItems = [];

    for (const item of items) {
      const product = await c.env.DB.prepare(
        'SELECT id, name, price, stock FROM products WHERE id = ?'
      )
        .bind(item.productId)
        .first();

      if (!product) return fail(c, `Product not found: ${item.productId}`, 404);
      if (product.stock < item.quantity) {
        return fail(c, `Insufficient stock for ${product.name}.`, 400);
      }

      const lineSubtotal = product.price * item.quantity;
      subtotal += lineSubtotal;

      resolvedItems.push({
        productId: product.id,
        productName: product.name,
        price: product.price,
        quantity: item.quantity,
        subtotal: lineSubtotal,
      });
    }

    const taxAmount = Math.round(subtotal * 0.05 * 100) / 100;
    const shippingAmount = subtotal >= 999 ? 0 : 79;
    const totalAmount = subtotal + taxAmount + shippingAmount;

    const orderId = genId('order');
    const orderNumber = genOrderNumber();

    await c.env.DB.prepare(
      `INSERT INTO orders
        (id, user_id, order_number, status, subtotal, tax_amount, shipping_amount, discount_amount,
         total_amount, payment_status, payment_method, shipping_address, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, 0, ?, 'pending', ?, ?, datetime('now'), datetime('now'))`
    )
      .bind(
        orderId,
        user.id,
        orderNumber,
        subtotal,
        taxAmount,
        shippingAmount,
        totalAmount,
        paymentMethod,
        JSON.stringify(shippingAddress)
      )
      .run();

    for (const item of resolvedItems) {
      const itemId = genId('oi');
      await c.env.DB.prepare(
        `INSERT INTO order_items (id, order_id, product_id, product_name, price, quantity, subtotal)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
        .bind(itemId, orderId, item.productId, item.productName, item.price, item.quantity, item.subtotal)
        .run();

      await c.env.DB.prepare('UPDATE products SET stock = stock - ? WHERE id = ?')
        .bind(item.quantity, item.productId)
        .run();
    }

    // Clear whatever was ordered out of the user's cart.
    for (const item of resolvedItems) {
      await c.env.DB.prepare('DELETE FROM cart WHERE user_id = ? AND product_id = ?')
        .bind(user.id, item.productId)
        .run();
    }

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(orderId).first();

    return ok(c, { ...order, items: resolvedItems }, undefined, 201);
  } catch (err) {
    return fail(c, `Failed to create order: ${err.message}`, 500);
  }
});

// GET /api/orders/my-orders
orders.get('/my-orders', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { page, limit, offset } = parsePagination(c);

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(user.id, limit, offset)
      .all();

    const countRow = await c.env.DB.prepare('SELECT COUNT(*) as total FROM orders WHERE user_id = ?')
      .bind(user.id)
      .first();

    return ok(c, results || [], {
      page,
      limit,
      total: countRow?.total || 0,
      totalPages: Math.max(1, Math.ceil((countRow?.total || 0) / limit)),
    });
  } catch (err) {
    return fail(c, `Failed to load orders: ${err.message}`, 500);
  }
});


// GET /api/orders/user - User ke apne saare orders
orders.get('/user', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC'
    ).bind(user.id).all();

    const userOrders = results || [];

    // ✅ FIX: frontend (MyOrders.jsx) needs order.items on every order in
    // this list (to check review-eligibility per item) — previously this
    // route only returned the bare order rows with no items at all.
    if (userOrders.length > 0) {
      const orderIds = userOrders.map((o) => o.id);
      const placeholders = orderIds.map(() => '?').join(',');
      const { results: allItems } = await c.env.DB.prepare(
        `SELECT * FROM order_items WHERE order_id IN (${placeholders})`
      ).bind(...orderIds).all();

      const itemsByOrder = {};
      for (const item of allItems || []) {
        (itemsByOrder[item.order_id] ||= []).push(item);
      }
      for (const order of userOrders) {
        order.items = itemsByOrder[order.id] || [];
      }
    }

    return ok(c, userOrders);
  } catch (err) {
    return fail(c, `Failed to load orders: ${err.message}`, 500);
  }
});

// PUT/PATCH /api/orders/:id/cancel - Customer cancels their own pending order
// (Frontend Profile.jsx & MyOrders.jsx hit this path with different HTTP
// methods (PUT vs PATCH) — registering both keeps every caller working
// instead of chasing down each page's method choice one by one.)
const cancelOrderHandler = async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    if (!order) return fail(c, 'Order not found.', 404);

    if (order.user_id !== user.id && user.role !== 'admin') {
      return fail(c, 'You do not have access to this order.', 403);
    }
    if (order.status !== 'pending' && order.status !== 'confirmed') {
      return fail(c, 'Only pending or confirmed orders can be cancelled.', 400);
    }

    await c.env.DB.prepare(
      `UPDATE orders SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?`
    ).bind(id).run();

    const updated = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to cancel order: ${err.message}`, 500);
  }
};
orders.put('/:id/cancel', authMiddleware, cancelOrderHandler);
orders.patch('/:id/cancel', authMiddleware, cancelOrderHandler);

/* --------------------------------------------------------------------- */
/* Admin                                                                  */
/* --------------------------------------------------------------------- */

// GET /api/orders/all - List ALL orders for Admin Dashboard
// ⚠️ IMPORTANT: this MUST be registered before GET /:id, otherwise ":id"
// greedily matches the literal word "all" as an order id and this route
// never gets hit (this was the exact cause of the reported 404).
orders.get('/all', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM orders ORDER BY created_at DESC'
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load all orders: ${err.message}`, 500);
  }
});

// GET /api/orders/:id
// ⚠️ Any new static routes (e.g. /api/orders/something) must be added
// ABOVE this line, never below — otherwise they'll be shadowed the same way.
orders.get('/:id', authMiddleware, async (c) => {
  try {
    const user = c.get('user');
    const id = c.req.param('id');

    const order = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    if (!order) return fail(c, 'Order not found.', 404);

    // Customers may only view their own orders; admins may view any order.
    if (order.user_id !== user.id && user.role !== 'admin') {
      return fail(c, 'You do not have access to this order.', 403);
    }

    const { results: items } = await c.env.DB.prepare('SELECT * FROM order_items WHERE order_id = ?')
      .bind(id)
      .all();

    return ok(c, { ...order, items: items || [] });
  } catch (err) {
    return fail(c, `Failed to load order: ${err.message}`, 500);
  }
});

// GET /api/orders  - list all orders (admin)
orders.get('/', authMiddleware, requireAdmin, async (c) => {
  try {
    const { page, limit, offset } = parsePagination(c);
    const url = new URL(c.req.url);
    const status = url.searchParams.get('status');

    const conditions = [];
    const bindings = [];
    if (status) {
      conditions.push('status = ?');
      bindings.push(status);
    }
    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { results } = await c.env.DB.prepare(
      `SELECT * FROM orders ${whereClause} ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
      .bind(...bindings, limit, offset)
      .all();

    const countRow = await c.env.DB.prepare(`SELECT COUNT(*) as total FROM orders ${whereClause}`)
      .bind(...bindings)
      .first();

    return ok(c, results || [], {
      page,
      limit,
      total: countRow?.total || 0,
      totalPages: Math.max(1, Math.ceil((countRow?.total || 0) / limit)),
    });
  } catch (err) {
    return fail(c, `Failed to load orders: ${err.message}`, 500);
  }
});

// PUT /api/orders/:id/status (admin)
orders.put('/:id/status', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json().catch(() => ({}));
    const { status } = body;

    if (!VALID_STATUSES.includes(status)) {
      return fail(c, `status must be one of: ${VALID_STATUSES.join(', ')}`, 400);
    }

    const result = await c.env.DB.prepare(
      `UPDATE orders SET status = ?, updated_at = datetime('now') WHERE id = ?`
    )
      .bind(status, id)
      .run();

    if (result.meta?.changes === 0) return fail(c, 'Order not found.', 404);

    const updated = await c.env.DB.prepare('SELECT * FROM orders WHERE id = ?').bind(id).first();
    return ok(c, updated);
  } catch (err) {
    return fail(c, `Failed to update order status: ${err.message}`, 500);
  }
});

export default orders;
