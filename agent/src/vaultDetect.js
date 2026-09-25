'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { SYNCED_FOLDER } = require('./paths');

// Obsidian mantiene el registro de sus vaults en un JSON propio. Leerlo es lo
// que permite que el instalador no pregunte ninguna ruta: el usuario final no
// es programador y no debería andar buscando carpetas.
//
// Verificado en Windows: %APPDATA%\obsidian\obsidian.json contiene
//   {"vaults":{"<id>":{"path":"C:\\Users\\...\\Notas","ts":...,"open":true}}}
const registroObsidian = () => {
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'obsidian', 'obsidian.json');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json');
  }
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
  return path.join(base, 'obsidian', 'obsidian.json');
};

// Devuelve [{ name, path }]. Lista vacía si Obsidian no está instalado, si
// nunca se abrió, o si el archivo no se puede leer — ninguno de esos casos es
// un error: simplemente se le preguntará al usuario.
const detectarVaults = () => {
  const ruta = registroObsidian();

  let registro;
  try {
    registro = JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch {
    return [];
  }

  const vaults = registro && typeof registro.vaults === 'object' ? registro.vaults : {};

  return Object.values(vaults)
    .filter((v) => v && typeof v.path === 'string')
    // Un vault que ya no existe en disco (carpeta movida o borrada) se queda
    // en el registro de Obsidian, así que hay que comprobarlo.
    .filter((v) => {
      try {
        return fs.statSync(v.path).isDirectory();
      } catch {
        return false;
      }
    })
    .map((v) => ({ name: path.basename(v.path), path: v.path, lastOpened: v.ts || 0 }))
    // El más recientemente abierto primero: si hay que elegir uno solo, es el
    // candidato más probable.
    .sort((a, b) => b.lastOpened - a.lastOpened)
    .map(({ name, path: ruta_ }) => ({ name, path: ruta_ }));
};

// La carpeta vigilada dentro del vault. Se crea si no existe para que el
// usuario tenga dónde escribir desde el primer momento, en lugar de tener que
// adivinar que debe crearla con ese nombre exacto.
const asegurarCarpetaSincronizada = (vaultPath) => {
  const carpeta = path.join(vaultPath, SYNCED_FOLDER);
  fs.mkdirSync(carpeta, { recursive: true });
  return carpeta;
};

module.exports = { detectarVaults, asegurarCarpetaSincronizada, registroObsidian };
