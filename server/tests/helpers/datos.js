'use strict';

// Acceso directo a la base de pruebas y datos de partida.

const pool = require('../../src/db/pool');
const { hashPassword } = require('../../src/utils/password');
const { encryptSecret } = require('../../src/utils/secretCrypto');
const { generateSecret } = require('../../src/utils/totp');
const { issueAgentToken } = require('../../src/controllers/agentTokens.controller');

const TABLAS = ['security_events', 'pairing_codes', 'notes', 'agent_tokens', 'users'];

const limpiarBase = () => pool.query(`TRUNCATE ${TABLAS.join(', ')} RESTART IDENTITY CASCADE`);

const cerrarBase = () => pool.end();

let secuencia = 0;
const correoUnico = (prefijo = 'usuario') => `${prefijo}.${process.pid}.${(secuencia += 1)}@ejemplo.com`;

const CLAVE = 'contrasena-de-prueba';

// Crea un usuario directamente en la base. Con `con2fa` le deja un secreto TOTP
// ya confirmado y lo devuelve en claro para generar códigos válidos.
const crearUsuario = async ({ email = correoUnico(), role = 'user', con2fa = false } = {}) => {
  const hash = await hashPassword(CLAVE);
  const secreto = con2fa ? generateSecret() : null;
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, totp_secret)
     VALUES ($1, $2, $3, $4)
     RETURNING id, email, role`,
    [email, hash, role, secreto ? encryptSecret(secreto) : null],
  );
  return { ...rows[0], password: CLAVE, secreto };
};

const tokenDeAgente = async (userId) => (await issueAgentToken(userId)).token;

// Los eventos se escriben en la base sin bloquear la petición, así que una
// prueba puede consultarlos un instante antes de que el INSERT termine.
const esperarEventos = async (tipo, { minimo = 1, userId, timeoutMs = 3000 } = {}) => {
  const limite = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query(
      `SELECT type, severity, user_id, ip, user_agent, details
       FROM security_events
       WHERE type = $1 AND ($2::bigint IS NULL OR user_id = $2)
       ORDER BY id`,
      [tipo, userId ?? null],
    );
    if (rows.length >= minimo || Date.now() > limite) return rows;
    await new Promise((r) => setTimeout(r, 25));
  }
};

const nota = async (id) => (await pool.query('SELECT * FROM notes WHERE id = $1', [id])).rows[0];

module.exports = {
  pool,
  limpiarBase,
  cerrarBase,
  correoUnico,
  crearUsuario,
  tokenDeAgente,
  esperarEventos,
  nota,
  CLAVE,
};
