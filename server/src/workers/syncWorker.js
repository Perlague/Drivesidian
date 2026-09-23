'use strict';

const notesModel = require('../models/notes.model');
const { putBatch } = require('../utils/github');
const { buildRepoPath, buildUserFolder } = require('../utils/repoPath');
const { notify } = require('../utils/ntfy');

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

// Un solo commit por lote de usuario (Git Data API), y una sola notificación
// por ese lote, nunca por nota individual.
const runSyncCycle = async () => {
  const pending = await notesModel.findAllPending();
  if (pending.length === 0) return;

  const groups = groupByUser(pending);

  for (const [userId, notes] of groups) {
    const folder = buildUserFolder(userId, notes[0].email);
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

    await notesModel.markSynced(notes.map((note) => note.id));
    try {
      await notify(`Drivesidian: ${files.length} nota(s) sincronizada(s).`);
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

module.exports = { startSyncWorker, runSyncCycle };
