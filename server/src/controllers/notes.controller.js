'use strict';

const { syncSchema } = require('../schemas/notes/sync');
const { updateSchema } = require('../schemas/notes/update');
const notesModel = require('../models/notes.model');
const { success, error, validationError, conflict } = require('../utils/response');

// PUT /api/notes/sync — exclusivo del agente. Upsert por vault_path, nunca
// compara version (ver "Resolución de conflictos" en el CLAUDE.md).
const sync = async (req, res) => {
  if (req.auth.type !== 'agent') {
    return error(res, 'Este endpoint es exclusivo del agente.', 403);
  }

  const parsed = syncSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const note = await notesModel.upsertFromAgent(req.auth.userId, parsed.data.vault_path, parsed.data.content);
  success(res, note);
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

module.exports = { sync, list, getOne, update };
