'use strict';

const os = require('os');
const path = require('path');

// La configuración NO vive junto al ejecutable: el instalador pone la app en
// Program Files, donde un usuario normal no puede escribir. Va en el directorio
// de datos de la cuenta, que es la convención de Windows y además mantiene la
// configuración separada por usuario en un equipo compartido.
const dataDir = () => {
  if (process.env.DRIVESIDIAN_DATA_DIR) return process.env.DRIVESIDIAN_DATA_DIR;

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'Drivesidian');
  }

  // Solo Windows está en el alcance del MVP, pero el agente corre igual en
  // Linux y macOS durante el desarrollo.
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'drivesidian');
};

const configFile = () => path.join(dataDir(), 'config.json');

// Carpeta de Obsidian que se sincroniza. El resto del vault se ignora.
const SYNCED_FOLDER = 'Drivesidian';

module.exports = { dataDir, configFile, SYNCED_FOLDER };
