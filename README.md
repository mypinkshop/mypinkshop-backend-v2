# myjinkshop API

Cloudflare Workers backend for the myjinkshop e-commerce platform, built with
[Hono](https://hono.dev) and [Cloudflare D1](https://developers.cloudflare.com/d1/).

## Stack

- **Runtime:** Cloudflare Workers
- **Framework:** Hono
- **Database:** Cloudflare D1 (SQLite), accessed via `c.env.DB.prepare(...).bind(...).all()/.first()/.run()`
- **Auth:** Stateless JWT (HS256) signed/verified with the Web Crypto API, passwords hashed with PBKDF2 — no Node-only libraries (`jsonwebtoken`, `bcrypt`, `pg`, `mysql`) are used anywhere, since Workers doesn't support them.

## Project layout

```
src/
  index.js          Hono app entry point: CORS, pretty-json, route mounting, error handling
  lib/
    jwt.js           JWT sign/verify (HS256, Web Crypto)
    password.js      Password hashing/verification (PBKDF2, Web Crypto)
    utils.js         Shared response helpers, pagination, id/order-number generation
  routes/
    auth.js          Register / login / me / logout + authMiddleware + requireAdmin
    offers.js        GET /api/offers/active-offer (public) + admin CRUD
    banners.js       GET /api/banners/active (public) + admin CRUD
    products.js       GET /api/products, /api/products/:id (public) + admin CRUD
    ads.js           GET /api/ads/public/banners (public) + click/impression tracking + admin CRUD
    users.js         Profile self-service + admin user management
    orders.js        Order creation/listing + admin status updates
    payments.js      Payment scaffold (create/verify/webhook) — wire up your gateway
    cart.js          Cart add/update/remove/clear (auth required)
schema.sql           D1 schema + light seed data
wrangler.toml        Workers config (update database_id after creating your D1 DB)
```

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Create your D1 database**

   ```bash
   npx wrangler d1 create myjinkshop-db
   ```

   Copy the `database_id` it prints into `wrangler.toml`, replacing
   `REPLACE_WITH_YOUR_ID`.

3. **Apply the schema**

   ```bash
   npm run db:migrate:local     # for local `wrangler dev` testing
   npm run db:migrate:remote    # for your live Cloudflare D1 database
   ```

4. **Set your JWT secret**

   ```bash
   npx wrangler secret put JWT_SECRET
   ```

   For local development, copy `.dev.vars.example` to `.dev.vars` and fill in
   a value instead (this file is gitignored).

5. **Run locally**

   ```bash
   npm run dev
   ```

6. **Deploy**

   ```bash
   npm run deploy
   ```

## Public endpoints

- `GET /api/offers/active-offer`
- `GET /api/banners/active`
- `GET /api/products` (supports `category`, `subCategory`, `search`, `minPrice`, `maxPrice`, `featured`, `sort`, `page`, `limit` query params)
- `GET /api/products/:id`
- `GET /api/ads/public/banners`
- `POST /api/auth/register`, `POST /api/auth/login`

## Auth

Send `Authorization: Bearer <token>` (token returned from `/api/auth/login` or
`/api/auth/register`) for any protected route. Admin-only routes additionally
check `c.get('user').role === 'admin'` via the `requireAdmin` middleware
exported from `src/routes/auth.js`.

To make a user an admin, either seed one directly in D1:

```sql
UPDATE users SET role = 'admin' WHERE email = 'you@example.com';
```

or use the `PUT /api/users/:id/role` endpoint once you have at least one
admin account.

## Notes

- All list endpoints return `{ success, data, meta? }`; all errors return
  `{ success: false, error }`.
- `payments.js` is a working scaffold with the request/response shape and DB
  writes in place, but the actual gateway signature verification calls are
  marked `// TODO:` — fill these in with your provider's SDK/API before
  taking real payments.
- CORS currently allows `origin: '*'` for ease of setup — restrict this to
  your storefront's domain(s) before going to production.
