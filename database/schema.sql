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
