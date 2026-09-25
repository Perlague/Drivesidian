'use strict';

const log = require('./log');
const config = require('./config');
const { vincular } = require('./pairing');
const { detectarVaults, asegurarCarpetaSincronizada } = require('./vaultDetect');
const { ColaDeSync } = require('./api');
const { iniciarWatcher } = require('./watcher');

let watcher = null;

const arrancar = async () => {
  log.info('Drivesidian — agente local');

  let { apiUrl, agentToken, vaultPath } = config.cargar();
  log.info(`Servidor: ${apiUrl}`);

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

  const cola = new ColaDeSync({
    apiUrl,
    agentToken,
    onTokenInvalido: () => {
      // Se olvida el token para que el próximo arranque vuelva a vincular, en
      // vez de quedarse reintentando contra un acceso que ya no existe.
      config.olvidarToken();
      log.error('Reinicia el agente para vincular este equipo de nuevo.');
      if (watcher) watcher.close();
      process.exitCode = 1;
    },
  });

  watcher = iniciarWatcher(vaultPath, cola);
};

const apagar = (senal) => {
  log.info(`Recibido ${senal}, cerrando.`);
  if (watcher) watcher.close();
  process.exit(0);
};

process.on('SIGINT', () => apagar('SIGINT'));
process.on('SIGTERM', () => apagar('SIGTERM'));

arrancar().catch((err) => {
  log.error(err.message);
  process.exit(1);
});
