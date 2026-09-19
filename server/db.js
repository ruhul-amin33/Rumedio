const mysql = require('mysql2/promise');

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
      throw new Error('DB_NOT_CONFIGURED');
    }
    pool = mysql.createPool({
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME,
      charset: 'utf8mb4',
      waitForConnections: true,
      // freedb.tech e connection limit kom, tai 1 ta rakha hoyeche
      connectionLimit: 1,
      maxIdle: 1,
      idleTimeout: 10000,
      queueLimit: 0,
      connectTimeout: 15000,
      decimalNumbers: true,
      // Kono DB provider SSL chaile .env e DB_SSL=true din
      ssl: process.env.DB_SSL === 'true' ? { minVersion: 'TLSv1.2', rejectUnauthorized: true } : undefined
    });
  }
  return pool;
}

const query = (sql, params) => getPool().query(sql, params);

module.exports = { getPool, query };
