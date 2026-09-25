'use strict';

const log = require('./log');
const config = require('./config');
const secureStore = require('./secureStore');
const { vincular } = require('./pairing');
const { detectarVaults, asegurarCarpetaSincronizada } = require('./vaultDetect');
const { ColaDeSync } = require('./api');
const { iniciarWatcher } = require('./watcher');
const stateIndex = require('./stateIndex');
const { reconciliar, iniciarBajada } = require('./downstream');

let watcher = null;
let pararBajada = null;

const detener = () => {
  if (watcher) watcher.close();
  if (pararBajada) pararBajada();
};

const arrancar = async () => {
  log.info('Drivesidian — agente local');

  let { apiUrl, agentToken, vaultPath, tokenEnClaro } = config.cargar();
  log.info(`Servidor: ${apiUrl}`);

  // Un agente instalado antes de que existiera el cifrado tiene su acceso en
  // texto plano. Se migra solo, sin que el usuario tenga que hacer nada.
  if (agentToken && tokenEnClaro && secureStore.disponible()) {
    if (config.cifrarTokenExistente(agentToken)) {
      log.info('El acceso de este equipo se cifró en disco.');
    }
  }

  // Sin token, lo primero es vincular el equipo. El instalador no pide nada:
  // todo se resuelve aquí, abriendo el navegador.
  if (!agentToken) {
    const vinculado = await vincular(apiUrl);
    agentToken = vinculado.agentToken;
    vaultPath = vinculado.vaultPath;
  }

  // Puede faltar si se vinculó en un equipo sin Obsidian y luego se instaló.
  if (!vaultPath) {
    const vaults = detectarVaults();
    if (vaults.length === 0) {
      throw new Error(
        'No se encontró ningún vault de Obsidian. Abre Obsidian una vez y reinicia el agente.',
      );
    }
    vaultPath = vaults[0].path;
    config.guardar({ vaultPath });
    log.info(`Vault elegido automáticamente: ${vaultPath}`);
  }

  // Se crea la carpeta si no existe para que el usuario tenga dónde escribir
  // desde el primer momento.
  asegurarCarpetaSincronizada(vaultPath);

  const onTokenInvalido = () => {
    // Se olvida el token para que el próximo arranque vuelva a vincular, en
    // vez de quedarse reintentando contra un acceso que ya no existe.
    config.olvidarToken();
    log.error('Reinicia el agente para vincular este equipo de nuevo.');
    detener();
    process.exitCode = 1;
  };

  const cola = new ColaDeSync({ apiUrl, agentToken, onTokenInvalido });
  const contexto = { apiUrl, agentToken, onTokenInvalido };

  // Sin índice el agente no sabe qué sincronizó, así que no puede imponer su
  // estado en ninguna dirección: reconcilia comparando contenido antes de
  // tocar el disco o subir nada.
  const cursor = stateIndex.estabaPresente()
    ? null
    : await reconciliar(contexto, vaultPath, cola);

  // El watcher va DESPUÉS de la reconciliación: si arrancara antes, vería las
  // escrituras de esa reconciliación como cambios del usuario.
  watcher = iniciarWatcher(vaultPath, cola);
  pararBajada = iniciarBajada(contexto, vaultPath, cursor);
};

const apagar = (senal) => {
  log.info(`Recibido ${senal}, cerrando.`);
  detener();
  process.exit(0);
};

process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));

arrancar().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
