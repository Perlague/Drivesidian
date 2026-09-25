'use strict';

const { logAuthzDenied } = require('../utils/authzDenied');

// Equivalente de requireRole para PÁGINAS. Existe aparte porque aquel responde
// 403 con JSON, y un navegador que pidió HTML no quiere un objeto en pantalla:
// quiere ir a donde sí puede estar.
//
// Se aplica DESPUÉS de requireAuthPage, que es quien pone req.auth.
const requireRolePage = (role) => (req, res, next) => {
  if (req.auth?.role !== role) {
    // Se registra igual que en la API, con `surface` distinto: teclear /admin en
    // la barra es mucho más inocente que llamar a /api/admin/users, y el feed
    // tiene que poder separarlos sin dos tipos de evento.
    logAuthzDenied(req, { rolRequerido: role, superficie: 'page' });
    return res.redirect('/notes');
  }
  return next();
};

module.exports = requireRolePage;
