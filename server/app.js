const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, getPool } = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const FREE_SHIP = 1500;
const SHIP_FEE = 60;
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ---------- helpers ---------- */
const sign = (u) => jwt.sign({ id: u.id, role: u.role }, JWT_SECRET, { expiresIn: '30d' });
const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, phone: u.phone, role: u.role });

function auth(req, res, next) {
  const t = (req.headers.authorization || '').replace('Bearer ', '');
  if (!t) return res.status(401).json({ error: 'Please log in first' });
  try {
    req.user = jwt.verify(t, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired. Please log in again' });
  }
}
function admin(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
  next();
}
const PRODUCT_SELECT = `
  SELECT p.id, p.category_id, p.title, p.description, p.price, p.old_price, p.stock,
         p.image_url, p.rating, p.sold, p.is_featured, p.created_at,
         c.name AS category_name, c.slug AS category_slug, c.icon AS icon
  FROM products p JOIN categories c ON c.id = p.category_id`;

/* ---------- health ---------- */
app.get('/api/health', h(async (req, res) => {
  await query('SELECT 1');
  res.json({ ok: true });
}));

/* ---------- catalog ---------- */
app.get('/api/categories', h(async (req, res) => {
  const [rows] = await query('SELECT id, name, slug, icon FROM categories ORDER BY sort_order, id');
  res.json({ categories: rows });
}));

app.get('/api/products', h(async (req, res) => {
  const { category, q, sort, featured, sale } = req.query;
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(48, Math.max(1, parseInt(req.query.limit) || 20));
  const where = ['1=1'];
  const params = [];
  if (category) { where.push('c.slug = ?'); params.push(String(category)); }
  if (q) {
    where.push('(p.title LIKE ? OR p.description LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (featured === '1') where.push('p.is_featured = 1');
  if (sale === '1') where.push('p.old_price IS NOT NULL AND p.old_price > p.price');
  const orders = {
    popular: 'p.sold DESC, p.id DESC', new: 'p.id DESC',
    price_asc: 'p.price ASC', price_desc: 'p.price DESC', rating: 'p.rating DESC, p.sold DESC'
  };
  const orderBy = orders[sort] || orders.popular;
  const w = where.join(' AND ');
  const [rows] = await query(`${PRODUCT_SELECT} WHERE ${w} ORDER BY ${orderBy} LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]);
  const [[{ total }]] = await query(
    `SELECT COUNT(*) AS total FROM products p JOIN categories c ON c.id = p.category_id WHERE ${w}`, params);
  res.json({ products: rows, total, page, limit });
}));

app.get('/api/products/:id', h(async (req, res) => {
  const [rows] = await query(`${PRODUCT_SELECT} WHERE p.id = ?`, [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Product not found' });
  const [related] = await query(
    `${PRODUCT_SELECT} WHERE p.category_id = ? AND p.id <> ? ORDER BY p.sold DESC LIMIT 8`,
    [rows[0].category_id, rows[0].id]);
  res.json({ product: rows[0], related });
}));

/* ---------- auth ---------- */
app.post('/api/auth/register', h(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = String(req.body.email || '').trim().toLowerCase();
  const phone = String(req.body.phone || '').trim();
  const password = String(req.body.password || '');
  if (name.length < 2) return res.status(400).json({ error: 'Please enter your full name' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  const [exists] = await query('SELECT id FROM users WHERE email = ?', [email]);
  if (exists.length) return res.status(409).json({ error: 'This email is already registered. Try logging in' });
  const role = process.env.ADMIN_EMAIL && process.env.ADMIN_EMAIL.toLowerCase() === email ? 'admin' : 'customer';
  const hash = await bcrypt.hash(password, 10);
  const [r] = await query('INSERT INTO users (name,email,phone,password_hash,role) VALUES (?,?,?,?,?)',
    [name, email, phone, hash, role]);
  const user = { id: r.insertId, name, email, phone, role };
  res.json({ token: sign(user), user: publicUser(user) });
}));

app.post('/api/auth/login', h(async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const [rows] = await query('SELECT * FROM users WHERE email = ?', [email]);
  if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
    return res.status(401).json({ error: 'Email or password is incorrect' });
  }
  res.json({ token: sign(rows[0]), user: publicUser(rows[0]) });
}));

app.get('/api/auth/me', auth, h(async (req, res) => {
  const [rows] = await query('SELECT id,name,email,phone,role FROM users WHERE id = ?', [req.user.id]);
  if (!rows.length) return res.status(401).json({ error: 'Account not found' });
  res.json({ user: rows[0] });
}));

/* ---------- orders ---------- */
app.post('/api/orders', auth, h(async (req, res) => {
  const { items, name, phone, address, city } = req.body;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty' });
  if (String(name || '').trim().length < 2) return res.status(400).json({ error: 'Enter the receiver name' });
  if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(String(phone || '').trim())) {
    return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number (e.g. 017XXXXXXXX)' });
  }
  if (String(address || '').trim().length < 8) return res.status(400).json({ error: 'Enter your full delivery address' });
  if (String(city || '').trim().length < 2) return res.status(400).json({ error: 'Enter your city or district' });

  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    let subtotal = 0;
    const lines = [];
    for (const it of items.slice(0, 50)) {
      const qty = Math.max(1, Math.min(20, parseInt(it.qty) || 1));
      const [rows] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [Number(it.id)]);
      if (!rows.length) throw Object.assign(new Error('A product in your cart is no longer available'), { code: 'USER' });
      const p = rows[0];
      if (p.stock < qty) {
        throw Object.assign(new Error(`Only ${p.stock} left of "${p.title}"`), { code: 'USER' });
      }
      subtotal += p.price * qty;
      lines.push({ p, qty });
    }
    const shipping = subtotal >= FREE_SHIP ? 0 : SHIP_FEE;
    const total = subtotal + shipping;
    const [o] = await conn.query(
      `INSERT INTO orders (user_id,name,phone,address,city,payment_method,subtotal,shipping,total,status)
       VALUES (?,?,?,?,?,?,?,?,?,'pending')`,
      [req.user.id, String(name).trim(), String(phone).trim(), String(address).trim(),
       String(city).trim(), 'cod', subtotal, shipping, total]);
    for (const { p, qty } of lines) {
      await conn.query(
        'INSERT INTO order_items (order_id,product_id,title,price,qty,image_url) VALUES (?,?,?,?,?,?)',
        [o.insertId, p.id, p.title, p.price, qty, p.image_url]);
      await conn.query('UPDATE products SET stock = stock - ?, sold = sold + ? WHERE id = ?', [qty, qty, p.id]);
    }
    await conn.commit();
    res.json({ id: o.insertId, total });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'USER') return res.status(400).json({ error: e.message });
    throw e;
  } finally {
    conn.release();
  }
}));

async function attachItems(orders) {
  if (!orders.length) return orders;
  const ids = orders.map((o) => o.id);
  const [items] = await query('SELECT * FROM order_items WHERE order_id IN (?)', [ids]);
  orders.forEach((o) => { o.items = items.filter((i) => i.order_id === o.id); });
  return orders;
}

app.get('/api/orders/mine', auth, h(async (req, res) => {
  const [rows] = await query('SELECT * FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 50', [req.user.id]);
  res.json({ orders: await attachItems(rows) });
}));

app.get('/api/orders/:id', auth, h(async (req, res) => {
  const [rows] = await query('SELECT * FROM orders WHERE id = ? AND user_id = ?', [Number(req.params.id), req.user.id]);
  if (!rows.length) return res.status(404).json({ error: 'Order not found' });
  res.json({ order: (await attachItems(rows))[0] });
}));

/* ---------- admin ---------- */
app.get('/api/admin/stats', auth, admin, h(async (req, res) => {
  const [[s]] = await query(`SELECT
    (SELECT COUNT(*) FROM orders) AS orders,
    (SELECT COUNT(*) FROM orders WHERE status='pending') AS pending,
    (SELECT COALESCE(SUM(total),0) FROM orders WHERE status <> 'cancelled') AS revenue,
    (SELECT COUNT(*) FROM products) AS products,
    (SELECT COUNT(*) FROM users) AS users`);
  res.json({ stats: s });
}));

app.get('/api/admin/orders', auth, admin, h(async (req, res) => {
  const [rows] = await query('SELECT * FROM orders ORDER BY id DESC LIMIT 100');
  res.json({ orders: await attachItems(rows) });
}));

app.patch('/api/admin/orders/:id', auth, admin, h(async (req, res) => {
  const ok = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
  if (!ok.includes(req.body.status)) return res.status(400).json({ error: 'Invalid status' });
  await query('UPDATE orders SET status = ? WHERE id = ?', [req.body.status, Number(req.params.id)]);
  res.json({ ok: true });
}));

function readProduct(b) {
  const title = String(b.title || '').trim();
  const price = Number(b.price);
  const oldPrice = b.old_price === '' || b.old_price == null ? null : Number(b.old_price);
  const stock = parseInt(b.stock);
  const categoryId = parseInt(b.category_id);
  if (title.length < 3) return { error: 'Product title is too short' };
  if (!(price > 0)) return { error: 'Enter a valid price' };
  if (oldPrice !== null && !(oldPrice >= 0)) return { error: 'Enter a valid old price' };
  if (!(stock >= 0)) return { error: 'Enter a valid stock number' };
  if (!(categoryId > 0)) return { error: 'Choose a category' };
  const img = String(b.image_url || '').trim();
  if (img && !/^https?:\/\//i.test(img)) return { error: 'Image link must start with http:// or https://' };
  return {
    v: [categoryId, title, String(b.description || '').trim(), price, oldPrice, stock, img || null, b.is_featured ? 1 : 0]
  };
}

app.post('/api/admin/products', auth, admin, h(async (req, res) => {
  const r = readProduct(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  const [ins] = await query(
    `INSERT INTO products (category_id,title,description,price,old_price,stock,image_url,is_featured,rating,sold)
     VALUES (?,?,?,?,?,?,?,?,4.5,0)`, r.v);
  res.json({ id: ins.insertId });
}));

app.put('/api/admin/products/:id', auth, admin, h(async (req, res) => {
  const r = readProduct(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  await query(
    `UPDATE products SET category_id=?, title=?, description=?, price=?, old_price=?, stock=?, image_url=?, is_featured=?
     WHERE id=?`, [...r.v, Number(req.params.id)]);
  res.json({ ok: true });
}));

app.delete('/api/admin/products/:id', auth, admin, h(async (req, res) => {
  await query('DELETE FROM products WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
}));

/* ---------- errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line
  console.error(err);
  if (err.message === 'DB_NOT_CONFIGURED') {
    return res.status(500).json({ error: 'Database is not configured. Set DB_* environment variables.' });
  }
  if (err.code === 'ER_NO_SUCH_TABLE') {
    return res.status(500).json({ error: 'Database tables are missing. Import database/schema.sql first.' });
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'ENOTFOUND', 'ER_USER_LIMIT_REACHED', 'ER_CON_COUNT_ERROR'].includes(err.code)) {
    return res.status(503).json({ error: 'Cannot reach the database right now. Please try again in a moment.' });
  }
  res.status(500).json({ error: 'Server error. Please try again.' });
});

module.exports = app;
