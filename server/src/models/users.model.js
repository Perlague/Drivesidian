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

const findById = async (id) => {
  const result = await pool.query(
    `SELECT id, email, role, created_at
     FROM users
     WHERE id = $1`,
    [id],
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

module.exports = { findByEmail, findById, create, saveTotpSecret };
