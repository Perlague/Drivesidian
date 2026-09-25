'use strict';

const { error } = require('../utils/response');

// Se aplica DESPUÉS de requireAuth, que es quien pone req.auth.
//
// Los agent tokens no llevan `role` en su payload, así que req.auth.role queda
// undefined y nunca pasan por aquí: un agente no puede tocar nada de admin ni
// aunque su dueño lo sea.
const requireRole = (role) => (req, res, next) => {
  if (req.auth?.role !== role) {
    return error(res, 'No tienes permisos para esta operación.', 403);
  }
  return next();
};

module.exports = requireRole;
