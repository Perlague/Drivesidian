'use strict';

const pool = require('../db/pool');

const COLUMNS = `id, code, verifier_hash, user_id, agent_token_id, vaults,
                 selected_vault, device_name, created_at, expires_at,
                 approved_at, consumed_at`;

const create = async ({ code, verifierHash, vaults, deviceName, ttlMs }) => {
  const result = await pool.query(
    `INSERT INTO pairing_codes (code, verifier_hash, vaults, device_name, expires_at)
     VALUES ($1, $2, $3, $4, now() + ($5 || ' milliseconds')::interval)
     RETURNING ${COLUMNS}`,
    [code, verifierHash, JSON.stringify(vaults), deviceName, String(ttlMs)],
  );
  return result.rows[0];
};

const findByCode = async (code) => {
  const result = await pool.query(`SELECT ${COLUMNS} FROM pairing_codes WHERE code = $1`, [code]);
  return result.rows[0] || null;
};

// Liga el código a un usuario. El UPDATE solo aplica si sigue sin aprobar, sin
// consumir y sin expirar, así que dos aprobaciones simultáneas no se pisan: la
// segunda no devuelve filas.
const approve = async (code, userId, selectedVault) => {
  const result = await pool.query(
    `UPDATE pairing_codes
     SET user_id = $1, selected_vault = $2, approved_at = now()
     WHERE code = $3
       AND approved_at IS NULL
       AND consumed_at IS NULL
       AND expires_at > now()
     RETURNING ${COLUMNS}`,
    [userId, selectedVault, code],
  );
  return result.rows[0] || null;
};

// Marca el código como canjeado. Mismo criterio: es de un solo uso, así que el
// UPDATE exige que siga sin consumir.
const consume = async (code, agentTokenId) => {
  const result = await pool.query(
    `UPDATE pairing_codes
     SET consumed_at = now(), agent_token_id = $1
     WHERE code = $2 AND approved_at IS NOT NULL AND consumed_at IS NULL
     RETURNING ${COLUMNS}`,
    [agentTokenId, code],
  );
  return result.rows[0] || null;
};

// Los códigos caducados no sirven para nada; se podan junto con los eventos.
const deleteExpired = async () => {
  const result = await pool.query(
    `DELETE FROM pairing_codes WHERE expires_at < now() - interval '1 day'`,
  );
  return result.rowCount;
};

module.exports = { create, findByCode, approve, consume, deleteExpired };
