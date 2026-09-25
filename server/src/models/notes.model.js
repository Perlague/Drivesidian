'use strict';

const crypto = require('crypto');
const pool = require('../db/pool');
const { SYNC_NOTES_PER_USER } = require('../config');

const hashContent = (content) => crypto.createHash('sha256').update(content).digest('hex');

const NOTE_COLUMNS = 'id, vault_path, content, content_hash, version, sync_status, updated_at';

// Añade el estado de conflicto. Va aparte porque no todas las consultas lo
// necesitan: la lista del panel solo quiere saber si hay conflicto, no
// arrastrar una segunda copia del contenido.
const NOTE_COLUMNS_CON_CONFLICTO = `${NOTE_COLUMNS}, conflict_content, conflict_hash, conflict_detected_at`;

const findByVaultPath = async (userId, vaultPath) => {
  const result = await pool.query(
    `SELECT ${NOTE_COLUMNS_CON_CONFLICTO} FROM notes WHERE user_id = $1 AND vault_path = $2`,
    [userId, vaultPath],
  );
  return result.rows[0] || null;
};

// El agente identifica las notas por ruta, no por id: nunca conoce el id.
//
// El hash lo calcula SIEMPRE el servidor, nunca se confía en uno que venga del
// agente.
//
// Devuelve { outcome, note }, con outcome en:
//   'created'    la ruta no existía
//   'unchanged'  el contenido es idéntico al guardado; no se toca nada
//   'updated'    el agente partía de la versión actual: sobrescribe
//   'conflict'   cambiaron los dos lados; se guarda la versión local aparte
//   'resync'     la nota existe pero el agente no dijo de qué versión partía
const syncFromAgent = async (userId, vaultPath, content, baseVersion) => {
  const contentHash = hashContent(content);
  const existente = await findByVaultPath(userId, vaultPath);

  if (!existente) {
    const creada = await pool.query(
      `INSERT INTO notes (user_id, vault_path, content, content_hash, version, sync_status, updated_at)
       VALUES ($1, $2, $3, $4, 1, 'pending', now())
       ON CONFLICT (user_id, vault_path) DO NOTHING
       RETURNING ${NOTE_COLUMNS_CON_CONFLICTO}`,
      [userId, vaultPath, content, contentHash],
    );
    // Sin filas = otra petición creó la misma ruta entre el SELECT y el
    // INSERT. Se reintenta por el camino normal, que ahora sí la encontrará.
    if (creada.rows[0]) return { outcome: 'created', note: creada.rows[0] };
    return syncFromAgent(userId, vaultPath, content, baseVersion);
  }

  // El disco ya coincide con el servidor. Si había un conflicto pendiente, la
  // divergencia se resolvió sola y hay que limpiarlo: dejarlo marcado pediría
  // al usuario decidir entre dos versiones idénticas.
  if (existente.content_hash === contentHash) {
    if (existente.conflict_content !== null) {
      return { outcome: 'unchanged', note: await clearConflict(existente.id, userId) };
    }
    return { outcome: 'unchanged', note: existente };
  }

  // Un agente sin índice no sabe de qué versión partía. Sobrescribir aquí es
  // justamente el escenario de pérdida de datos que este diseño evita: un
  // agente reinstalado subiría su copia vieja encima de ediciones más nuevas.
  // Tiene que reconciliar primero (ver el agente).
  if (baseVersion === null || baseVersion === undefined) {
    return { outcome: 'resync', note: existente };
  }

  // Compare-and-swap: el WHERE sobre version hace la comprobación atómica, así
  // que dos peticiones simultáneas no pueden pisarse.
  const actualizada = await pool.query(
    `UPDATE notes
     SET content = $1, content_hash = $2, version = version + 1,
         sync_status = 'pending', updated_at = now(),
         conflict_content = NULL, conflict_hash = NULL, conflict_detected_at = NULL
     WHERE id = $3 AND user_id = $4 AND version = $5
     RETURNING ${NOTE_COLUMNS_CON_CONFLICTO}`,
    [content, contentHash, existente.id, userId, baseVersion],
  );
  if (actualizada.rows[0]) return { outcome: 'updated', note: actualizada.rows[0] };

  // La version no coincide: el servidor cambió desde que el agente sincronizó
  // por última vez, y el disco también. Nadie pisa a nadie.
  return { outcome: 'conflict', note: await markConflict(existente.id, userId, content, contentHash) };
};

// Guarda la versión local sin tocar `content` ni `version`. Si ya había un
// conflicto, se actualiza para que refleje lo último del disco.
const markConflict = async (id, userId, content, contentHash) => {
  const result = await pool.query(
    `UPDATE notes
     SET conflict_content = $1, conflict_hash = $2, conflict_detected_at = now()
     WHERE id = $3 AND user_id = $4
     RETURNING ${NOTE_COLUMNS_CON_CONFLICTO}`,
    [content, contentHash, id, userId],
  );
  return result.rows[0] || null;
};

