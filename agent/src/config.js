'use strict';

const fs = require('fs');
const path = require('path');
const { configFile } = require('./paths');
const secureStore = require('./secureStore');

// Último recurso, solo para desarrollo local.
const DEFAULT_API_URL = 'http://127.0.0.1:3000';

// El instalador escribe config.default.json junto a la aplicación con la URL
// del servidor contra el que se armó el paquete. Es de solo lectura y no se
// toca nunca: la configuración del usuario vive aparte, en %APPDATA%, porque
// Program Files no es escribible para una cuenta normal.
const leerPorDefecto = () => {
  try {
    const ruta = path.join(__dirname, '..', 'config.default.json');
    // El .replace() quita un BOM inicial: JSON.parse lanza si lo encuentra, y
    // este archivo lo escribe PowerShell, que mete BOM con demasiada facilidad.
    // Sin esto el fallo es invisible —el catch devuelve {} y el agente se va a
    // su URL por defecto— con un archivo que a simple vista se ve bien.
    return JSON.parse(fs.readFileSync(ruta, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    return {};
  }
};

const leer = () => {
  const ruta = configFile();
  if (!fs.existsSync(ruta)) return {};

  try {
    return JSON.parse(fs.readFileSync(ruta, 'utf8'));
  } catch (err) {
    // Un config.json corrupto no debe dejar al agente en un bucle de crashes:
    // se avisa y se trata como si no existiera, lo que dispara la vinculación.
    throw new Error(
      `El archivo de configuración está corrupto (${ruta}): ${err.message}. Bórralo para volver a vincular el equipo.`,
    );
  }
};

const escribir = (datos) => {
  const ruta = configFile();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  // El archivo lleva el acceso del agente, así que se crea solo para el dueño.
  // En Windows el modo se ignora, pero %APPDATA% ya es privado por usuario.
  fs.writeFileSync(ruta, `${JSON.stringify(datos, null, 2)}\n`, { mode: 0o600 });
};

// El token se guarda cifrado en `agentTokenEnc`. Solo cae a `agentToken` en
// claro si el cifrado no está disponible (fuera de Windows, o si PowerShell
// falla), y en ese caso secureStore ya avisó en el log.
const guardar = (cambios) => {
  const actual = leer();
  const nuevo = { ...actual, ...cambios };

  if (Object.prototype.hasOwnProperty.call(cambios, 'agentToken')) {
    const blob = cambios.agentToken === null ? null : secureStore.cifrar(cambios.agentToken);

    delete nuevo.agentToken;
    delete nuevo.agentTokenEnc;

    if (cambios.agentToken !== null) {
      if (blob) nuevo.agentTokenEnc = blob;
      else nuevo.agentToken = cambios.agentToken;
    }
  }

  escribir(nuevo);
  return nuevo;
};

const cargar = () => {
  const archivo = leer();

  // Orden de precedencia: variable de entorno (para probar contra otro
  // servidor sin tocar nada) > configuración del usuario > la que trae el
  // instalador > el default de desarrollo.
  const apiUrl =
    process.env.DRIVESIDIAN_API_URL ||
    archivo.apiUrl ||
    leerPorDefecto().apiUrl ||
    DEFAULT_API_URL;

  // Un blob que no se puede descifrar viene de otra cuenta o de otro equipo:
  // se trata como si no hubiera token, y el agente se vuelve a vincular.
  const agentToken = archivo.agentTokenEnc
    ? secureStore.descifrar(archivo.agentTokenEnc)
    : archivo.agentToken || null;

  return {
    apiUrl: apiUrl.replace(/\/+$/, ''),
    agentToken,
    vaultPath: archivo.vaultPath || null,
    // Avisa de que el token está en claro en el disco y conviene migrarlo.
    tokenEnClaro: Boolean(archivo.agentToken) && !archivo.agentTokenEnc,
  };
};

// Se llama al arrancar cuando se encuentra un token en claro: lo reescribe
// cifrado. Así los agentes instalados antes de que existiera el cifrado se
// migran solos, sin que el usuario tenga que hacer nada.
const cifrarTokenExistente = (agentToken) => {
  if (!secureStore.disponible()) return false;
  guardar({ agentToken });
  return !leer().agentToken; // true si quedó solo el blob
};

const olvidarToken = () => {
  const ruta = configFile();
  if (!fs.existsSync(ruta)) return;
  const actual = leer();
  delete actual.agentToken;
  delete actual.agentTokenEnc;
  escribir(actual);
};

const borrar = () => {
  const ruta = configFile();
  if (fs.existsSync(ruta)) fs.rmSync(ruta);
};

module.exports = {
  cargar,
  guardar,
  cifrarTokenExistente,
  olvidarToken,
  borrar,
  configFile,
  DEFAULT_API_URL,
};
