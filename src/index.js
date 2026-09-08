// src/index.js
// Main Cloudflare Workers entry point, built with Hono.
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { prettyJSON } from 'hono/pretty-json';
import { HTTPException } from 'hono/http-exception';

import authRoutes from './routes/auth.js';
import offersRoutes from './routes/offers.js';
import bannersRoutes from './routes/banners.js';
import productsRoutes from './routes/products.js';
import adsRoutes from './routes/ads.js';
import usersRoutes from './routes/users.js';
import ordersRoutes from './routes/orders.js';
import paymentsRoutes from './routes/payments.js';
import cartRoutes from './routes/cart.js';
import wishlistRoutes from './routes/wishlist.js';
import importerRoutes from './routes/flipkartImporter.js'; // Flipkart Importer
import adminRoutes from './routes/admin.js'; // ⬅️ Yeh import add kiya
import notificationRoutes from './routes/notifications.js'; // ⬅️ Yeh import add kiya
import uploadRoutes from './routes/upload.js';
import couponRoutes from './routes/coupons.js';
import shippingRoutes from './routes/shipping.js';
import otpRoutes from './routes/otp.js';
import addressRoutes from './routes/addresses.js';
import userCardsRoutes from './routes/userCards.js';
import userUpiRoutes from './routes/userUpi.js';
import reviewRoutes from './routes/reviews.js';
import returnsRoutes from './routes/returns.js'; // ⬅️ NEW: return/refund requests
import categoriesRouter from './routes/categories';
import adminPaymentsRouter from './routes/adminPayments';




const app = new Hono();

/* --------------------------------------------------------------------- */
/* Global middleware                                                      */
/* --------------------------------------------------------------------- */

app.use('*', prettyJSON());

app.use(
  '*',
  cors({
    origin: '*', // TODO: restrict to your storefront's origin(s) in production
    allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    exposeHeaders: ['Content-Length'],
    maxAge: 86400,
  })
);

/* --------------------------------------------------------------------- */
/* Health check / root                                                    */
/* --------------------------------------------------------------------- */

app.get('/', (c) =>
  c.json({
    success: true,
    message: 'Mypinkinkshop API is running.',
    time: new Date().toISOString(),
  })
);

// ✅ Updated health check with D1 database connection check
app.get('/api/health', async (c) => {
  try {
    // Check D1 connection
    await c.env.DB.prepare('SELECT 1').run();
    return c.json({
      success: true,
      status: 'ok',
      database: 'connected',
      time: new Date().toISOString()
    });
  } catch (error) {
    return c.json({
      success: true,
      status: 'ok',
      database: 'error',
      time: new Date().toISOString()
    });
  }
});

/* --------------------------------------------------------------------- */
/* Route mounting                                                         */
/* --------------------------------------------------------------------- */
//
// ⚠️ ORDER MATTERS: any /api/users/<something> route that needs to be
// reached by a NON-admin (addresses, cards, upi — a customer's own saved
// data) must be mounted BEFORE the generic '/api/users' mount below. That
// generic mount includes a GET '/:id' route guarded by requireAdmin (for
// admins looking up any user by id) — if it's registered first, a request
// to /api/users/addresses matches it as id="addresses" and gets rejected
// with 403 before ever reaching the real addresses/cards/upi routes.

app.route('/api/users/addresses', addressRoutes);
app.route('/api/users/cards', userCardsRoutes);
app.route('/api/users/upi', userUpiRoutes);

app.route('/api/auth', authRoutes);
app.route('/api/offers', offersRoutes);
app.route('/api/banners', bannersRoutes);
app.route('/api/products', productsRoutes);
app.route('/api/ads', adsRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/orders', ordersRoutes);
app.route('/api/payments', paymentsRoutes);
app.route('/api/cart', cartRoutes);
app.route('/api/wishlist', wishlistRoutes);
app.route('/api/import', importerRoutes); // Flipkart Importer Mount
app.route('/api/admin', adminRoutes); // ⬅️ Yeh mount add kiya
app.route('/api/notifications', notificationRoutes); // ⬅️ Yeh mount add kiya
app.route('/api/upload', uploadRoutes);
app.route('/api/coupons', couponRoutes);
app.route('/api/shipping', shippingRoutes);
app.route('/api/otp', otpRoutes);
app.route('/api/reviews', reviewRoutes);
// ⬅️ NEW: mounted at BOTH paths because AdminOrders.jsx calls
// /api/orders/returns/all for the list, but /api/returns/:id/status for
// approve/reject — same routes app, two prefixes, both work.
app.route('/api/returns', returnsRoutes);
app.route('/api/orders/returns', returnsRoutes);
app.route('/api/categories', categoriesRouter);
app.route('/api/admin', adminPaymentsRouter);


/* --------------------------------------------------------------------- */
/* 404 + global error handling                                            */
/* --------------------------------------------------------------------- */

app.notFound((c) =>
  c.json(
    {
      success: false,
      error: `Route not found: ${c.req.method} ${new URL(c.req.url).pathname}`,
    },
    404
  )
);

app.onError((err, c) => {
  console.error('Unhandled error:', err);

  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  return c.json(
    {
      success: false,
      error: err?.message || 'Internal Server Error',
    },
    500
  );
});

export default app;
