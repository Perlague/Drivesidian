'use strict';

// Entorno de pruebas. Cada archivo de prueba lo importa ANTES que cualquier
// módulo del servidor: db/pool lee DATABASE_URL al cargarse, y dotenv nunca pisa
// una variable que ya está definida, así que el .env de desarrollo no se cuela.

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://drivesidian:test@localhost:55432/drivesidian_test';

// Secretos de prueba: fijos para que las corridas sean reproducibles, y
// deliberadamente distintos de cualquier valor real.
process.env.JWT_SECRET = 'secreto-jwt-solo-para-pruebas';
process.env.TOTP_ENCRYPTION_KEY = 'ab'.repeat(32); // 32 bytes en hex, como exige AES-256-GCM
process.env.NTFY_SECRET = 'secreto-ntfy-solo-para-pruebas';
process.env.GITHUB_TOKEN = 'token-falso';
process.env.GITHUB_OWNER = 'duenio';
process.env.GITHUB_REPO = 'notas';
process.env.GITHUB_BRANCH = 'main';
process.env.PORT = '3000';

// Nada de URL pública heredada del entorno de quien corre las pruebas.
delete process.env.PUBLIC_URL;
delete process.env.DOMAIN;
delete process.env.USE_NGROK;
delete process.env.TRUST_PROXY;

// El feed de seguridad sale por console.log como JSON por línea. Aquí se
// captura en vez de imprimirse: así la salida de la suite queda limpia y las
// pruebas pueden comprobar exactamente qué habría leído Guardian.
const feed = [];
const errores = [];
const verTodo = Boolean(process.env.DEBUG_TESTS);
const logOriginal = console.log;
const errorOriginal = console.error;

console.log = (...args) => {
  const linea = args.join(' ');
  if (linea.startsWith('{"log":"drivesidian.security"')) {
    feed.push(JSON.parse(linea));
  }
  if (verTodo) logOriginal(...args);
};

console.error = (...args) => {
  errores.push(args.join(' '));
  if (verTodo) errorOriginal(...args);
};

// El fetch real, guardado antes de que alguna prueba lo sustituya para simular
// GitHub o ntfy: el cliente HTTP de las pruebas siempre habla con el servidor
// de verdad.
const fetchReal = globalThis.fetch;

module.exports = { feed, errores, fetchReal };
