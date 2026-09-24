'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const { success, error } = require('./src/utils/response');
const { MAX_REQUEST_BODY } = require('./src/config');
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

// Sin límite explícito, express.json usa 100 kb por defecto y rechaza con un
// 413 poco claro cualquier nota medianamente grande. Ver MAX_REQUEST_BODY.
app.use(express.json({ limit: MAX_REQUEST_BODY }));

// Al rebasar ese límite, express.json lanza un PayloadTooLargeError y Express
// responde con su página HTML por defecto, que incluye el stack y la ruta
// absoluta del servidor. El manejador central de errores llega en otro paso;
// esto cubre el caso concreto que abre este límite, con el formato JSON del
// resto de la API para que el agente pueda leerlo.
app.use((err, req, res, next) => {
  if (err && err.type === 'entity.too.large') {
    return error(res, `El cuerpo de la petición excede el máximo de ${MAX_REQUEST_BODY}.`, 413);
  }
  return next(err);
});

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
