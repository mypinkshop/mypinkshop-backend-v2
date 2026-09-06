// src/routes/admin.js
import { Hono } from 'hono';
import { authMiddleware, requireAdmin } from './auth.js';
import { ok, fail } from '../lib/utils.js';

const admin = new Hono();

// ✅ GET /api/admin/dashboard - Dashboard stats
admin.get('/dashboard', authMiddleware, requireAdmin, async (c) => {
  try {
    // Users stats
    const [totalUsers, totalVendors, totalBuyers, totalProducts, totalOrders] = await Promise.all([
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users').first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').bind('vendor').first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE role = ?').bind('buyer').first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM products').first(),
      c.env.DB.prepare('SELECT COUNT(*) as count FROM orders').first()
    ]);

    // Total earnings (assuming commission is stored in orders)
    const earnings = await c.env.DB.prepare('SELECT COALESCE(SUM(commission), 0) as total FROM orders').first();
    const totalEarnings = earnings?.total || 0;

    // Recent orders
    const { results: recentOrders } = await c.env.DB.prepare(
      `SELECT o.*, u.name as buyer_name, u.email as buyer_email 
       FROM orders o 
       LEFT JOIN users u ON o.user_id = u.id 
       ORDER BY o.created_at DESC 
       LIMIT 5`
    ).all();

    return ok(c, {
      totalUsers: totalUsers?.count || 0,
      totalVendors: totalVendors?.count || 0,
      totalBuyers: totalBuyers?.count || 0,
      totalProducts: totalProducts?.count || 0,
      totalOrders: totalOrders?.count || 0,
      totalEarnings,
      recentOrders: recentOrders || []
    });
  } catch (err) {
    return fail(c, `Failed to load dashboard: ${err.message}`, 500);
  }
});

// ✅ GET /api/admin/vendors - All vendors
admin.get('/vendors', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT id, name, email, role, created_at FROM users WHERE role = ? ORDER BY created_at DESC'
    ).bind('vendor').all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load vendors: ${err.message}`, 500);
  }
});

// ✅ PUT /api/admin/vendors/:id/approve
admin.put('/vendors/:id/approve', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      'UPDATE users SET vendor_status = ? WHERE id = ? AND role = ?'
    ).bind('approved', id, 'vendor').run();
    
    if (result.meta?.changes === 0) return fail(c, 'Vendor not found.', 404);
    return ok(c, { success: true });
  } catch (err) {
    return fail(c, `Failed to approve vendor: ${err.message}`, 500);
  }
});

// ✅ PUT /api/admin/vendors/:id/block
admin.put('/vendors/:id/block', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const result = await c.env.DB.prepare(
      'UPDATE users SET vendor_status = ? WHERE id = ? AND role = ?'
    ).bind('blocked', id, 'vendor').run();
    
    if (result.meta?.changes === 0) return fail(c, 'Vendor not found.', 404);
    
    // Block vendor's products
    await c.env.DB.prepare(
      'UPDATE products SET is_active = 0 WHERE vendor_id = ?'
    ).bind(id).run();
    
    return ok(c, { success: true });
  } catch (err) {
    return fail(c, `Failed to block vendor: ${err.message}`, 500);
  }
});

// ✅ GET /api/admin/products - All products
admin.get('/products', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      'SELECT * FROM products ORDER BY created_at DESC'
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load products: ${err.message}`, 500);
  }
});

// ✅ PUT /api/admin/products/:id/toggle
admin.put('/products/:id/toggle', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const product = await c.env.DB.prepare(
      'SELECT is_active FROM products WHERE id = ?'
    ).bind(id).first();
    
    if (!product) return fail(c, 'Product not found.', 404);
    
    const newStatus = product.is_active ? 0 : 1;
    const result = await c.env.DB.prepare(
      'UPDATE products SET is_active = ? WHERE id = ?'
    ).bind(newStatus, id).run();
    
    return ok(c, { success: true, is_active: newStatus });
  } catch (err) {
    return fail(c, `Failed to toggle product: ${err.message}`, 500);
  }
});

// ✅ GET /api/admin/orders - All orders
admin.get('/orders', authMiddleware, requireAdmin, async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      `SELECT o.*, u.name as buyer_name, u.email as buyer_email 
       FROM orders o 
       LEFT JOIN users u ON o.user_id = u.id 
       ORDER BY o.created_at DESC`
    ).all();
    return ok(c, results || []);
  } catch (err) {
    return fail(c, `Failed to load orders: ${err.message}`, 500);
  }
});

// ✅ PUT /api/admin/orders/:id/status
admin.put('/orders/:id/status', authMiddleware, requireAdmin, async (c) => {
  try {
    const id = c.req.param('id');
    const { status } = await c.req.json().catch(() => ({}));
    
    const result = await c.env.DB.prepare(
      'UPDATE orders SET status = ? WHERE id = ?'
    ).bind(status, id).run();
    
    if (result.meta?.changes === 0) return fail(c, 'Order not found.', 404);
    return ok(c, { success: true, status });
  } catch (err) {
    return fail(c, `Failed to update order status: ${err.message}`, 500);
  }
});

export default admin;
