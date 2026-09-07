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

module.exports = { findByEmail, findById };
