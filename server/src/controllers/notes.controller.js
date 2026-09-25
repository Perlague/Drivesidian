'use strict';

const { syncSchema } = require('../schemas/notes/sync');
const { updateSchema } = require('../schemas/notes/update');
const { changesQuerySchema } = require('../schemas/notes/changes');
const { resolveSchema } = require('../schemas/notes/resolve');
const notesModel = require('../models/notes.model');
const { success, error, validationError, conflict } = require('../utils/response');
const {
  logSecurityEvent,
  logSecurityEventOncePerWindow,
  SEVERITY,
  EVENTS,
} = require('../utils/securityLog');
const { runSyncForUser } = require('../workers/syncWorker');
const {
  MAX_NOTES_PER_USER,
  NOTES_CHANGES_LIMIT,
  BULK_READ_THRESHOLD,
  BULK_READ_WINDOW_MS,
} = require('../config');

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

  const { outcome, note } = await notesModel.syncFromAgent(
    req.auth.userId,
    parsed.data.vault_path,
    parsed.data.content,
    parsed.data.base_version ?? null,
  );

  if (outcome === 'conflict') {
    return conflict(
      res,
      { content: note.conflict_content, version: null },
      { content: note.content, version: note.version },
    );
  }

  // 'unchanged' significa que el contenido era idéntico al guardado y no se
  // reencoló nada. Se responde 200 igual: desde el punto de vista del agente
  // el reporte se aceptó. El flag va en el payload para su log.
  success(res, { ...note, changed: outcome !== 'unchanged', outcome });
};

// GET /api/notes/changes — exclusivo del agente, con alcance notes:read.
// Es la mitad de bajada de la sincronización: el servidor no puede empujar
// porque el agente está detrás del NAT del usuario, así que el agente pregunta.
const changes = async (req, res) => {
  if (req.auth.type !== 'agent') {
    return error(res, 'Este endpoint es exclusivo del agente.', 403);
  }

  const parsed = changesQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const { since, since_id: sinceId } = parsed.data;
  const cursor = since ? { since, sinceId } : null;
  const notes = await notesModel.findChangedSince(req.auth.userId, cursor, NOTES_CHANGES_LIMIT);

  // Un agente al día pide unas pocas notas; alguien llevándose todo pide
  // tandas grandes. Un evento por ventana, no por petición: si fuera por
  // petición, exfiltrar 2000 notas produciría diez líneas idénticas.
  if (notes.length >= BULK_READ_THRESHOLD) {
    logSecurityEventOncePerWindow({
      key: `bulk_read:${req.auth.jti}`,
      windowMs: BULK_READ_WINDOW_MS,
      type: EVENTS.NOTES_BULK_READ,
      severity: SEVERITY.WARN,
      userId: req.auth.userId,
      req,
      details: { notes: notes.length, since: since || 'desde el principio' },
    });
  }

  const ultima = notes[notes.length - 1];
  success(res, {
    // cursor_at es de uso interno del cursor; el agente no lo necesita por nota.
    notes: notes.map(({ cursor_at, ...nota }) => nota),
    // El cursor sale del servidor y no del reloj del agente: es el único que no
    // sufre desfases entre máquinas.
    cursor: ultima ? { since: ultima.cursor_at, since_id: String(ultima.id) } : null,
    has_more: notes.length === NOTES_CHANGES_LIMIT,
  });
};

// POST /api/notes/:id/resolve — exclusivo de la web. El agente nunca resuelve
// un conflicto: corre en segundo plano sin nadie mirando.
const resolve = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }
  if (!/^\d+$/.test(req.params.id)) {
    return error(res, 'id inválido.', 400);
  }

  const parsed = resolveSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const resuelta =
    parsed.data.keep === 'local'
      ? await notesModel.resolveKeepLocal(req.params.id, req.auth.userId)
      : await notesModel.resolveKeepServer(req.params.id, req.auth.userId);

  if (!resuelta) {
    return error(res, 'Esa nota no existe o ya no está en conflicto.', 404);
  }

  success(res, resuelta);
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

  // Guardar sobre una nota en conflicto crearía un tercer estado, y el usuario
  // perdería de vista que hay una decisión pendiente. Primero se resuelve.
  const actual = await notesModel.findByIdForUser(req.params.id, req.auth.userId);
  if (!actual) {
    return error(res, 'Nota no encontrada.', 404);
  }
  if (actual.conflict_content !== null) {
    return error(res, 'Esta nota tiene un conflicto sin resolver. Resuélvelo antes de editarla.', 409);
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

module.exports = { sync, syncNow, changes, resolve, list, getOne, update };
