'use strict';

const fs = require('fs/promises');
const path = require('path');
const chokidar = require('chokidar');
const log = require('./log');
const { SYNCED_FOLDER } = require('./paths');

// Obsidian guarda muy seguido y en varios pasos (escribe, trunca, vuelve a
// escribir), así que un evento por sí solo no significa que el archivo esté
// completo. awaitWriteFinish espera a que deje de crecer antes de avisar, que
// es más fiable que un debounce a mano: mide el archivo, no el reloj.
const ESTABILIDAD_MS = 2000;

// vault_path se manda SIEMPRE con barras normales, aunque el agente corra en
// Windows. Es lo que acaba siendo la ruta dentro del repo de GitHub.
const rutaRelativa = (vaultPath, archivo) =>
  path.relative(vaultPath, archivo).split(path.sep).join('/');

const iniciarWatcher = (vaultPath, cola) => {
  const carpeta = path.join(vaultPath, SYNCED_FOLDER);

  const watcher = chokidar.watch(carpeta, {
    // ignoreInitial en false a propósito: al arrancar recorre lo que ya hay y
    // lo reporta. El servidor descarta lo que no cambió comparando
    // content_hash, así que un reinicio no genera ni un commit de más.
    ignoreInitial: false,
    awaitWriteFinish: {
      stabilityThreshold: ESTABILIDAD_MS,
      pollInterval: 100,
    },
    // Los archivos internos de Obsidian no son notas del usuario.
    ignored: (ruta) => ruta.includes(`${path.sep}.obsidian${path.sep}`) || ruta.includes(`${path.sep}.trash${path.sep}`),
  });

  const reportar = async (archivo) => {
    if (path.extname(archivo).toLowerCase() !== '.md') return;

    let contenido;
    try {
      contenido = await fs.readFile(archivo, 'utf8');
    } catch (err) {
      // El archivo pudo desaparecer entre el evento y la lectura.
      log.warn(`No se pudo leer "${archivo}": ${err.message}`);
      return;
    }

    cola.encolar(rutaRelativa(vaultPath, archivo), contenido);
  };

  watcher.on('add', reportar);
  watcher.on('change', reportar);

  // No hay borrado de notas en el MVP: ni endpoint en la API ni lógica en el
  // worker de sync. Se registra para que quede rastro de que pasó, pero el
  // registro en Postgres y el archivo en GitHub se quedan como estaban.
  watcher.on('unlink', (archivo) => {
    log.info(`Archivo eliminado en disco (no se borra del servidor): ${rutaRelativa(vaultPath, archivo)}`);
  });

  watcher.on('error', (err) => log.error(`Error del vigilante de archivos: ${err.message}`));
  watcher.on('ready', () => log.info(`Vigilando ${carpeta}`));

  return watcher;
};

module.exports = { iniciarWatcher, rutaRelativa };
