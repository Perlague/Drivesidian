'use strict';

const usersModel = require('../models/users.model');
const securityEventsModel = require('../models/securityEvents.model');
const { securityEventsQuerySchema } = require('../schemas/admin/securityEventsQuery');
const { success, validationError } = require('../utils/response');

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

module.exports = { listUsers, listSecurityEvents };
