'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const { success } = require('./src/utils/response');
const { startSyncWorker } = require('./src/workers/syncWorker');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

// web/ vive en su propia carpeta del monorepo, pero se sirve desde este
// mismo proceso Express (sin build step, sin servidor aparte).
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'web', 'views'));
app.use(express.static(path.join(__dirname, '..', 'web', 'public')));

app.get('/health', (req, res) => {
  success(res, { status: 'ok' });
});

// Borrador del editor, todavía sin requireAuth ni datos reales de notes.
app.get('/editor', (req, res) => {
  res.render('editor');
});

app.use('/api/users', require('./src/routes/users.routes'));
app.use('/api/notes', require('./src/routes/notes.routes'));
app.use('/api/agent-tokens', require('./src/routes/agentTokens.routes'));

app.listen(PORT, () => {
  console.log(`Drivesidian server escuchando en el puerto ${PORT}`);
});

startSyncWorker();