const clearConflict = async (id, userId) => {
  const result = await pool.query(
    `UPDATE notes
     SET conflict_content = NULL, conflict_hash = NULL, conflict_detected_at = NULL
     WHERE id = $1 AND user_id = $2
     RETURNING ${NOTE_COLUMNS_CON_CONFLICTO}`,
    [id, userId],
  );
  return result.rows[0] || null;
};

// Bajada: lo que el agente tiene que traerse a su disco.
//
// Se pagina por (updated_at, id) y no solo por updated_at: dos notas escritas
// en la misma transacción comparten timestamp, y con un cursor de un solo
// campo el LIMIT podría dejar una fuera para siempre. La comparación de tuplas
// de Postgres lo resuelve sin trucos.
//
// Excluye las notas en conflicto: no hay nada que entregar hasta que alguien
// decida cuál versión gana.
// `cursor_at` va como TEXTO y no como el `updated_at` normal por una razón que
// cuesta descubrir: Postgres guarda timestamptz con precisión de microsegundos,
// pero el driver lo convierte a un Date de JavaScript, que solo llega a
// milisegundos. Un cursor redondeado a milisegundos es MENOR que el valor real
// guardado, así que la última fila de cada página volvería a salir en la
// siguiente: el agente se quedaría en un bucle trayendo siempre la misma nota.
const findChangedSince = async (userId, cursor, limit) => {
  const result = await pool.query(
    `SELECT ${NOTE_COLUMNS}, updated_at::text AS cursor_at
     FROM notes
     WHERE user_id = $1
       AND conflict_content IS NULL
       AND ($2::text IS NULL OR (updated_at, id) > ($2::timestamptz, $3::bigint))
     ORDER BY updated_at ASC, id ASC
     LIMIT $4`,
    [userId, cursor?.since ?? null, cursor?.sinceId ?? 0, limit],
  );
  return result.rows;
};

// Resolución desde el panel: el humano eligió la versión del servidor. Se
// descarta la local y la nota vuelve a su estado normal.
const resolveKeepServer = async (id, userId) => {
  const result = await pool.query(
    `UPDATE notes
     SET conflict_content = NULL, conflict_hash = NULL, conflict_detected_at = NULL,
         updated_at = now()
     WHERE id = $1 AND user_id = $2 AND conflict_content IS NOT NULL
     RETURNING ${NOTE_COLUMNS_CON_CONFLICTO}`,
    [id, userId],
  );
  return result.rows[0] || null;
};

// El humano eligió su versión local: pasa a ser la del servidor, sube version y
// se reencola para GitHub. En los dos casos se mueve updated_at, así que el
// agente baja la ganadora en su siguiente consulta.
const resolveKeepLocal = async (id, userId) => {
  const result = await pool.query(
    `UPDATE notes
     SET content = conflict_content, content_hash = conflict_hash,
         version = version + 1, sync_status = 'pending', updated_at = now(),
         conflict_content = NULL, conflict_hash = NULL, conflict_detected_at = NULL
     WHERE id = $1 AND user_id = $2 AND conflict_content IS NOT NULL
     RETURNING ${NOTE_COLUMNS_CON_CONFLICTO}`,
    [id, userId],
  );
  return result.rows[0] || null;
};

// Para la cuota de notas por usuario. Solo se llama cuando llega una ruta
// nueva, no en cada guardado (ver el controller de sync).
const countByUser = async (userId) => {
  const result = await pool.query('SELECT count(*)::int AS total FROM notes WHERE user_id = $1', [userId]);
  return result.rows[0].total;
};

const findAllByUser = async (userId) => {
  const result = await pool.query(
    // in_conflict como booleano derivado: la lista puede resaltar las notas que
    // necesitan atención sin arrastrar una segunda copia del contenido.
    `SELECT id, vault_path, version, sync_status, updated_at,
            (conflict_content IS NOT NULL) AS in_conflict
     FROM notes
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [userId],
  );
  return result.rows;
};

const findByIdForUser = async (id, userId) => {
  const result = await pool.query(
    // Con el conflicto: el editor necesita las dos versiones para mostrarlas.
    `SELECT ${NOTE_COLUMNS_CON_CONFLICTO}
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
  syncFromAgent,
  findChangedSince,
  resolveKeepServer,
  resolveKeepLocal,
  countByUser,
  findAllByUser,
  findByIdForUser,
  findByVaultPath,
  updateWithVersionCheck,
  findAllPending,
  markSynced,
};
