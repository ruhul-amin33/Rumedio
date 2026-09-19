// Local development: npm run dev  ->  http://localhost:3000
require('dotenv').config();
const path = require('path');
const express = require('express');
const app = require('./app');

const root = express();
root.use(app);
root.use(express.static(path.join(__dirname, '..', 'public')));
const port = process.env.PORT || 3000;
root.listen(port, () => console.log(`BazarGhor running on http://localhost:${port}`));
