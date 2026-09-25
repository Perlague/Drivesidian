'use strict';

const fs = require('fs');
const path = require('path');
const { dataDir } = require('./paths');

// El agente corre como tarea programada de Windows, sin consola a la vista: si
// solo escribiera a stdout no habría forma de saber qué pasó cuando algo falla.
// Por eso todo va también a un archivo junto a la configuración.

const LOG_FILE = path.join(dataDir(), 'agent.log');
const MAX_BYTES = 5 * 1024 * 1024;

let listo = false;

const prepararArchivo = () => {
  if (listo) return;
  try {
    fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
    // Rotación mínima: al pasar del tope se conserva una generación anterior.
    // Sin esto, un agente en bucle llena el disco del usuario.
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > MAX_BYTES) {
      fs.renameSync(LOG_FILE, `${LOG_FILE}.1`);
    }
  } catch {
    /* si no se puede escribir, queda solo la consola */
  }
  listo = true;
};

const escribir = (nivel, mensaje) => {
  const linea = `${new Date().toISOString()} ${nivel.padEnd(5)} ${mensaje}`;

  if (nivel === 'ERROR') console.error(linea);
  else console.log(linea);

  prepararArchivo();
  try {
    fs.appendFileSync(LOG_FILE, `${linea}\n`);
  } catch {
    /* el log en disco es un extra, nunca debe tumbar al agente */
  }
};

module.exports = {
  info: (m) => escribir('INFO', m),
  warn: (m) => escribir('WARN', m),
  error: (m) => escribir('ERROR', m),
  logFile: LOG_FILE,
};
