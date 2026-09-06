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
    message: 'myjinkshop API is running.',
    time: new Date().toISOString(),
  })
);

app.get('/api/health', (c) =>
  c.json({
    success: true,
    status: 'ok',
    time: new Date().toISOString(),
  })
);

/* --------------------------------------------------------------------- */
/* Route mounting                                                         */
/* --------------------------------------------------------------------- */

app.route('/api/auth', authRoutes);
app.route('/api/offers', offersRoutes);
app.route('/api/banners', bannersRoutes);
app.route('/api/products', productsRoutes);
app.route('/api/ads', adsRoutes);
app.route('/api/users', usersRoutes);
app.route('/api/orders', ordersRoutes);
app.route('/api/payments', paymentsRoutes);
app.route('/api/cart', cartRoutes);

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
