'use strict';

const { error } = require('../utils/response');

// Se aplica DESPUÉS de requireAuth, que es quien pone req.auth.scope.
//
// Solo afecta a los agent tokens: la sesión web no lleva alcances porque su
// permiso es el rol del usuario, no una capacidad del token. Una petición de
// sesión web pasa de largo y la controla requireRole o el propio controller.
const requireScope = (scope) => (req, res, next) => {
  if (req.auth?.type !== 'agent') return next();

  if (!req.auth.scope?.includes(scope)) {
    return error(res, `Este token no tiene permiso para ${scope}.`, 403);
  }

  return next();
};

module.exports = requireScope;
