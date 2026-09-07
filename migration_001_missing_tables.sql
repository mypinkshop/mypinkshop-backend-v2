-- migration_001_missing_tables.sql
--
-- Run this ONCE against your EXISTING (already deployed) D1 database.
-- It only ADDS what's missing — it will never touch or delete your
-- existing users/products/orders data.
--
-- Local:
--   wrangler d1 execute mypinkshop-db --local --file=migration_001_missing_tables.sql
-- Remote (production):
--   wrangler d1 execute mypinkshop-db --remote --file=migration_001_missing_tables.sql

PRAGMA foreign_keys = ON;

-- users.vendor_status did not exist before — admin.js needs it to
-- approve/block vendors. ALTER TABLE ADD COLUMN is safe/non-destructive.
ALTER TABLE users ADD COLUMN vendor_status TEXT DEFAULT NULL;

-- The following 9 tables were referenced by routes (addresses.js, userCards.js,
-- userUpi.js, coupons.js, notifications.js, otp.js, auth.js, reviews.js,
-- wishlist.js) but were NEVER created in the original schema.sql — this is
-- why those features were failing with "no such table" errors.

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

CREATE TABLE IF NOT EXISTS otp_verifications (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL,
  otp_code      TEXT NOT NULL,
  is_verified   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_verifications(email);

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

CREATE TABLE IF NOT EXISTS user_upi (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  upi_id        TEXT NOT NULL,
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_user_upi_user_id ON user_upi(user_id);

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

CREATE TABLE IF NOT EXISTS wishlist (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id),
  product_id    TEXT NOT NULL REFERENCES products(id),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, product_id)
);
CREATE INDEX IF NOT EXISTS idx_wishlist_user_id ON wishlist(user_id);

-- NOTE: if `ALTER TABLE users ADD COLUMN vendor_status ...` above fails
-- with "duplicate column name", it just means you already ran this
-- migration before — that's safe to ignore.
