'use strict';

const pool = require('../db/pool');

const findByEmail = async (email) => {
  const result = await pool.query(
    `SELECT id, email, password_hash, totp_secret, role, failed_2fa_attempts, locked_until
     FROM users
     WHERE email = $1`,
    [email],
  );
  return result.rows[0] || null;
};

// twofa_enabled se calcula en lugar de devolver totp_secret: quien pregunta
// por el usuario necesita saber si tiene segundo factor, no cuál es.
const findById = async (id) => {
  const result = await pool.query(
    `SELECT id, email, role, notify_enabled, created_at,
            (totp_secret IS NOT NULL) AS twofa_enabled
     FROM users
     WHERE id = $1`,
    [id],
  );
  return result.rows[0] || null;
};

// Listado del panel de admin. Nunca devuelve password_hash ni totp_secret:
// esas columnas no tienen por qué salir de la base ni siquiera para un admin.
const findAll = async () => {
  const result = await pool.query(
    `SELECT id, email, role, notify_enabled, failed_2fa_attempts, locked_until, created_at,
            (totp_secret IS NOT NULL) AS twofa_enabled
     FROM users
     ORDER BY id`,
  );
  return result.rows;
};

const updateNotifyPreference = async (userId, enabled) => {
  const result = await pool.query(
    `UPDATE users SET notify_enabled = $1 WHERE id = $2 RETURNING id, notify_enabled`,
    [enabled, userId],
  );
  return result.rows[0] || null;
};

const create = async (email, passwordHash) => {
  const result = await pool.query(
    `INSERT INTO users (email, password_hash)
     VALUES ($1, $2)
     RETURNING id, email, role, created_at`,
    [email, passwordHash],
  );
  return result.rows[0];
};

const saveTotpSecret = async (userId, encryptedSecret) => {
  const result = await pool.query(
    `UPDATE users
     SET totp_secret = $1
     WHERE id = $2
     RETURNING id, email, role`,
    [encryptedSecret, userId],
  );
  return result.rows[0] || null;
};

// Incrementa y bloquea en una sola sentencia atómica (evita una carrera
// leer-luego-escribir entre requests concurrentes del mismo usuario).
const incrementFailedAttempts = async (userId) => {
  const result = await pool.query(
    `UPDATE users
     SET failed_2fa_attempts = failed_2fa_attempts + 1,
         locked_until = CASE
           WHEN failed_2fa_attempts + 1 >= 5 THEN now() + interval '15 minutes'
           ELSE locked_until
         END
     WHERE id = $1
     RETURNING failed_2fa_attempts, locked_until`,
    [userId],
  );
  return result.rows[0];
};

const resetFailedAttempts = async (userId) => {
  await pool.query(
    `UPDATE users SET failed_2fa_attempts = 0, locked_until = NULL WHERE id = $1`,
    [userId],
  );
};

module.exports = {
  findByEmail,
  findById,
  create,
  findAll,
  updateNotifyPreference,
  saveTotpSecret,
  incrementFailedAttempts,
  resetFailedAttempts,
};
