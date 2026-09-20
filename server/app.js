const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { query, connect, dbScope } = require('./db');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '100kb' }));
app.use(dbScope); // protyek request e ekta connection, sesh hole bondho

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
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
         c.name AS category_name, c.slug AS category_slug, c.icon AS icon, c.has_sizes AS has_sizes
  FROM products p JOIN categories c ON c.id = p.category_id`;

// Public catalog response CDN e ~30 sec cache hoy, tai DB te kom request jay (freedb.tech er limit er jonno joruri).
// ?_=... dile cache bypass hoy (admin panel eta use kore, jate edit sathe sathe dekha jay).
const pub = (req, res, ttl = 30) => {
  // Browser kokhono purono jinish dekhabe na (max-age=0); shudhu Vercel CDN ttl second cache kore.
  res.set('Cache-Control', req.query._ ? 'no-store' : `public, max-age=0, s-maxage=${ttl}`);
};

/* ---------- settings: Admin panel (DB) > env > default ----------
   Admin panel > Settings theke bodlale sathe sathe kaj kore, redeploy lagbe na. */
const num = (v, d) => (v !== undefined && v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : d);
async function getConfig(run = query) {
  let rows = [];
  try { [rows] = await run('SELECT k, v FROM settings'); } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
  const s = Object.fromEntries(rows.map((r) => [r.k, r.v]));
  const env = process.env;
  return {
    siteName: s.site_name || env.SITE_NAME || 'RumeDio Shop',
    supportEmail: s.support_email || env.SUPPORT_EMAIL || 'ruhulamineasy@gmail.com',
    supportPhone: s.support_phone || '',
    freeShipMin: num(s.free_ship_min, num(env.FREE_SHIP_MIN, 1500)),   // Dhaka te ei taka-r upor order e delivery free
    feeDhaka: num(s.fee_dhaka, num(env.FEE_DHAKA, 60)),
    feeOutside: num(s.fee_outside, num(env.FEE_OUTSIDE, 120)),
    freeShipOutside: s.free_ship_outside !== undefined ? s.free_ship_outside === '1' : env.FREE_SHIP_OUTSIDE === 'true',
    topbarText: s.topbar_text || '',
    footerText: s.footer_text || ''
  };
}
function stdShipping(c, zone, subtotal) {
  if (zone === 'outside') return c.freeShipOutside && subtotal >= c.freeShipMin ? 0 : c.feeOutside;
  return subtotal >= c.freeShipMin ? 0 : c.feeDhaka;
}
const userErr = (m) => Object.assign(new Error(m), { code: 'USER' });

/* Voucher check: runQuery = query (preview) ba transaction connection er query (order dewar somoy) */
async function evalVoucher(runQuery, codeRaw, subtotal, userId, lock) {
  const code = String(codeRaw || '').trim().toUpperCase();
  if (!code) return null;
  const [rows] = await runQuery(`SELECT * FROM vouchers WHERE code = ?${lock ? ' FOR UPDATE' : ''}`, [code]);
  const v = rows[0];
  if (!v || !v.is_active) throw userErr('This voucher code is not valid');
  if (v.expires_at) {
    const end = new Date(v.expires_at); end.setHours(23, 59, 59, 999);
    if (end < new Date()) throw userErr('This voucher has expired');
  }
  if (v.usage_limit != null && v.used_count >= v.usage_limit) throw userErr('This voucher has been fully used');
  if (subtotal < v.min_order) throw userErr(`Spend at least ৳${Number(v.min_order).toLocaleString('en-IN')} to use this voucher`);
  const [used] = await runQuery(
    "SELECT COUNT(*) AS n FROM orders WHERE user_id = ? AND voucher_code = ? AND status <> 'cancelled'", [userId, code]);
  if (used[0].n > 0) throw userErr('You have already used this voucher');
  let discount = 0, freeShipping = false;
  if (v.type === 'percent') {
    discount = Math.round((subtotal * v.value) / 100);
    if (v.max_discount != null) discount = Math.min(discount, v.max_discount);
  } else if (v.type === 'fixed') discount = Math.min(v.value, subtotal);
  else freeShipping = true;
  return { v, code, discount, freeShipping };
}

app.get('/api/config', h(async (req, res) => {
  const config = await getConfig();
  pub(req, res, 10);
  res.json({ config });
}));

/* ---------- health ---------- */
app.get('/api/health', h(async (req, res) => {
  await query('SELECT 1');
  res.json({ ok: true });
}));

/* ---------- catalog ---------- */
app.get('/api/categories', h(async (req, res) => {
  const [rows] = await query('SELECT id, name, slug, icon, has_sizes FROM categories ORDER BY sort_order, id');
  pub(req, res, 10);
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
  pub(req, res);
  res.json({ products: rows, total, page, limit });
}));

app.get('/api/products/:id', h(async (req, res) => {
  const [rows] = await query(`${PRODUCT_SELECT} WHERE p.id = ?`, [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Product not found' });
  const [related] = await query(
    `${PRODUCT_SELECT} WHERE p.category_id = ? AND p.id <> ? ORDER BY p.sold DESC LIMIT 8`,
    [rows[0].category_id, rows[0].id]);
  const [sizes] = await query('SELECT size, stock FROM product_sizes WHERE product_id = ? ORDER BY sort_order, id', [rows[0].id]);
  rows[0].sizes = sizes;
  pub(req, res);
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
app.post('/api/vouchers/check', auth, h(async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  if (!items.length) return res.status(400).json({ error: 'Your cart is empty' });
  const ids = items.map((i) => Number(i.id)).filter(Boolean);
  const [prods] = await query('SELECT id, price FROM products WHERE id IN (?)', [ids.length ? ids : [0]]);
  const price = Object.fromEntries(prods.map((p) => [p.id, p.price]));
  const subtotal = items.reduce((n, i) => n + (price[Number(i.id)] || 0) * Math.max(1, Math.min(20, parseInt(i.qty) || 1)), 0);
  try {
    const r = await evalVoucher(query, req.body.code, subtotal, req.user.id, false);
    if (!r) return res.status(400).json({ error: 'Enter a voucher code' });
    res.json({ code: r.code, type: r.v.type, discount: r.discount, freeShipping: r.freeShipping });
  } catch (e) {
    if (e.code === 'USER') return res.status(400).json({ error: e.message });
    throw e;
  }
}));

app.post('/api/orders', auth, h(async (req, res) => {
  const { items, name, phone, address, city } = req.body;
  const zone = req.body.zone === 'outside' ? 'outside' : req.body.zone === 'dhaka' ? 'dhaka' : null;
  if (!Array.isArray(items) || !items.length) return res.status(400).json({ error: 'Your cart is empty' });
  if (!zone) return res.status(400).json({ error: 'Choose your delivery area (inside or outside Dhaka)' });
  if (String(name || '').trim().length < 2) return res.status(400).json({ error: 'Enter the receiver name' });
  if (!/^(?:\+?88)?01[3-9]\d{8}$/.test(String(phone || '').trim())) {
    return res.status(400).json({ error: 'Enter a valid Bangladeshi mobile number (e.g. 017XXXXXXXX)' });
  }
  if (String(address || '').trim().length < 8) return res.status(400).json({ error: 'Enter your full delivery address' });
  if (String(city || '').trim().length < 2) return res.status(400).json({ error: 'Enter your area or district' });

  const conn = await connect();
  try {
    await conn.beginTransaction();
    let subtotal = 0;
    const lines = [];
    // Ek-i product+size bar bar thakle qty jog kore nao
    const want = new Map();
    for (const it of items.slice(0, 50)) {
      const id = Number(it.id), size = String(it.size || '').trim();
      const qty = Math.max(1, Math.min(20, parseInt(it.qty) || 1));
      const key = `${id}|${size.toLowerCase()}`;
      const w = want.get(key) || { id, size, qty: 0 };
      w.qty += qty; want.set(key, w);
    }
    for (const w of want.values()) {
      const [rows] = await conn.query('SELECT * FROM products WHERE id = ? FOR UPDATE', [w.id]);
      if (!rows.length) throw userErr('A product in your cart is no longer available');
      const p = rows[0];
      const [srows] = await conn.query('SELECT * FROM product_sizes WHERE product_id = ? FOR UPDATE', [p.id]);
      let sizeRow = null;
      if (srows.length) { // size wala product: size bachai must
        if (!w.size) throw userErr(`Please choose a size for "${p.title}"`);
        sizeRow = srows.find((z) => z.size.toLowerCase() === w.size.toLowerCase());
        if (!sizeRow) throw userErr(`Size ${w.size} is not available for "${p.title}"`);
        if (sizeRow.stock < w.qty) {
          throw userErr(sizeRow.stock > 0 ? `Only ${sizeRow.stock} left in size ${sizeRow.size} of "${p.title}"` : `Size ${sizeRow.size} of "${p.title}" is sold out`);
        }
      } else if (p.stock < w.qty) throw userErr(`Only ${p.stock} left of "${p.title}"`);
      subtotal += p.price * w.qty;
      lines.push({ p, qty: w.qty, sizeRow });
    }
    const vr = await evalVoucher((sql, params) => conn.query(sql, params), req.body.voucher_code, subtotal, req.user.id, true);
    const discount = vr ? vr.discount : 0;
    const conf = await getConfig((sql, params) => conn.query(sql, params));
    const shipping = vr && vr.freeShipping ? 0 : stdShipping(conf, zone, subtotal);
    const total = subtotal - discount + shipping;
    const [o] = await conn.query(
      `INSERT INTO orders (user_id,name,phone,address,city,zone,payment_method,subtotal,discount,voucher_code,shipping,shipping_mode,total,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,'auto',?,'pending')`,
      [req.user.id, String(name).trim(), String(phone).trim(), String(address).trim(), String(city).trim(),
       zone, 'cod', subtotal, discount, vr ? vr.code : null, shipping, total]);
    for (const { p, qty, sizeRow } of lines) {
      await conn.query(
        'INSERT INTO order_items (order_id,product_id,title,price,qty,size,image_url) VALUES (?,?,?,?,?,?,?)',
        [o.insertId, p.id, p.title, p.price, qty, sizeRow ? sizeRow.size : null, p.image_url]);
      await conn.query('UPDATE products SET stock = stock - ?, sold = sold + ? WHERE id = ?', [qty, qty, p.id]);
      if (sizeRow) await conn.query('UPDATE product_sizes SET stock = stock - ? WHERE id = ?', [qty, sizeRow.id]);
    }
    if (vr) await conn.query('UPDATE vouchers SET used_count = used_count + 1 WHERE id = ?', [vr.v.id]);
    await conn.commit();
    res.json({ id: o.insertId, total, shipping, discount });
  } catch (e) {
    await conn.rollback();
    if (e.code === 'USER') return res.status(400).json({ error: e.message });
    throw e;
  } finally {
    conn.end().catch(() => {});
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
  const stock = b.stock === '' || b.stock == null ? 0 : parseInt(b.stock);
  const categoryId = parseInt(b.category_id);
  if (title.length < 3) return { error: 'Product title is too short' };
  if (!(price > 0)) return { error: 'Enter a valid price' };
  if (oldPrice !== null && !(oldPrice >= 0)) return { error: 'Enter a valid old price' };
  if (!(stock >= 0)) return { error: 'Enter a valid stock number' };
  if (!(categoryId > 0)) return { error: 'Choose a category' };
  const img = String(b.image_url || '').trim();
  if (img && !/^https?:\/\//i.test(img)) return { error: 'Image link must start with http:// or https://' };
  return { r: { categoryId, title, description: String(b.description || '').trim(), price, oldPrice, stock, img: img || null, featured: b.is_featured ? 1 : 0 } };
}

function readSizes(list) {
  if (!Array.isArray(list) || !list.length) return { error: 'Add at least one size (choose "Free Size" if the item has only one)' };
  if (list.length > 30) return { error: 'Too many sizes (max 30)' };
  const seen = new Set(), out = [];
  for (const it of list) {
    const size = String((it && it.size) || '').trim().replace(/\s+/g, ' ');
    const stock = parseInt(it && it.stock);
    if (!size || size.length > 20) return { error: 'Each size must be 1-20 characters' };
    if (!(stock >= 0) || stock > 100000) return { error: `Enter a valid stock for size ${size}` };
    if (seen.has(size.toLowerCase())) return { error: `Size ${size} is added twice` };
    seen.add(size.toLowerCase()); out.push({ size, stock });
  }
  return { sizes: out };
}

// Product + tar size gulo ekshathe (transaction). Category te "has_sizes" thakle size dewa must, stock = shob size er jogfol.
async function saveProduct(id, r, sizesIn) {
  const conn = await connect();
  try {
    await conn.beginTransaction();
    const [crows] = await conn.query('SELECT has_sizes FROM categories WHERE id = ?', [r.categoryId]);
    if (!crows.length) throw userErr('Choose a category');
    let sizes = [];
    if (crows[0].has_sizes) {
      const sr = readSizes(sizesIn);
      if (sr.error) throw userErr(sr.error);
      sizes = sr.sizes;
    }
    const stock = sizes.length ? sizes.reduce((n, z) => n + z.stock, 0) : r.stock;
    if (id == null) {
      const [ins] = await conn.query(
        `INSERT INTO products (category_id,title,description,price,old_price,stock,image_url,is_featured,rating,sold)
         VALUES (?,?,?,?,?,?,?,?,4.5,0)`,
        [r.categoryId, r.title, r.description, r.price, r.oldPrice, stock, r.img, r.featured]);
      id = ins.insertId;
    } else {
      await conn.query(
        `UPDATE products SET category_id=?, title=?, description=?, price=?, old_price=?, stock=?, image_url=?, is_featured=? WHERE id=?`,
        [r.categoryId, r.title, r.description, r.price, r.oldPrice, stock, r.img, r.featured, id]);
    }
    await conn.query('DELETE FROM product_sizes WHERE product_id = ?', [id]);
    for (let i = 0; i < sizes.length; i++) {
      await conn.query('INSERT INTO product_sizes (product_id,size,stock,sort_order) VALUES (?,?,?,?)', [id, sizes[i].size, sizes[i].stock, i + 1]);
    }
    await conn.commit();
    return id;
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.end().catch(() => {});
  }
}

app.post('/api/admin/products', auth, admin, h(async (req, res) => {
  const p = readProduct(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  try { res.json({ id: await saveProduct(null, p.r, req.body.sizes) }); }
  catch (e) { if (e.code === 'USER') return res.status(400).json({ error: e.message }); throw e; }
}));

app.put('/api/admin/products/:id', auth, admin, h(async (req, res) => {
  const p = readProduct(req.body);
  if (p.error) return res.status(400).json({ error: p.error });
  try { await saveProduct(Number(req.params.id), p.r, req.body.sizes); res.json({ ok: true }); }
  catch (e) { if (e.code === 'USER') return res.status(400).json({ error: e.message }); throw e; }
}));

app.delete('/api/admin/products/:id', auth, admin, h(async (req, res) => {
  await query('DELETE FROM products WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
}));

/* ---------- admin: delivery charge per order + vouchers ---------- */
app.patch('/api/admin/orders/:id/shipping', auth, admin, h(async (req, res) => {
  const [rows] = await query('SELECT * FROM orders WHERE id = ?', [Number(req.params.id)]);
  if (!rows.length) return res.status(404).json({ error: 'Order not found' });
  const o = rows[0];
  const mode = req.body.mode;
  let shipping;
  if (mode === 'free') shipping = 0;
  else if (mode === 'custom') {
    shipping = Number(req.body.amount);
    if (!(shipping >= 0) || shipping > 100000) return res.status(400).json({ error: 'Enter a valid delivery charge' });
  } else if (mode === 'auto') {
    shipping = stdShipping(await getConfig(), o.zone, o.subtotal);
    if (o.voucher_code) {
      const [v] = await query('SELECT type FROM vouchers WHERE code = ?', [o.voucher_code]);
      if (v[0] && v[0].type === 'free_shipping') shipping = 0;
    }
  } else return res.status(400).json({ error: 'Invalid delivery option' });
  const total = o.subtotal - o.discount + shipping;
  await query('UPDATE orders SET shipping = ?, shipping_mode = ?, total = ? WHERE id = ?', [shipping, mode, total, o.id]);
  res.json({ shipping, total, shipping_mode: mode });
}));

app.get('/api/admin/vouchers', auth, admin, h(async (req, res) => {
  const [rows] = await query('SELECT * FROM vouchers ORDER BY id DESC LIMIT 200');
  res.json({ vouchers: rows });
}));

app.post('/api/admin/vouchers', auth, admin, h(async (req, res) => {
  const b = req.body;
  const code = String(b.code || '').trim().toUpperCase();
  const type = b.type;
  const value = Number(b.value || 0);
  const minOrder = Number(b.min_order || 0);
  const maxDisc = b.max_discount === '' || b.max_discount == null ? null : Number(b.max_discount);
  const limit = b.usage_limit === '' || b.usage_limit == null ? null : parseInt(b.usage_limit);
  const expires = b.expires_at ? String(b.expires_at) : null;
  if (!/^[A-Z0-9_-]{3,30}$/.test(code)) return res.status(400).json({ error: 'Code must be 3-30 letters or numbers (no spaces)' });
  if (!['percent', 'fixed', 'free_shipping'].includes(type)) return res.status(400).json({ error: 'Choose a voucher type' });
  if (type === 'percent' && !(value > 0 && value <= 100)) return res.status(400).json({ error: 'Percent must be between 1 and 100' });
  if (type === 'fixed' && !(value > 0)) return res.status(400).json({ error: 'Enter the discount amount' });
  if (!(minOrder >= 0)) return res.status(400).json({ error: 'Enter a valid minimum order' });
  if (maxDisc !== null && !(maxDisc > 0)) return res.status(400).json({ error: 'Enter a valid maximum discount' });
  if (limit !== null && !(limit > 0)) return res.status(400).json({ error: 'Usage limit must be 1 or more' });
  if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(expires)) return res.status(400).json({ error: 'Enter a valid expiry date' });
  try {
    const [r] = await query(
      `INSERT INTO vouchers (code,type,value,min_order,max_discount,usage_limit,expires_at,is_active) VALUES (?,?,?,?,?,?,?,1)`,
      [code, type, type === 'free_shipping' ? 0 : value, minOrder, type === 'percent' ? maxDisc : null, limit, expires]);
    res.json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'This voucher code already exists' });
    throw e;
  }
}));

app.patch('/api/admin/vouchers/:id', auth, admin, h(async (req, res) => {
  await query('UPDATE vouchers SET is_active = ? WHERE id = ?', [req.body.is_active ? 1 : 0, Number(req.params.id)]);
  res.json({ ok: true });
}));

app.delete('/api/admin/vouchers/:id', auth, admin, h(async (req, res) => {
  await query('DELETE FROM vouchers WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
}));

/* ---------- slideshow (hero) ---------- */
app.get('/api/slides', h(async (req, res) => {
  let rows = null; // null = table nai (migration hoyni) -> frontend default slide dekhabe
  try {
    [rows] = await query(`SELECT id, title, subtitle, button_text, button_link, theme, emoji, image_url
                          FROM slides WHERE is_active = 1 ORDER BY sort_order, id`);
  } catch (e) { if (e.code !== 'ER_NO_SUCH_TABLE') throw e; }
  pub(req, res, 10);
  res.json({ slides: rows });
}));

const THEMES = ['green', 'saffron', 'dark', 'blue', 'red'];
function readSlide(b) {
  const title = String(b.title || '').trim();
  const subtitle = String(b.subtitle || '').trim();
  const btnText = String(b.button_text || '').trim();
  const link = String(b.button_link || '').trim();
  const emoji = String(b.emoji || '').trim();
  const img = String(b.image_url || '').trim();
  if (title.length < 2 || title.length > 120) return { error: 'Headline must be 2-120 characters' };
  if (subtitle.length > 200) return { error: 'Sub text is too long (max 200)' };
  if (btnText.length > 40) return { error: 'Button text is too long (max 40)' };
  if (link && !/^(#\/|https?:\/\/)/i.test(link)) return { error: 'Button link must start with #/ or https://' };
  if (btnText && !link) return { error: 'Add a link for the button, or clear the button text' };
  if (emoji.length > 30) return { error: 'Emoji text is too long' };
  if (img && !/^https?:\/\//i.test(img)) return { error: 'Image link must start with https://' };
  if (!THEMES.includes(b.theme)) return { error: 'Choose a colour' };
  return { v: [title, subtitle || null, btnText || null, link || null, b.theme, emoji || null, img || null, b.is_active === false || b.is_active === 0 ? 0 : 1] };
}
app.get('/api/admin/slides', auth, admin, h(async (req, res) => {
  const [rows] = await query('SELECT * FROM slides ORDER BY sort_order, id');
  res.json({ slides: rows });
}));
app.post('/api/admin/slides', auth, admin, h(async (req, res) => {
  const r = readSlide(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  const [[{ m }]] = await query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM slides');
  const [ins] = await query(
    'INSERT INTO slides (title,subtitle,button_text,button_link,theme,emoji,image_url,is_active,sort_order) VALUES (?,?,?,?,?,?,?,?,?)',
    [...r.v, m + 1]);
  res.json({ id: ins.insertId });
}));
app.put('/api/admin/slides/:id', auth, admin, h(async (req, res) => {
  const r = readSlide(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  await query('UPDATE slides SET title=?, subtitle=?, button_text=?, button_link=?, theme=?, emoji=?, image_url=?, is_active=? WHERE id=?',
    [...r.v, Number(req.params.id)]);
  res.json({ ok: true });
}));
app.delete('/api/admin/slides/:id', auth, admin, h(async (req, res) => {
  await query('DELETE FROM slides WHERE id = ?', [Number(req.params.id)]);
  res.json({ ok: true });
}));
app.post('/api/admin/slides/reorder', auth, admin, h(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 50);
  for (let i = 0; i < ids.length; i++) await query('UPDATE slides SET sort_order = ? WHERE id = ?', [i + 1, ids[i]]);
  res.json({ ok: true });
}));

/* ---------- categories (admin) ---------- */
const slugify = (n) => String(n).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'category';
app.get('/api/admin/categories', auth, admin, h(async (req, res) => {
  const [rows] = await query(`SELECT c.id, c.name, c.slug, c.icon, c.has_sizes, c.sort_order, COUNT(p.id) AS products
    FROM categories c LEFT JOIN products p ON p.category_id = c.id GROUP BY c.id ORDER BY c.sort_order, c.id`);
  res.json({ categories: rows });
}));
app.post('/api/admin/categories', auth, admin, h(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const icon = String(req.body.icon || '').trim() || '🛍️';
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Category name must be 2-40 characters' });
  if (icon.length > 16) return res.status(400).json({ error: 'Icon should be a single emoji' });
  let slug = slugify(name);
  for (let i = 2; i < 30; i++) {
    const [ex] = await query('SELECT id FROM categories WHERE slug = ?', [slug]);
    if (!ex.length) break;
    slug = `${slugify(name)}-${i}`;
  }
  const [[{ m }]] = await query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM categories');
  const [ins] = await query('INSERT INTO categories (name, slug, icon, has_sizes, sort_order) VALUES (?,?,?,?,?)', [name, slug, icon, req.body.has_sizes ? 1 : 0, m + 1]);
  res.json({ id: ins.insertId });
}));
app.put('/api/admin/categories/:id', auth, admin, h(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const icon = String(req.body.icon || '').trim() || '🛍️';
  if (name.length < 2 || name.length > 40) return res.status(400).json({ error: 'Category name must be 2-40 characters' });
  if (icon.length > 16) return res.status(400).json({ error: 'Icon should be a single emoji' });
  await query('UPDATE categories SET name = ?, icon = ?, has_sizes = ? WHERE id = ?', [name, icon, req.body.has_sizes ? 1 : 0, Number(req.params.id)]);
  res.json({ ok: true });
}));
app.delete('/api/admin/categories/:id', auth, admin, h(async (req, res) => {
  const id = Number(req.params.id);
  const [[{ n }]] = await query('SELECT COUNT(*) AS n FROM products WHERE category_id = ?', [id]);
  if (n > 0) return res.status(409).json({ error: `This category has ${n} product(s). Move or delete them first.` });
  await query('DELETE FROM categories WHERE id = ?', [id]);
  res.json({ ok: true });
}));
app.post('/api/admin/categories/reorder', auth, admin, h(async (req, res) => {
  const ids = (Array.isArray(req.body.ids) ? req.body.ids : []).map(Number).filter(Boolean).slice(0, 100);
  for (let i = 0; i < ids.length; i++) await query('UPDATE categories SET sort_order = ? WHERE id = ?', [i + 1, ids[i]]);
  res.json({ ok: true });
}));

/* ---------- site settings (admin) ---------- */
app.get('/api/admin/settings', auth, admin, h(async (req, res) => {
  res.json({ settings: await getConfig() });
}));
app.put('/api/admin/settings', auth, admin, h(async (req, res) => {
  const b = req.body || {};
  const str = (v, max) => String(v == null ? '' : v).trim().slice(0, max);
  const siteName = str(b.siteName, 40);
  const email = str(b.supportEmail, 120);
  const phone = str(b.supportPhone, 30);
  const feeDhaka = Number(b.feeDhaka), feeOutside = Number(b.feeOutside), freeMin = Number(b.freeShipMin);
  if (siteName.length < 2) return res.status(400).json({ error: 'Enter your shop name' });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid support email' });
  if (!(feeDhaka >= 0 && feeDhaka <= 10000)) return res.status(400).json({ error: 'Enter a valid Dhaka delivery charge' });
  if (!(feeOutside >= 0 && feeOutside <= 10000)) return res.status(400).json({ error: 'Enter a valid outside-Dhaka delivery charge' });
  if (!(freeMin >= 0 && freeMin <= 10000000)) return res.status(400).json({ error: 'Enter a valid free-delivery minimum' });
  const rows = [
    ['site_name', siteName], ['support_email', email], ['support_phone', phone],
    ['fee_dhaka', String(feeDhaka)], ['fee_outside', String(feeOutside)], ['free_ship_min', String(freeMin)],
    ['free_ship_outside', b.freeShipOutside ? '1' : '0'],
    ['topbar_text', str(b.topbarText, 140)], ['footer_text', str(b.footerText, 200)]
  ];
  await query('INSERT INTO settings (k, v) VALUES ? ON DUPLICATE KEY UPDATE v = VALUES(v)', [rows]);
  res.json({ settings: await getConfig() });
}));

/* ---------- Cloudinary signed upload (admin only) ----------
   Browser theke sorasori Cloudinary te upload hoy; secret kokhono browser e ashe na. */
app.get('/api/admin/upload-signature', auth, admin, (req, res) => {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) {
    return res.status(503).json({ error: 'Photo upload is not set up yet. Add the CLOUDINARY_* variables in Vercel and redeploy.' });
  }
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = process.env.CLOUDINARY_FOLDER || 'rumedio-shop/products';
  const signature = crypto.createHash('sha1').update(`folder=${folder}&timestamp=${timestamp}${secret}`).digest('hex');
  res.json({ cloud_name: cloud, api_key: key, timestamp, folder, signature });
});

/* ---------- errors ---------- */
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => { // eslint-disable-line
  console.error(err);
  res.set('Cache-Control', 'no-store');
  if (err.message === 'DB_NOT_CONFIGURED') {
    return res.status(500).json({ error: 'Database is not configured. Set DB_* environment variables.' });
  }
  if (err.code === 'ER_NO_SUCH_TABLE' || err.code === 'ER_BAD_FIELD_ERROR') {
    return res.status(500).json({ error: 'Database is not up to date. Import rumedio_database.sql, or run database/migrations/002_vouchers_delivery_site_settings.sql in phpMyAdmin.' });
  }
  if (['ECONNREFUSED', 'ETIMEDOUT', 'ER_ACCESS_DENIED_ERROR', 'ENOTFOUND', 'ER_USER_LIMIT_REACHED', 'ER_CON_COUNT_ERROR', 'ER_TOO_MANY_USER_CONNECTIONS'].includes(err.code)) {
    return res.status(503).json({ error: 'Cannot reach the database right now. Please try again in a moment.' });
  }
  res.status(500).json({ error: 'Server error. Please try again.' });
});

module.exports = app;
