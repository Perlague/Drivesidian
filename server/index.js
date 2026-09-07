'use strict';

require('dotenv').config();
const express = require('express');
const { success } = require('./src/utils/response');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  success(res, { status: 'ok' });
});

app.use('/api/users', require('./src/routes/users.routes'));

app.listen(PORT, () => {
  console.log(`Drivesidian server escuchando en el puerto ${PORT}`);
});
