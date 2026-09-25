'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');
const { success, error } = require('./src/utils/response');
const { MAX_REQUEST_BODY } = require('./src/config');
const { startSyncWorker } = require('./src/workers/syncWorker');
const { startRetentionWorker } = require('./src/workers/retentionWorker');
const securityHeaders = require('./src/middleware/securityHeaders');
const { iniciarResolucion, getFuente } = require('./src/utils/publicUrl');

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

// Antes de cualquier ruta, para que los apliquen también las respuestas de
// error y los archivos estáticos. Estaban en el Caddyfile hasta que se añadió
// el despliegue con ngrok, que no pasa por Caddy.
app.use(securityHeaders);

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

app.use('/api/users', require('./src/routes/users.routes'));
app.use('/api/notes', require('./src/routes/notes.routes'));
app.use('/api/agent-tokens', require('./src/routes/agentTokens.routes'));
app.use('/api/pairing', require('./src/routes/pairing.routes'));
app.use('/api/admin', require('./src/routes/admin.routes'));

// Las páginas del panel van al final, para que nada bajo /api caiga aquí.
app.use('/', require('./src/routes/pages.routes'));

// Ruta desconocida. Las peticiones a la API reciben JSON; un navegador que
// pidió HTML recibe una página, no un objeto suelto en pantalla.
app.use((req, res) => {
  if (req.originalUrl.startsWith('/api/') || !req.accepts('html')) {
    return error(res, `No existe ${req.method} ${req.originalUrl}.`, 404);
  }
  return res.status(404).render('error', {
    title: 'Página no encontrada',
    codigo: 404,
    mensaje: 'Esa página no existe.',
  });
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

// El banner del arranque. Existe porque con ngrok la URL pública la asigna el
// túnel al azar en cada arranque: si el log no la dice, no hay forma de saber a
// dónde conectarse sin ir a buscarla al panel de ngrok.
const anunciar = ({ url, fuente }) => {
  const linea = '─'.repeat(64);
  const origen = {
    ngrok: 'túnel de ngrok, detectado solo',
    PUBLIC_URL: 'PUBLIC_URL del entorno',
    DOMAIN: 'DOMAIN del entorno',
    local: 'sin URL pública configurada',
  }[fuente] || fuente;

  console.log(`
${linea}`);
  console.log('  Drivesidian está arriba.');
  console.log('');
  console.log(`  Panel web:   ${url}`);
  console.log(`  Origen:      ${origen}`);
  console.log('');
  console.log('  Para vincular un equipo, el agente necesita esta URL:');
  console.log(`      DRIVESIDIAN_API_URL=${url}`);

  if (fuente === 'local') {
    console.log('');
    console.log('  Ojo: esta URL solo sirve desde esta misma máquina. Para que el');
    console.log('  agente de otro equipo llegue, levanta ngrok o pon PUBLIC_URL.');
  }

  console.log(`${linea}
`);
};

app.listen(PORT, async () => {
  console.log(`Drivesidian server escuchando en el puerto ${PORT}`);

  // Se resuelve después de escuchar, no antes: con ngrok esto puede tardar unos
  // segundos y el servidor ya puede atender peticiones mientras tanto.
  const { url } = await iniciarResolucion();
  anunciar({ url, fuente: getFuente() });
});

startSyncWorker();
startRetentionWorker();
