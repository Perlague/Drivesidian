'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');
const { SYNC_NOTES_PER_USER } = require('../config');

const hashContent = (content) => crypto.createHash('sha256').update(content).digest('hex');

const NOTE_COLUMNS = 'id, vault_path, content, content_hash, version, sync_status, updated_at';

const findByVaultPath = async (userId, vaultPath) => {
  const result = await pool.query(
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE user_id = $1 AND vault_path = $2`,
    [userId, vaultPath],
  );
  return result.rows[0] || null;
};

// Upsert por (user_id, vault_path): el agente nunca conoce el id de la nota,
// solo la ruta del archivo. Nunca compara version, siempre sobreescribe.
//
// El hash lo calcula SIEMPRE el servidor, nunca se confía en uno que venga
// del agente. Si el contenido entrante es idéntico al guardado, el DO UPDATE
// no toca la fila: ni sube version, ni reencola, ni mueve updated_at. Sin
// eso, cada arranque del agente re-subiría el vault completo, porque chokidar
// emite un evento por cada archivo que encuentra aunque nada haya cambiado.
//
// Devuelve { note, changed }: changed dice si la fila se escribió de verdad.
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
     WHERE notes.content_hash IS DISTINCT FROM EXCLUDED.content_hash
     RETURNING ${NOTE_COLUMNS}`,
    [userId, vaultPath, content, contentHash],
  );

  if (result.rows[0]) {
    return { note: result.rows[0], changed: true };
  }

  // Sin filas devueltas = el WHERE del DO UPDATE bloqueó la escritura porque
  // el contenido no cambió. La nota existe, solo hay que leerla tal cual está.
  return { note: await findByVaultPath(userId, vaultPath), changed: false };
};

// Para la cuota de notas por usuario. Solo se llama cuando llega una ruta
// nueva, no en cada guardado (ver el controller de sync).
const countByUser = async (userId) => {
  const result = await pool.query('SELECT count(*)::int AS total FROM notes WHERE user_id = $1', [userId]);
  return result.rows[0].total;
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
    `SELECT ${NOTE_COLUMNS}
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
     RETURNING ${NOTE_COLUMNS}`,
    [content, contentHash, id, userId, expectedVersion],
  );
  return result.rows[0] || null;
};

// Usado por el worker de sincronización. Trae el correo del dueño porque la
// carpeta del repo se arma con él (ver repoPath) y la version porque
// markSynced la compara al cerrar el lote.
//
// El tope es POR USUARIO, no global: como el orden es por user_id, un tope
// global dejaría a un usuario con cientos de notas pendientes monopolizando
// todos los ciclos y a los demás sin sincronizar nunca.
//
// La subconsulta elige solo ids, y el contenido se lee después únicamente para
// esos ids. Si el row_number() se calculara sobre la tabla ya con el content,
// Postgres materializaría el texto de TODAS las notas pendientes antes de
// recortar, y el tope dejaría de acotar la memoria, que es justo su razón de ser.
const findAllPending = async (userId = null, perUserLimit = SYNC_NOTES_PER_USER) => {
  const result = await pool.query(
    `WITH seleccionadas AS (
       SELECT id
       FROM (
         SELECT id,
                row_number() OVER (PARTITION BY user_id ORDER BY updated_at ASC) AS rn
         FROM notes
         WHERE sync_status = 'pending'
           AND ($1::bigint IS NULL OR user_id = $1)
       ) ranked
       WHERE rn <= $2
     )
     SELECT n.id, n.user_id, n.vault_path, n.content, n.version, u.email, u.notify_enabled
     FROM notes n
     JOIN users u ON u.id = n.user_id
     WHERE n.id IN (SELECT id FROM seleccionadas)
     ORDER BY n.user_id, n.updated_at ASC`,
    [userId, perUserLimit],
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
  countByUser,
  findAllByUser,
  findByIdForUser,
  findByVaultPath,
  updateWithVersionCheck,
  findAllPending,
  markSynced,
};
