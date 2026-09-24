'use strict';

const pool = require('../db/pool');

const create = async ({ type, severity, userId, ip, userAgent, details }) => {
  const result = await pool.query(
    `INSERT INTO security_events (type, severity, user_id, ip, user_agent, details)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, occurred_at`,
    [type, severity, userId, ip, userAgent, details],
  );
  return result.rows[0];
};

// Consulta del panel de admin. Los filtros son todos opcionales y se arman
// como condiciones acumulativas para no repetir la query por combinación.
const findAll = async ({ type, severity, since, until, limit = 100, offset = 0 } = {}) => {
  const conditions = [];
  const params = [];

  if (type) {
    params.push(type);
    conditions.push(`type = $${params.length}`);
  }
  if (severity) {
    params.push(severity);
    conditions.push(`severity = $${params.length}`);
  }
  if (since) {
    params.push(since);
    conditions.push(`occurred_at >= $${params.length}`);
  }
  if (until) {
    params.push(until);
    conditions.push(`occurred_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  params.push(limit, offset);

  const result = await pool.query(
    `SELECT id, occurred_at, type, severity, user_id, ip, user_agent, details
     FROM security_events
     ${where}
     ORDER BY occurred_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return result.rows;
};

// Poda por retención: la tabla crece con cada petición interesante, así que
// sin esto llena el disco de la EC2 con el tiempo.
const deleteOlderThan = async (days) => {
  const result = await pool.query(
    `DELETE FROM security_events WHERE occurred_at < now() - ($1 || ' days')::interval`,
    [String(days)],
  );
  return result.rowCount;
};

module.exports = { create, findAll, deleteOlderThan };
