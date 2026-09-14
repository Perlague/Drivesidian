'use strict';

const { error } = require('../utils/response');

const WINDOW_MS = 60 * 1000;
const MAX_REQUESTS = 10;

// Limitador en memoria por IP, sin Redis (una sola instancia EC2, ver
// CLAUDE.md). No sobrevive un restart del proceso ni escala a múltiples
// instancias — aceptable para el tamaño actual del proyecto. Protege el
// login completo, que es donde se verifica el código TOTP en este diseño.
const hits = new Map();

const rateLimit2fa = (req, res, next) => {
  const ip = req.ip;
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((timestamp) => now - timestamp < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);

  if (recent.length > MAX_REQUESTS) {
    return error(res, 'Demasiados intentos. Intenta de nuevo en un minuto.', 429);
  }

  next();
};

module.exports = rateLimit2fa;
