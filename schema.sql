-- schema.sql
-- Cloudflare D1 (SQLite) schema for myjinkshop.
-- Apply with:
--   wrangler d1 execute mypinkshop-db --local --file=schema.sql
--   wrangler d1 execute mypinkshop-db --remote --file=schema.sql

PRAGMA foreign_keys = ON;

/* ----------------------------------------------------------------------- */
/* users                                                                    */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  email         TEXT NOT NULL UNIQUE,
  password      TEXT NOT NULL,               -- "pbkdf2$<iterations>$<saltHex>$<hashHex>"
  phone         TEXT,
  role          TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer', 'admin', 'vendor')),
  avatar        TEXT,
  vendor_status TEXT DEFAULT NULL CHECK (vendor_status IS NULL OR vendor_status IN ('pending', 'approved', 'blocked')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_users_role  ON users(role);

/* ----------------------------------------------------------------------- */
/* products                                                                  */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS products (
  id                 TEXT PRIMARY KEY,
  vendor_id          TEXT NOT NULL DEFAULT 'admin',
  vendor_name        TEXT NOT NULL DEFAULT 'MyPinkShop',

  name               TEXT NOT NULL,
  brand              TEXT DEFAULT '',

  main_category      TEXT DEFAULT 'Other',
  sub_category       TEXT DEFAULT '',
  category_slug      TEXT DEFAULT '',

  description        TEXT DEFAULT '',
  about_this_item    TEXT DEFAULT '[]',      -- JSON array (stringified)

  price              REAL NOT NULL,
  original_price     REAL DEFAULT 0,
  discount_percent   REAL DEFAULT 0,
  tax                REAL DEFAULT 5,

  stock              INTEGER DEFAULT 0,
  sku                TEXT UNIQUE,
  weight             TEXT DEFAULT '',
  dimensions         TEXT DEFAULT '',

  images             TEXT DEFAULT '[]',      -- JSON array of URLs (stringified)

  rating             REAL DEFAULT 0,
  review_count       INTEGER DEFAULT 0,

  is_active          INTEGER NOT NULL DEFAULT 1,   -- 0/1 boolean
  is_featured        INTEGER NOT NULL DEFAULT 0,   -- 0/1 boolean

  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_products_active     ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_category   ON products(main_category);
CREATE INDEX IF NOT EXISTS idx_products_subcat     ON products(sub_category);
CREATE INDEX IF NOT EXISTS idx_products_vendor     ON products(vendor_id);
CREATE INDEX IF NOT EXISTS idx_products_featured   ON products(is_featured);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON products(created_at);

/* ----------------------------------------------------------------------- */
/* offers                                                                    */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS offers (
  id                TEXT PRIMARY KEY,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  is_active         INTEGER NOT NULL DEFAULT 1,
  type              TEXT NOT NULL DEFAULT 'top_banner'
                       CHECK (type IN ('top_banner', 'popup', 'coupon')),
  discount_type     TEXT NOT NULL DEFAULT 'percentage'
                       CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value    REAL DEFAULT 10,
  min_order_value   REAL DEFAULT 0,
  start_date        TEXT DEFAULT (datetime('now')),
  end_date          TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_offers_active ON offers(is_active);
CREATE INDEX IF NOT EXISTS idx_offers_dates  ON offers(start_date, end_date);

/* ----------------------------------------------------------------------- */
/* banners                                                                   */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS banners (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  subtitle      TEXT DEFAULT '',
  button_text   TEXT DEFAULT 'Shop Now',
  link          TEXT DEFAULT '/shop',
  image         TEXT DEFAULT '',
  image_key     TEXT DEFAULT '',
  sort_order    INTEGER DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_banners_active ON banners(active);
CREATE INDEX IF NOT EXISTS idx_banners_order  ON banners(sort_order);

/* ----------------------------------------------------------------------- */
/* ads                                                                       */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS ads (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  image         TEXT NOT NULL,
  link          TEXT DEFAULT '/shop',
  vendor_id     TEXT DEFAULT 'admin',
  position      TEXT NOT NULL DEFAULT 'homepage_top'
                   CHECK (position IN ('homepage_top', 'homepage_mid', 'category_top', 'sidebar', 'checkout')),
  is_active     INTEGER NOT NULL DEFAULT 1,
  start_date    TEXT,
  end_date      TEXT,
  clicks        INTEGER DEFAULT 0,
  impressions   INTEGER DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ads_active   ON ads(is_active);
CREATE INDEX IF NOT EXISTS idx_ads_position ON ads(position);

/* ----------------------------------------------------------------------- */
/* orders + order_items                                                     */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  user_id           TEXT NOT NULL REFERENCES users(id),
  order_number      TEXT NOT NULL UNIQUE,
  status            TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending', 'confirmed', 'shipped', 'delivered', 'cancelled', 'refunded')),
  subtotal          REAL NOT NULL DEFAULT 0,
  tax_amount        REAL NOT NULL DEFAULT 0,
  shipping_amount   REAL NOT NULL DEFAULT 0,
  discount_amount   REAL NOT NULL DEFAULT 0,
  total_amount      REAL NOT NULL DEFAULT 0,
  payment_status    TEXT NOT NULL DEFAULT 'pending'
                       CHECK (payment_status IN ('pending', 'paid', 'failed', 'refunded')),
  payment_method    TEXT DEFAULT 'cod',
  payment_id        TEXT,
  shipping_address  TEXT NOT NULL DEFAULT '{}',  -- JSON (stringified)
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status  ON orders(status);

CREATE TABLE IF NOT EXISTS order_items (
  id            TEXT PRIMARY KEY,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  product_name  TEXT NOT NULL,
  price         REAL NOT NULL,
  quantity      INTEGER NOT NULL,
  subtotal      REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

/* ----------------------------------------------------------------------- */
/* cart                                                                      */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS cart (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  quantity      INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_cart_user_id ON cart(user_id);

/* ----------------------------------------------------------------------- */
/* payments + webhook_events                                                 */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS payments (
  id                    TEXT PRIMARY KEY,
  order_id              TEXT NOT NULL REFERENCES orders(id),
  provider              TEXT NOT NULL DEFAULT 'razorpay',
  provider_payment_id   TEXT,
  amount                REAL NOT NULL,
  currency              TEXT NOT NULL DEFAULT 'INR',
  status                TEXT NOT NULL DEFAULT 'created'
                           CHECK (status IN ('created', 'success', 'failed', 'refunded')),
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_payments_order_id ON payments(order_id);

CREATE TABLE IF NOT EXISTS webhook_events (
  id            TEXT PRIMARY KEY,
  provider      TEXT NOT NULL,
  event_type    TEXT NOT NULL,
  payload       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

/* ----------------------------------------------------------------------- */
/* coupons                                                                   */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS coupons (
  id                TEXT PRIMARY KEY,
  code              TEXT NOT NULL UNIQUE,
  description       TEXT DEFAULT '',
  discount_type     TEXT NOT NULL DEFAULT 'percentage'
                       CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value    REAL NOT NULL DEFAULT 0,
  min_order_value   REAL DEFAULT 0,
  max_discount      REAL DEFAULT 0,
  usage_limit       INTEGER DEFAULT 100,
  is_active         INTEGER NOT NULL DEFAULT 1,
  start_date        TEXT DEFAULT (datetime('now')),
  end_date          TEXT,
  expires_at        TEXT,
  created_at        TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_coupons_code   ON coupons(code);
CREATE INDEX IF NOT EXISTS idx_coupons_active ON coupons(is_active);

/* ----------------------------------------------------------------------- */
/* notifications                                                             */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS notifications (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  title         TEXT NOT NULL,
  message       TEXT NOT NULL,
  type          TEXT NOT NULL DEFAULT 'system',
  is_read       INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);

/* ----------------------------------------------------------------------- */
/* otp_verifications                                                         */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS otp_verifications (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  otp_code      TEXT NOT NULL,
  is_verified   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email);

/* ----------------------------------------------------------------------- */
/* password_resets                                                           */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS password_resets (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  token         TEXT NOT NULL UNIQUE,
  used          INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_password_resets_token   ON password_resets(token);
CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);

/* ----------------------------------------------------------------------- */
/* user_addresses                                                            */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS user_addresses (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  name          TEXT NOT NULL,
  phone         TEXT NOT NULL,
  line1         TEXT NOT NULL,
  line2         TEXT DEFAULT '',
  city          TEXT NOT NULL,
  state         TEXT NOT NULL,
  pincode       TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_addresses_user_id ON user_addresses(user_id);

/* ----------------------------------------------------------------------- */
/* user_cards (only last4 is ever stored - never raw card numbers/CVV)       */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS user_cards (
  id                  TEXT PRIMARY KEY,
  user_id             TEXT NOT NULL REFERENCES users(id),
  card_last4          TEXT NOT NULL,
  card_holder_name    TEXT NOT NULL,
  expiry_month        TEXT NOT NULL,
  expiry_year         TEXT NOT NULL,
  is_default          INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_cards_user_id ON user_cards(user_id);

/* ----------------------------------------------------------------------- */
/* user_upi                                                                   */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS user_upi (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  upi_id        TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_user_upi_user_id ON user_upi(user_id);

/* ----------------------------------------------------------------------- */
/* reviews                                                                    */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS reviews (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  rating        INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review        TEXT DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_reviews_product_id ON reviews(product_id);
CREATE INDEX IF NOT EXISTS idx_reviews_user_id    ON reviews(user_id);

/* ----------------------------------------------------------------------- */
/* wishlist                                                                   */
/* ----------------------------------------------------------------------- */
CREATE TABLE IF NOT EXISTS wishlist (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON wishlist(user_id);

/* ----------------------------------------------------------------------- */
/* Seed data (safe to remove) - lets the public endpoints return content   */
/* immediately after the schema is applied, so you can verify deployment. */
/* ----------------------------------------------------------------------- */

INSERT OR IGNORE INTO offers (id, title, description, is_active, type, discount_type, discount_value, min_order_value)
VALUES ('off_seed001', 'Welcome Offer', 'Get 10% off your first order', 1, 'top_banner', 'percentage', 10, 499);

INSERT OR IGNORE INTO banners (id, title, subtitle, button_text, link, image, sort_order, active)
VALUES ('ban_seed001', 'New Season Arrivals', 'Fresh looks for every mood', 'Shop Now', '/shop', '', 0, 1);

INSERT OR IGNORE INTO products (id, name, brand, main_category, sub_category, description, price, original_price, stock, images, is_active, is_featured)
VALUES ('prod_seed001', 'Matte Lipstick - Rose Pink', 'MyPinkShop', 'Makeup', 'Lips', 'Long-lasting matte lipstick in a soft rose pink shade.', 399, 599, 100, '[]', 1, 1);
