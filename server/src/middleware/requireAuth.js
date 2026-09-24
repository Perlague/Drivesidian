'use strict';

const crypto = require('crypto');
const { verify } = require('../utils/jwt');
const { error } = require('../utils/response');
const { logSecurityEvent, SEVERITY, EVENTS } = require('../utils/securityLog');
const { SESSION_COOKIE_NAME } = require('../config');
const agentTokensModel = require('../models/agentTokens.model');

const hashJti = (jti) => crypto.createHash('sha256').update(jti).digest('hex');

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
const requireAuth = async (req, res, next) => {
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

  // La sesión web no toca la base (JWT corto, sin revocación individual).
  // El agent token sí: es de larga duración y debe poder revocarse desde el
  // panel, así que cada request valida contra agent_tokens.
  if (payload.type === 'agent') {
    const activeToken = await agentTokensModel.findActiveByHash(hashJti(payload.jti));
    if (!activeToken || activeToken.user_id !== payload.userId) {
      // Un agent token con firma válida que ya no está activo significa o un
      // agente que quedó corriendo tras una revocación, o un token filtrado
      // en uso. Los dos casos le interesan a Guardian.
      logSecurityEvent({
        type: EVENTS.TOKEN_USED_AFTER_REVOKE,
        severity: SEVERITY.CRITICAL,
        userId: payload.userId,
        req,
        details: { path: req.originalUrl, method: req.method },
      });
      return error(res, 'Token de agente revocado o inválido.', 401);
    }
  }

  // jti solo lo traen los agent tokens: es la clave con la que se les aplica el
  // rate limit, en lugar de la IP (un portátil cambia de red constantemente).
  req.auth = {
    type: payload.type,
    userId: payload.userId,
    role: payload.role,
    jti: payload.jti || null,
  };
  next();
};

module.exports = requireAuth;
