/* Database connection helper (freedb.tech-er jonno khub sabdhane banano)
 *
 * Shomossha: freedb.tech e ekta user er max_user_connections khub kom.
 * Vercel e ekhon jotogulo function instance, protyekta connection dhore rakhle limit shesh hoye jay.
 *
 * Somadhan:
 *  1. Protyek request er jonno ekta connection khola hoy, request sesh hole sathe sathe bondho hoy
 *     (kono connection "ghumiye" theke slot atkaye rakhe na).
 *  2. Limit e thakle kichukkhon opekkha kore abar chesta kora hoy.
 */
const mysql = require('mysql2/promise');
const { AsyncLocalStorage } = require('async_hooks');

const als = new AsyncLocalStorage();

function config() {
  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
    throw new Error('DB_NOT_CONFIGURED');
  }
  return {
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    connectTimeout: 15000,
    decimalNumbers: true,
    // Kono DB provider SSL chaile .env e DB_SSL=true din
    ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
  };
}

const isBusy = (e) => e && (e.errno === 1203 || e.errno === 1040 ||
  e.code === 'ER_TOO_MANY_USER_CONNECTIONS' || e.code === 'ER_CON_COUNT_ERROR' || e.code === 'ER_USER_LIMIT_REACHED');

/** Notun connection kholo. Limit e thakle 5 bar porjonto opekkha kore chesta kore. */
async function connect() {
  let last;
  for (let i = 0; i < 5; i++) {
    try {
      return await mysql.createConnection(config());
    } catch (e) {
      last = e;
      if (!isBusy(e)) throw e;
      await new Promise((r) => setTimeout(r, 250 * (i + 1) + Math.random() * 200));
    }
  }
  throw last;
}

/** Express middleware: request er shuru te scope khole, sesh hole connection bondho kore. */
function dbScope(req, res, next) {
  const store = { p: null };
  const done = () => {
    if (store.p) {
      store.p.then((c) => c.end()).catch(() => {});
      store.p = null;
    }
  };
  res.on('close', done);
  res.on('finish', done);
  als.run(store, next);
}

async function query(sql, params) {
  const store = als.getStore();
  if (!store) { // scope er baire chalale ekbar-er connection
    const c = await connect();
    try { return await c.query(sql, params); } finally { c.end().catch(() => {}); }
  }
  if (!store.p) {
    store.p = connect();
    store.p.catch(() => { store.p = null; }); // fail hole porer query abar chesta korte pare
  }
  const conn = await store.p;
  return conn.query(sql, params);
}

module.exports = { connect, query, dbScope };
