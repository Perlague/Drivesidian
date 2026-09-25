'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');
const log = require('./log');

// Memoria de lo que el agente sincronizó: para cada ruta, el hash del
// contenido y la versión que tenía el servidor.
//
// Sin esto el agente no puede distinguir «el archivo local no cambió» de
// «cambiaron los dos lados», que es exactamente lo que separa una escritura
// segura de un conflicto. También es lo que le permite mandar `base_version`,
// sin el cual el servidor se niega a sobrescribir una nota existente.
//
// Y resuelve el bucle del watcher: el hash se apunta ANTES de escribir un
// archivo, así que cuando chokidar avisa del cambio, el agente reconoce su
// propia escritura y la ignora. Sin temporizadores ni listas de rutas
// suprimidas.

const archivoIndice = () => path.join(dataDir(), 'state.json');

const hashDe = (contenido) => crypto.createHash('sha256').update(contenido).digest('hex');

let entradas = null; // ruta -> { hash, version }
let existiaAlArrancar = false;

const cargar = () => {
  if (entradas) return entradas;

  try {
    const crudo = JSON.parse(fs.readFileSync(archivoIndice(), 'utf8'));
    entradas = crudo && typeof crudo === 'object' ? crudo : {};
    existiaAlArrancar = true;
  } catch {
    // Falta o está corrupto. No se asume nada: el agente reconcilia contra el
    // servidor antes de tocar el disco o subir nada.
    entradas = {};
    existiaAlArrancar = false;
  }

  return entradas;
};

// Escritura atómica: archivo temporal y rename. Un corte de luz a media
// escritura dejaría un JSON truncado, y eso obligaría a reconciliar el vault
// entero en el siguiente arranque.
const persistir = () => {
  const destino = archivoIndice();
  const temporal = `${destino}.tmp`;

  try {
    fs.mkdirSync(path.dirname(destino), { recursive: true });
    fs.writeFileSync(temporal, `${JSON.stringify(entradas, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporal, destino);
  } catch (err) {
    log.error(`No se pudo guardar el índice de sincronización: ${err.message}`);
  }
};

const obtener = (vaultPath) => cargar()[vaultPath] || null;

// Registra una nota y persiste de inmediato. Se usa tras subir o escribir una
// nota suelta: la ventana entre la operación y el guardado es justo donde un
// corte dejaría el índice desfasado.
const registrar = (vaultPath, hash, version) => {
  cargar()[vaultPath] = { hash, version };
  persistir();
};

// Para tandas —la reconciliación inicial, o una bajada de 200 notas—: se
// apuntan todas y se persiste una sola vez, en vez de reescribir el archivo
// entero por cada nota.
const registrarVarios = (registros) => {
  const actuales = cargar();
  for (const { vaultPath, hash, version } of registros) {
    actuales[vaultPath] = { hash, version };
  }
  persistir();
};

const olvidar = (vaultPath) => {
  delete cargar()[vaultPath];
  persistir();
};

const rutas = () => Object.keys(cargar());

// false cuando el índice no existía o estaba corrupto: el agente tiene que
// reconciliar antes de hacer nada.
const estabaPresente = () => {
  cargar();
  return existiaAlArrancar;
};

// Solo para pruebas: descarta el índice en memoria y obliga a releerlo.
const reiniciar = () => {
  entradas = null;
  existiaAlArrancar = false;
};

module.exports = {
  hashDe,
  obtener,
  registrar,
  registrarVarios,
  olvidar,
  rutas,
  estabaPresente,
  reiniciar,
  archivoIndice,
};
