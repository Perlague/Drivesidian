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

// Ruta desconocida: responde en el mismo formato que el resto de la API en vez
// de la página HTML por defecto de Express.
app.use((req, res) => {
  error(res, `No existe ${req.method} ${req.originalUrl}.`, 404);
});

// Manejador central de errores. Va al final, con los cuatro parámetros que
// Express usa para reconocerlo. Express 5 ya reenvía aquí los rejects de los
// controllers async, así que no hace falta envolverlos en try/catch.
//
// Nunca se le manda el stack al cliente: la página de error por defecto de
// Express incluye la ruta absoluta del servidor, que es información que no
// tiene por qué salir. El detalle se queda en el log.
app.use((err, req, res, next) => {
  // El body-parser falla antes de llegar a ninguna ruta, así que su error
  // también desemboca aquí.
  if (err.type === 'entity.too.large') {
    return error(res, `El cuerpo de la petición excede el máximo de ${MAX_REQUEST_BODY}.`, 413);
  }
  if (err.type === 'entity.parse.failed') {
    return error(res, 'El cuerpo de la petición no es JSON válido.', 400);
  }

  console.error(`[error] ${req.method} ${req.originalUrl}:`, err.stack || err.message);

  // Si la respuesta ya empezó a enviarse no se puede cambiar el status; lo
  // único correcto es dejar que Express cierre la conexión.
  if (res.headersSent) return next(err);

  return error(res, 'Error interno del servidor.', 500);
});

app.listen(PORT, () => {
  console.log(`Drivesidian server escuchando en el puerto ${PORT}`);
});

startSyncWorker();
startRetentionWorker();
