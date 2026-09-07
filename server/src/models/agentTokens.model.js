'use strict';

const pool = require('../db/pool');

const create = async (userId, tokenHash) => {
  const result = await pool.query(
    `INSERT INTO agent_tokens (user_id, token_hash)
     VALUES ($1, $2)
     RETURNING id, created_at`,
    [userId, tokenHash],
  );
  return result.rows[0];
};

// Usado por requireAuth en cada request autenticada con un agent token.
const findActiveByHash = async (tokenHash) => {
  const result = await pool.query(
    `SELECT id, user_id, revoked_at
     FROM agent_tokens
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [tokenHash],
  );
  return result.rows[0] || null;
};

const findAllByUser = async (userId) => {
  const result = await pool.query(
    `SELECT id, created_at, revoked_at
     FROM agent_tokens
     WHERE user_id = $1
     ORDER BY created_at DESC`,
    [userId],
  );
  return result.rows;
};

const revoke = async (id, userId) => {
  const result = await pool.query(
    `UPDATE agent_tokens
     SET revoked_at = now()
     WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
     RETURNING id, revoked_at`,
    [id, userId],
  );
  return result.rows[0] || null;
};

module.exports = { create, findActiveByHash, findAllByUser, revoke };
