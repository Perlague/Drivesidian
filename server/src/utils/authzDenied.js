'use strict';

const {
  logSecurityEventOncePerWindow,
  SEVERITY,
  EVENTS,
} = require('./securityLog');
const { AUTHZ_DENIED_WINDOW_MS } = require('../config');

// Lo emiten requireRole (API, 403 JSON) y requireRolePage (página, redirección).
// Está aquí y no duplicado en los dos porque es el mismo hecho: alguien sin el
// rol necesario intentó llegar a algo de admin. Qué superficie fue va en
// `details`, para que el feed lo diga sin necesitar dos tipos de evento.
//
// **Una línea por ventana y por cuenta**, no una por petición rechazada. Es la
// misma regla del rate limiting y por el mismo motivo: Guardian lee este feed y
// cada línea le cuesta tokens. Una sesión en bucle contra /api/admin no debe
// llenarlo de líneas idénticas.
//
// A diferencia del limitador, aquí NO va el conteo. Allá el número es lo que
// distingue un dedazo de una ráfaga de diez mil; aquí el hecho ya es la señal
// —una cuenta normal no toca /api/admin sin querer— y llevar la cuenta
// obligaría a un contador propio que no aporta nada a la decisión.
const logAuthzDenied = (req, { rolRequerido, superficie }) => {
  const userId = req.auth?.userId ?? null;

  logSecurityEventOncePerWindow({
    // Sin sesión identificable, la IP es lo único que queda para no colapsar
    // intentos de distintos orígenes en una sola línea.
    key: `authz:${userId ?? req.ip}`,
    windowMs: AUTHZ_DENIED_WINDOW_MS,
    type: EVENTS.AUTHZ_DENIED,
    severity: SEVERITY.WARN,
    userId,
    req,
    details: {
      surface: superficie,
      method: req.method,
      // req.originalUrl incluye la query, que puede traer datos del usuario.
      // Para esta decisión basta la ruta.
      path: req.baseUrl ? `${req.baseUrl}${req.path}` : req.path,
      required_role: rolRequerido,
      actual_role: req.auth?.role ?? null,
    },
  });
};

module.exports = { logAuthzDenied };
