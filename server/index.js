'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const { success } = require('./src/utils/response');
const { startSyncWorker } = require('./src/workers/syncWorker');
const { startRetentionWorker } = require('./src/workers/retentionWorker');

const app = express();
const PORT = process.env.PORT || 3000;

// Detrás de Caddy, req.ip es la IP del proxy salvo que Express confíe en el
// X-Forwarded-For — y esa IP es justo el dato que necesitan el rate limiting y
// los eventos de seguridad. Va por variable de entorno y apagado por defecto
// porque confiar en ese header SIN un proxy delante deja que cualquier cliente
// falsifique su propia IP. En producción con Caddy: TRUST_PROXY=1 (un salto).
if (process.env.TRUST_PROXY) {
  const trustProxy = Number(process.env.TRUST_PROXY);
  app.set('trust proxy', Number.isNaN(trustProxy) ? process.env.TRUST_PROXY : trustProxy);
}

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
startRetentionWorker();
