'use strict';

// Entorno de pruebas del agente. Se importa ANTES que cualquier módulo de src:
// log.js calcula la ruta de su archivo al cargarse, y sin esto las pruebas
// escribirían en el %APPDATA%\Drivesidian real de quien las corre.

const fs = require('fs');
const os = require('os');
const path = require('path');

const RAIZ = fs.mkdtempSync(path.join(os.tmpdir(), 'drivesidian-agente-'));
process.env.DRIVESIDIAN_DATA_DIR = path.join(RAIZ, 'datos');
process.env.DRIVESIDIAN_PAIR_POLL_MS = '5';
process.env.DRIVESIDIAN_WRITE_STABILITY_MS = '50';
// Obsidian también se busca en carpetas temporales, nunca en la instalación real.
process.env.APPDATA = path.join(RAIZ, 'appdata');
process.env.XDG_CONFIG_HOME = path.join(RAIZ, 'xdg');
delete process.env.DRIVESIDIAN_API_URL;

// El log del agente va a consola; aquí se captura para poder comprobarlo.
const lineas = [];
const verTodo = Boolean(process.env.DEBUG_TESTS);
const logOriginal = console.log;
const errorOriginal = console.error;
console.log = (...a) => {
  lineas.push(a.join(' '));
  if (verTodo) logOriginal(...a);
};
console.error = (...a) => {
  lineas.push(a.join(' '));
  if (verTodo) errorOriginal(...a);
};

// Borrado que funciona también con rutas con acentos: fs.rmSync de Node 24 en
// Windows no borra nada en ese caso y no avisa (ver agent/src/config.js).
const borrar = (ruta) => {
  let info;
  try {
    info = fs.lstatSync(ruta);
  } catch {
    return;
  }
  if (info.isDirectory()) {
    for (const hijo of fs.readdirSync(ruta)) borrar(path.join(ruta, hijo));
    fs.rmdirSync(ruta);
  } else {
    fs.unlinkSync(ruta);
  }
};

const vaultTemporal = (nombre = 'vault') => {
  const dir = fs.mkdtempSync(path.join(RAIZ, `${nombre}-`));
  fs.mkdirSync(path.join(dir, 'Drivesidian'), { recursive: true });
  return dir;
};

// Cambia process.platform solo durante una prueba.
const comoPlataforma = (t, plataforma) => {
  const original = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', { value: plataforma });
  t.after(() => Object.defineProperty(process, 'platform', original));
};

// Carga un módulo de src desde cero, para que tome mocks aplicados antes.
const cargarFresco = (modulo) => {
  const ruta = require.resolve(`../../src/${modulo}`);
  delete require.cache[ruta];
  return require(ruta);
};

const esperarHasta = async (condicion, { timeoutMs = 3000, cadaMs = 10 } = {}) => {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const valor = await condicion();
    if (valor || Date.now() > limite) return valor;
    await new Promise((r) => setTimeout(r, cadaMs));
  }
};

const fetchReal = globalThis.fetch;

module.exports = { RAIZ, lineas, vaultTemporal, comoPlataforma, cargarFresco, esperarHasta, fetchReal, borrar };
