'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');

const hashContent = (content) => crypto.createHash('sha256').update(content).digest('hex');

// Upsert por (user_id, vault_path): el agente nunca conoce el id de la nota,
// solo la ruta del archivo. Nunca compara version, siempre sobreescribe.
const upsertFromAgent = async (userId, vaultPath, content) => {
  const contentHash = hashContent(content);
  const result = await pool.query(
    `INSERT INTO notes (user_id, vault_path, content, content_hash, version, sync_status, updated_at)
     VALUES ($1, $2, $3, $4, 1, 'pending', now())
     ON CONFLICT (user_id, vault_path)
     DO UPDATE SET
       content = EXCLUDED.content,
       content_hash = EXCLUDED.content_hash,
       version = notes.version + 1,
       sync_status = 'pending',
       updated_at = now()
     RETURNING id, vault_path, content, content_hash, version, sync_status, updated_at`,
    [userId, vaultPath, content, contentHash],
  );
  return result.rows[0];
};

const findAllByUser = async (userId) => {
  const result = await pool.query(
    `SELECT id, vault_path, version, sync_status, updated_at
     FROM notes
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return result.rows;
};

const findByIdForUser = async (id, userId) => {
  const result = await pool.query(
    `SELECT id, vault_path, content, content_hash, version, sync_status, updated_at
     FROM notes
     WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  return result.rows[0] || null;
};

// Compare-and-swap real: si la version no coincide, no actualiza ninguna fila
// (el controller decide 404 vs 409 según si la nota existe o no).
const updateWithVersionCheck = async (id, userId, content, expectedVersion) => {
  const contentHash = hashContent(content);
  const result = await pool.query(
    `UPDATE notes
     SET content = $1, content_hash = $2, version = version + 1, sync_status = 'pending', updated_at = now()
     WHERE id = $3 AND user_id = $4 AND version = $5
     RETURNING id, vault_path, content, content_hash, version, sync_status, updated_at`,
    [content, contentHash, id, userId, expectedVersion],
  );
  return result.rows[0] || null;
};

// Usado por el worker de sincronización: todas las notas pendientes de
// cualquier usuario, para agruparlas por dueño y subirlas en lotes. Trae el
// correo del dueño porque la carpeta del repo se arma con él (ver repoPath),
// y la version porque markSynced la compara al cerrar el lote.
const findAllPending = async () => {
  const result = await pool.query(
    `SELECT n.id, n.user_id, n.vault_path, n.content, n.version, u.email
     FROM notes n
     JOIN users u ON u.id = n.user_id
     WHERE n.sync_status = 'pending'
     ORDER BY n.user_id, n.updated_at ASC`,
  );
  return result.rows;
};

// Cierra el lote marcando como 'synced' SOLO las notas cuya version sigue
// siendo la que se subió. Entre que el worker leyó el lote y terminó de
// commitear a GitHub pasan segundos, y en ese hueco el agente pudo mandar una
// edición nueva: upsertFromAgent la dejó en 'pending' con contenido más
// reciente. Marcar por id a secas la pisaría a 'synced' sin haberla subido
// nunca, y ese contenido se perdería en silencio hasta la siguiente edición.
// Las que no coinciden se quedan pendientes y entran al siguiente ciclo.
// Devuelve cuántas quedaron efectivamente sincronizadas.
const markSynced = async (notes) => {
  if (notes.length === 0) return 0;
  const result = await pool.query(
    `UPDATE notes n
     SET sync_status = 'synced'
     FROM unnest($1::bigint[], $2::int[]) AS batch(id, version)
     WHERE n.id = batch.id AND n.version = batch.version`,
    [notes.map((note) => note.id), notes.map((note) => note.version)],
  );
  return result.rowCount;
};

module.exports = {
  upsertFromAgent,
  findAllByUser,
  findByIdForUser,
  updateWithVersionCheck,
  findAllPending,
  markSynced,
};
