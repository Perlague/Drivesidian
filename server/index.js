'use strict';

require('dotenv').config();
const express = require('express');
const { success } = require('./src/utils/response');
const { startSyncWorker } = require('./src/workers/syncWorker');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/health', (req, res) => {
  success(res, { status: 'ok' });
});

app.use('/api/users', require('./src/routes/users.routes'));
app.use('/api/notes', require('./src/routes/notes.routes'));
app.use('/api/agent-tokens', require('./src/routes/agentTokens.routes'));

app.listen(PORT, () => {
  console.log(`Drivesidian server escuchando en el puerto ${PORT}`);
});

startSyncWorker();
