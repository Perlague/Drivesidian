'use strict';

const { verify } = require('./jwt');
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

// El agente manda su token por Authorization; el navegador, por la cookie.
const readToken = (req) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice('Bearer '.length);
  }
  return parseCookies(req.headers.cookie)[SESSION_COOKIE_NAME] || null;
};

const readPayload = (req) => {
  const token = readToken(req);
  if (!token) return null;
  return verify(token, process.env.JWT_SECRET);
};

module.exports = { parseCookies, readToken, readPayload };
