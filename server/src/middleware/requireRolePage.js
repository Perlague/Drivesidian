'use strict';

// Equivalente de requireRole para PÁGINAS. Existe aparte porque aquel responde
// 403 con JSON, y un navegador que pidió HTML no quiere un objeto en pantalla:
// quiere ir a donde sí puede estar.
//
// Se aplica DESPUÉS de requireAuthPage, que es quien pone req.auth.
const requireRolePage = (role) => (req, res, next) => {
  if (req.auth?.role !== role) return res.redirect('/notes');
  return next();
};

module.exports = requireRolePage;
