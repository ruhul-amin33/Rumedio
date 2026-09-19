// Usage: npm run setup-db        (table + demo data, jodi khali thake)
//        npm run setup-db:force  (demo data abar dhukabe)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

(async () => {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    charset: 'utf8mb4',
    multipleStatements: true
  });
  const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'database', f), 'utf8');
  console.log('Creating tables...');
  await conn.query(read('schema.sql'));
  const [[{ n }]] = await conn.query('SELECT COUNT(*) AS n FROM categories');
  if (n === 0 || process.argv.includes('--force')) {
    console.log('Inserting demo data...');
    await conn.query(read('seed.sql'));
  } else {
    console.log('Data already exists. Skipped seed (use setup-db:force to re-insert).');
  }
  await conn.end();
  console.log('Done.');
})().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
