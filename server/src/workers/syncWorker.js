'use strict';

const notesModel = require('../models/notes.model');
const { putFile } = require('../utils/github');
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

// Un commit por nota (la Contents API no soporta commits multi-archivo sin
// usar la API de Git de más bajo nivel), pero UNA sola notificación por lote
// por usuario, nunca por nota individual.
const runSyncCycle = async () => {
  const pending = await notesModel.findAllPending();
  if (pending.length === 0) return;

  const groups = groupByUser(pending);

  for (const [userId, notes] of groups) {
    const syncedIds = [];

    for (const note of notes) {
      try {
        await putFile(note.vault_path, note.content, `Sync: ${note.vault_path}`);
        syncedIds.push(note.id);
      } catch (err) {
        console.error(`[syncWorker] fallo subiendo "${note.vault_path}" (usuario ${userId}):`, err.message);
      }
    }

    if (syncedIds.length === 0) continue;

    await notesModel.markSynced(syncedIds);
    try {
      await notify(`Drivesidian: ${syncedIds.length} nota(s) sincronizada(s).`);
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
