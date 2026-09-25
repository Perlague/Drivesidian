'use strict';

const usersModel = require('../models/users.model');
const securityEventsModel = require('../models/securityEvents.model');
const { securityEventsQuerySchema } = require('../schemas/admin/securityEventsQuery');
const { success, validationError } = require('../utils/response');
const { EVENTS } = require('../utils/securityLog');

// GET /api/admin/users — requireRole('admin') ya filtró el acceso.
const listUsers = async (req, res) => {
  success(res, await usersModel.findAll());
};

// GET /api/admin/security-events — la consulta que respalda el panel. Guardian
// lee el feed de stdout; esto es para revisar el histórico desde la web.
const listSecurityEvents = async (req, res) => {
  const parsed = securityEventsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const events = await securityEventsModel.findAll(parsed.data);
  success(res, events);
};

// GET /api/admin/event-types — el catálogo de tipos, para poblar el filtro del
// panel. Sale del propio módulo de eventos y no de una lista escrita a mano en
// el frontend: así, cuando se agrega un tipo nuevo, el filtro lo recoge solo en
// vez de quedarse desactualizado en silencio.
const listEventTypes = (req, res) => {
  success(res, Object.values(EVENTS).sort());
};

module.exports = { listUsers, listSecurityEvents, listEventTypes };
