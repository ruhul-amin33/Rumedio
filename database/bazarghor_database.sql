-- BazarGhor: full database (tables + demo data). Bar bar import korleo problem nai.
-- phpMyAdmin > apnar database select > Import > ei file > Go

-- BazarGhor database schema (v1.0.0)
-- freedb.tech e CREATE DATABASE lagbe na, apnar deya database-ei table hobe.
-- Ei file bar bar run korle kono khoti nei (IF NOT EXISTS).

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS users (
  id            INT AUTO_INCREMENT PRIMARY KEY,
  name          VARCHAR(100) NOT NULL,
  email         VARCHAR(150) NOT NULL UNIQUE,
  phone         VARCHAR(20)  DEFAULT NULL,
  password_hash VARCHAR(100) NOT NULL,
  role          ENUM('customer','admin') NOT NULL DEFAULT 'customer',
  created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS categories (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(80) NOT NULL,
  slug       VARCHAR(80) NOT NULL UNIQUE,
  icon       VARCHAR(16) DEFAULT NULL,
  sort_order INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS products (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  category_id INT NOT NULL,
  title       VARCHAR(200) NOT NULL,
  description TEXT,
  price       DECIMAL(10,2) NOT NULL,
  old_price   DECIMAL(10,2) DEFAULT NULL,
  stock       INT NOT NULL DEFAULT 0,
  image_url   VARCHAR(500) DEFAULT NULL,
  rating      DECIMAL(2,1) NOT NULL DEFAULT 4.5,
  sold        INT NOT NULL DEFAULT 0,
  is_featured TINYINT(1) NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_products_category (category_id),
  INDEX idx_products_sold (sold),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  user_id        INT NOT NULL,
  name           VARCHAR(100) NOT NULL,
  phone          VARCHAR(20)  NOT NULL,
  address        VARCHAR(300) NOT NULL,
  city           VARCHAR(80)  NOT NULL,
  payment_method VARCHAR(20)  NOT NULL DEFAULT 'cod',
  subtotal       DECIMAL(10,2) NOT NULL,
  shipping       DECIMAL(10,2) NOT NULL DEFAULT 0,
  total          DECIMAL(10,2) NOT NULL,
  status         ENUM('pending','confirmed','shipped','delivered','cancelled') NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_orders_user (user_id),
  CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS order_items (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  order_id   INT NOT NULL,
  product_id INT DEFAULT NULL,
  title      VARCHAR(200) NOT NULL,
  price      DECIMAL(10,2) NOT NULL,
  qty        INT NOT NULL,
  image_url  VARCHAR(500) DEFAULT NULL,
  INDEX idx_items_order (order_id),
  CONSTRAINT fk_items_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Demo data (safe to re-run: kono duplicate hobe na)
SET NAMES utf8mb4;

INSERT IGNORE INTO categories (name, slug, icon, sort_order) VALUES
('Mobiles & Gadgets', 'mobiles-gadgets', '📱', 1),
('Electronics', 'electronics', '🎧', 2),
('Men''s Fashion', 'mens-fashion', '👕', 3),
('Women''s Fashion', 'womens-fashion', '👗', 4),
('Home & Living', 'home-living', '🏠', 5),
('Beauty & Health', 'beauty-health', '💄', 6),
('Groceries', 'groceries', '🛒', 7),
('Sports & Outdoor', 'sports-outdoor', '⚽', 8);

INSERT INTO products (category_id, title, description, price, old_price, stock, rating, sold, is_featured)
SELECT c.id, t.title, t.description, t.price, t.old_price, t.stock, t.rating, t.sold, t.is_featured FROM (
SELECT 'mobiles-gadgets' AS slug, 'Smartphone 6.5" 8GB RAM 128GB Storage' AS title, 'Big AMOLED display, 5000mAh battery, 50MP camera. Official warranty included.' AS description, 22990 AS price, 26990 AS old_price, 40 AS stock, 4.6 AS rating, 312 AS sold, 1 AS is_featured
UNION ALL
SELECT 'mobiles-gadgets' AS slug, 'Fast Charger 33W with Type-C Cable' AS title, 'Safe fast charging for most Android phones. Overheat and short-circuit protection.' AS description, 690 AS price, 990 AS old_price, 200 AS stock, 4.4 AS rating, 1280 AS sold, 0 AS is_featured
UNION ALL
SELECT 'mobiles-gadgets' AS slug, 'Tempered Glass Screen Protector (2 pcs)' AS title, '9H hardness, bubble-free install, easy-fit tray.' AS description, 220 AS price, 350 AS old_price, 500 AS stock, 4.3 AS rating, 2240 AS sold, 0 AS is_featured
UNION ALL
SELECT 'electronics' AS slug, 'Wireless Earbuds with Charging Case' AS title, 'Bluetooth 5.3, 30 hours total playtime, touch controls, low latency mode.' AS description, 1450 AS price, 2200 AS old_price, 90 AS stock, 4.5 AS rating, 860 AS sold, 1 AS is_featured
UNION ALL
SELECT 'electronics' AS slug, 'Bluetooth Speaker Waterproof' AS title, 'Deep bass, 12 hours battery, IPX6 water resistance.' AS description, 1890 AS price, 2500 AS old_price, 55 AS stock, 4.4 AS rating, 402 AS sold, 0 AS is_featured
UNION ALL
SELECT 'electronics' AS slug, 'Power Bank 20000mAh Dual USB' AS title, 'Two output ports, LED battery indicator, safe for flights.' AS description, 1690 AS price, 2100 AS old_price, 70 AS stock, 4.5 AS rating, 730 AS sold, 1 AS is_featured
UNION ALL
SELECT 'mens-fashion' AS slug, 'Men''s Cotton Polo T-Shirt' AS title, 'Breathable premium cotton, regular fit, available in multiple colors.' AS description, 480 AS price, 750 AS old_price, 300 AS stock, 4.4 AS rating, 1710 AS sold, 1 AS is_featured
UNION ALL
SELECT 'mens-fashion' AS slug, 'Slim Fit Denim Jeans' AS title, 'Stretch denim for all-day comfort. Machine washable.' AS description, 1390 AS price, 1890 AS old_price, 120 AS stock, 4.3 AS rating, 520 AS sold, 0 AS is_featured
UNION ALL
SELECT 'mens-fashion' AS slug, 'Leather Wallet with Card Slots' AS title, 'Genuine leather, 6 card slots, coin pocket.' AS description, 550 AS price, 800 AS old_price, 150 AS stock, 4.2 AS rating, 640 AS sold, 0 AS is_featured
UNION ALL
SELECT 'womens-fashion' AS slug, 'Cotton Three-Piece Salwar Kameez' AS title, 'Soft printed cotton with dupatta. Perfect for daily wear.' AS description, 1650 AS price, 2300 AS old_price, 80 AS stock, 4.5 AS rating, 470 AS sold, 1 AS is_featured
UNION ALL
SELECT 'womens-fashion' AS slug, 'Hand Bag with Shoulder Strap' AS title, 'Roomy PU leather bag with zip closure and inner pocket.' AS description, 990 AS price, 1500 AS old_price, 65 AS stock, 4.3 AS rating, 350 AS sold, 0 AS is_featured
UNION ALL
SELECT 'womens-fashion' AS slug, 'Premium Georgette Hijab' AS title, 'Lightweight, easy to drape, wrinkle resistant.' AS description, 320 AS price, 450 AS old_price, 260 AS stock, 4.6 AS rating, 980 AS sold, 0 AS is_featured
UNION ALL
SELECT 'home-living' AS slug, 'Non-stick Cookware Set (5 pcs)' AS title, 'Even heating, easy-clean coating, heat-resistant handles.' AS description, 3290 AS price, 4200 AS old_price, 35 AS stock, 4.5 AS rating, 210 AS sold, 1 AS is_featured
UNION ALL
SELECT 'home-living' AS slug, 'Electric Kettle 1.8L Stainless Steel' AS title, 'Auto shut-off, boil-dry protection, rapid boil.' AS description, 1190 AS price, 1600 AS old_price, 60 AS stock, 4.4 AS rating, 390 AS sold, 0 AS is_featured
UNION ALL
SELECT 'home-living' AS slug, 'Bed Sheet Set King Size' AS title, 'Soft cotton blend, 1 sheet with 2 pillow covers, fade-resistant.' AS description, 1250 AS price, 1800 AS old_price, 90 AS stock, 4.3 AS rating, 560 AS sold, 0 AS is_featured
UNION ALL
SELECT 'beauty-health' AS slug, 'Vitamin C Face Serum 30ml' AS title, 'Brightening serum for daily use. Dermatologically tested.' AS description, 690 AS price, 950 AS old_price, 140 AS stock, 4.4 AS rating, 810 AS sold, 1 AS is_featured
UNION ALL
SELECT 'beauty-health' AS slug, 'Herbal Hair Oil 200ml' AS title, 'Coconut and amla blend for strong, shiny hair.' AS description, 260 AS price, 340 AS old_price, 400 AS stock, 4.5 AS rating, 1560 AS sold, 0 AS is_featured
UNION ALL
SELECT 'beauty-health' AS slug, 'Digital Thermometer' AS title, 'Fast 10-second reading, fever alarm, memory recall.' AS description, 320 AS price, 450 AS old_price, 180 AS stock, 4.4 AS rating, 420 AS sold, 0 AS is_featured
UNION ALL
SELECT 'groceries' AS slug, 'Miniket Rice 5kg' AS title, 'Cleaned and polished, cooks soft and fluffy.' AS description, 490 AS price, NULL AS old_price, 500 AS stock, 4.6 AS rating, 3200 AS sold, 0 AS is_featured
UNION ALL
SELECT 'groceries' AS slug, 'Soybean Oil 5L' AS title, 'Refined, cholesterol-free cooking oil.' AS description, 850 AS price, 920 AS old_price, 300 AS stock, 4.5 AS rating, 2890 AS sold, 1 AS is_featured
UNION ALL
SELECT 'groceries' AS slug, 'Premium Tea 400g Pack' AS title, 'Strong aroma and rich color, from Sylhet gardens.' AS description, 310 AS price, 360 AS old_price, 350 AS stock, 4.5 AS rating, 1970 AS sold, 0 AS is_featured
UNION ALL
SELECT 'sports-outdoor' AS slug, 'Cricket Bat English Willow' AS title, 'Balanced pickup, thick edges, suitable for tape and leather ball.' AS description, 2490 AS price, 3200 AS old_price, 25 AS stock, 4.3 AS rating, 140 AS sold, 0 AS is_featured
UNION ALL
SELECT 'sports-outdoor' AS slug, 'Yoga Mat 6mm Anti-slip' AS title, 'Cushioned, non-slip surface, includes carry strap.' AS description, 690 AS price, 990 AS old_price, 110 AS stock, 4.4 AS rating, 330 AS sold, 1 AS is_featured
UNION ALL
SELECT 'sports-outdoor' AS slug, 'Football Size 5 Training Ball' AS title, 'Machine-stitched, durable outer, consistent bounce.' AS description, 780 AS price, 1050 AS old_price, 95 AS stock, 4.3 AS rating, 275 AS sold, 0 AS is_featured
) t JOIN categories c ON c.slug = t.slug
WHERE NOT EXISTS (SELECT 1 FROM products);
