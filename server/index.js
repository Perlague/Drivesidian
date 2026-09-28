'use strict';

require('dotenv').config();
const app = require('./src/app');
const { startSyncWorker } = require('./src/workers/syncWorker');
const { startRetentionWorker } = require('./src/workers/retentionWorker');
const { iniciarResolucion, getFuente } = require('./src/utils/publicUrl');

const PORT = process.env.PORT || 3000;

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
