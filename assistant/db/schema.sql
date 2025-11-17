PRAGMA journal_mode=WAL;

CREATE TABLE IF NOT EXISTS products (
  product_id TEXT PRIMARY KEY,
  title TEXT,
  price_usd REAL,
  sizes TEXT,
  color TEXT,
  style TEXT,
  silhouette TEXT,
  occasion TEXT,
  material TEXT,
  length TEXT,
  image_url TEXT,
  stock INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_products_color ON products(color);
CREATE INDEX IF NOT EXISTS idx_products_length ON products(length);
CREATE INDEX IF NOT EXISTS idx_products_price ON products(price_usd);

-- user prefs (json by session)
CREATE TABLE IF NOT EXISTS user_prefs (
  session_id TEXT PRIMARY KEY,
  json TEXT NOT NULL
);