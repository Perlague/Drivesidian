'use strict';

const { verify } = require('../utils/jwt');
const { error } = require('../utils/response');
const { SESSION_COOKIE_NAME } = require('../config');

// Parser manual de cookies (sin cookie-parser): solo necesitamos LEER una
// cookie en requests entrantes, Express ya trae res.cookie() para escribirla.
const parseCookies = (cookieHeader = '') => {
  const cookies = {};
  cookieHeader.split(';').forEach((pair) => {
    const idx = pair.indexOf('=');
    if (idx === -1) return;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(value);
  });
  return cookies;
};

// Acepta dos formas de autenticación, ambas JWT propios pero con distinto
// origen y vida útil: sesión web (cookie httpOnly) o agent token (header
// Authorization: Bearer). El claim `type` del payload distingue cuál es cuál
// para el resto de la app (ver resolución de conflictos de notes).
const requireAuth = (req, res, next) => {
  const authHeader = req.headers.authorization;
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice('Bearer '.length);
  } else {
    const cookies = parseCookies(req.headers.cookie);
    token = cookies[SESSION_COOKIE_NAME] || null;
  }

  if (!token) {
    return error(res, 'No autenticado.', 401);
  }

  const payload = verify(token, process.env.JWT_SECRET);
  if (!payload) {
    return error(res, 'Sesión inválida o expirada.', 401);
  }

  req.auth = { type: payload.type, userId: payload.userId, role: payload.role };
  next();
};

module.exports = requireAuth;
