'use strict';

const { syncSchema } = require('../schemas/notes/sync');
const { updateSchema } = require('../schemas/notes/update');
const notesModel = require('../models/notes.model');
const { success, error, validationError, conflict } = require('../utils/response');
const { logSecurityEvent, SEVERITY, EVENTS } = require('../utils/securityLog');
const { runSyncForUser } = require('../workers/syncWorker');
const { MAX_NOTES_PER_USER } = require('../config');

// PUT /api/notes/sync — exclusivo del agente. Upsert por vault_path, nunca
// compara version (ver "Resolución de conflictos" en la documentación).
const sync = async (req, res) => {
  if (req.auth.type !== 'agent') {
    return error(res, 'Este endpoint es exclusivo del agente.', 403);
  }

  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  // La cuota solo aplica a rutas nuevas: editar una nota que ya existe nunca
  // suma al total, así que el COUNT no corre en cada guardado. Esta búsqueda
  // usa el índice único (user_id, vault_path), y se comprueba ANTES de
  // insertar para no tener que deshacer nada después.
  const existing = await notesModel.findByVaultPath(req.auth.userId, parsed.data.vault_path);
  if (!existing) {
    const total = await notesModel.countByUser(req.auth.userId);
    if (total >= MAX_NOTES_PER_USER) {
      logSecurityEvent({
        type: EVENTS.QUOTA_EXCEEDED,
        severity: SEVERITY.WARN,
        userId: req.auth.userId,
        req,
        details: { quota: MAX_NOTES_PER_USER, total, vault_path: parsed.data.vault_path },
      });
      return error(res, `Alcanzaste el máximo de ${MAX_NOTES_PER_USER} notas.`, 403);
    }
  }

  // changed = false cuando el contenido era idéntico al guardado: la nota no
  // se reencoló. Se responde 200 igual, porque desde el punto de vista del
  // agente el reporte se aceptó; el flag va en el payload solo para que pueda
  // registrarlo en su log.
  const { note, changed } = await notesModel.upsertFromAgent(
    req.auth.userId,
    parsed.data.vault_path,
    parsed.data.content,
  );
  success(res, { ...note, changed });
};

// GET /api/notes — exclusivo de la web.
const list = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }

  const notes = await notesModel.findAllByUser(req.auth.userId);
  success(res, notes);
};

// GET /api/notes/:id — exclusivo de la web.
const getOne = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }
  if (!/^\d+$/.test(req.params.id)) {
    return error(res, 'id inválido.', 400);
  }

  const note = await notesModel.findByIdForUser(req.params.id, req.auth.userId);
  if (!note) {
    return error(res, 'Nota no encontrada.', 404);
  }
  success(res, note);
};

// PUT /api/notes/:id — exclusivo de la web. Compare-and-swap real con version.
const update = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }
  if (!/^\d+$/.test(req.params.id)) {
    return error(res, 'id inválido.', 400);
  }

  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const updated = await notesModel.updateWithVersionCheck(
    req.params.id,
    req.auth.userId,
    parsed.data.content,
    parsed.data.version,
  );
  if (updated) {
    return success(res, updated);
  }

  const current = await notesModel.findByIdForUser(req.params.id, req.auth.userId);
  if (!current) {
    return error(res, 'Nota no encontrada.', 404);
  }
  conflict(res, { content: parsed.data.content, version: parsed.data.version }, current);
};

// POST /api/notes/sync-now — exclusivo de la web. Dispara el ciclo del worker
// para este usuario sin esperar al intervalo.
const syncNow = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }

  const { busy, result } = await runSyncForUser(req.auth.userId);
  if (busy) {
    // El repo es compartido y todos los lotes commitean contra la misma rama,
    // así que solo puede haber un escritor a la vez.
    return error(res, 'Ya hay una sincronización en curso. Intenta en un momento.', 409);
  }

  success(res, { synced: result });
};

module.exports = { sync, syncNow, list, getOne, update };
