'use strict';

const rateLimit = require('./rateLimit');
const { LOGIN_RATE_LIMIT } = require('../config');

// Protege el login completo, que es donde se verifica el código TOTP en este
// diseño. Va por IP: el atacante no tiene sesión ni token todavía. Es la
// defensa contra fuerza bruta repartida entre varias cuentas, complementaria al
// bloqueo por cuenta de failed_2fa_attempts.
module.exports = rateLimit({
  ...LOGIN_RATE_LIMIT,
  keyBy: (req) => req.ip,
});
