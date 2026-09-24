'use strict';

const notesModel = require('../models/notes.model');
const { putBatch } = require('../utils/github');
const { buildRepoPath, buildUserFolder } = require('../utils/repoPath');
const { notify } = require('../utils/ntfy');
const { MAX_BATCH_BYTES } = require('../config');

const DEFAULT_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos

const groupByUser = (notes) => {
  const groups = new Map();
  for (const note of notes) {
    const list = groups.get(note.user_id) || [];
    list.push(note);
    groups.set(note.user_id, list);
  }
  return groups;
};

// Recorta el lote cuando acumula demasiados bytes. El lote es todo o nada, así
// que un request gigante que GitHub rechace dejaría la cola de ese usuario
// atascada indefinidamente. Lo que no entra queda pendiente para el ciclo
// siguiente.
const takeWithinByteBudget = (notes) => {
  const included = [];
  let bytes = 0;

  for (const note of notes) {
    const size = Buffer.byteLength(note.content, 'utf8');
    // La primera nota entra siempre: si una sola excede el presupuesto no hay
    // lote más chico posible, y saltarla para siempre sería peor que intentarlo.
    if (included.length > 0 && bytes + size > MAX_BATCH_BYTES) break;
    included.push(note);
    bytes += size;
  }

  return { included, bytes };
};

// Un solo commit por lote de usuario (Git Data API), y una sola notificación
// por ese lote, nunca por nota individual.
const runSyncCycle = async () => {
  const pending = await notesModel.findAllPending();
  if (pending.length === 0) return;

  const groups = groupByUser(pending);

  for (const [userId, pendingForUser] of groups) {
    const folder = buildUserFolder(userId, pendingForUser[0].email);
    const { included: notes, bytes } = takeWithinByteBudget(pendingForUser);
    if (notes.length < pendingForUser.length) {
      const mib = (bytes / 1024 / 1024).toFixed(1);
      console.log(
        `[syncWorker] lote de ${folder} recortado a ${notes.length}/${pendingForUser.length} nota(s) (${mib} MiB); el resto va en el siguiente ciclo`,
      );
    }

    // El repo es compartido: cada usuario escribe bajo su propia carpeta,
    // así que dos notas con el mismo vault_path no se pisan entre cuentas.
    const files = notes.map((note) => ({
      path: buildRepoPath(userId, note.email, note.vault_path),
      content: note.content,
    }));

    // El lote es todo o nada: si el commit falla, ninguna nota se marca y
    // todas entran de nuevo en el siguiente ciclo.
    try {
      await putBatch(files, `Sync: ${files.length} nota(s) de ${folder}`);
    } catch (err) {
      console.error(`[syncWorker] fallo subiendo el lote de ${folder}:`, err.message);
      continue;
    }

    // Solo se cierran las notas que no cambiaron mientras subíamos: si el
    // agente mandó una edición a media subida, esa nota sigue pendiente y se
    // vuelve a subir en el próximo ciclo con su contenido nuevo.
    const syncedCount = await notesModel.markSynced(notes);
    const reopened = notes.length - syncedCount;
    if (reopened > 0) {
      console.log(
        `[syncWorker] ${reopened} nota(s) de ${folder} se editaron durante la subida y siguen pendientes.`,
      );
    }
    if (syncedCount === 0) continue;

    try {
      await notify(`Drivesidian: ${syncedCount} nota(s) sincronizada(s).`);
    } catch (err) {
      console.error('[syncWorker] fallo notificando a ntfy:', err.message);
    }
  }
};

const startSyncWorker = () => {
  const intervalMs = Number(process.env.SYNC_INTERVAL_MS) || DEFAULT_INTERVAL_MS;
  setInterval(() => {
    runSyncCycle().catch((err) => console.error('[syncWorker] error en el ciclo:', err.message));
  }, intervalMs);
  console.log(`[syncWorker] worker de sincronización iniciado (cada ${intervalMs}ms)`);
};

module.exports = { startSyncWorker, runSyncCycle, takeWithinByteBudget };
