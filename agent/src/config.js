'use strict';

const fs = require('fs');
const path = require('path');
const { configFile } = require('./paths');

// Valor por defecto para desarrollo. El instalador escribe el real en el
// config.json al armar el paquete; la variable de entorno permite apuntar a
// otro servidor sin tocar el archivo.
const DEFAULT_API_URL = 'http://127.0.0.1:3000';

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

const guardar = (cambios) => {
  const ruta = configFile();
  const actual = fs.existsSync(ruta) ? leer() : {};
  const nuevo = { ...actual, ...cambios };

  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  // El archivo lleva el agent token, así que se crea solo para el dueño.
  // En Windows el modo se ignora, pero %APPDATA% ya es privado por usuario.
  fs.writeFileSync(ruta, `${JSON.stringify(nuevo, null, 2)}\n`, { mode: 0o600 });
  return nuevo;
};

const cargar = () => {
  const archivo = leer();
  return {
    apiUrl: (process.env.DRIVESIDIAN_API_URL || archivo.apiUrl || DEFAULT_API_URL).replace(/\/+$/, ''),
    agentToken: archivo.agentToken || null,
    vaultPath: archivo.vaultPath || null,
  };
};

const olvidarToken = () => {
  const ruta = configFile();
  if (!fs.existsSync(ruta)) return;
  const actual = leer();
  delete actual.agentToken;
  fs.writeFileSync(ruta, `${JSON.stringify(actual, null, 2)}\n`, { mode: 0o600 });
};

const borrar = () => {
  const ruta = configFile();
  if (fs.existsSync(ruta)) fs.rmSync(ruta);
};

module.exports = { cargar, guardar, olvidarToken, borrar, configFile, DEFAULT_API_URL };
