'use strict';

const { readPayload } = require('../utils/session');

// Guard de las PÁGINAS, no de la API. Un navegador que pide HTML sin sesión no
// quiere un 401 con JSON: quiere que lo manden al login. Por eso existe aparte
// de requireAuth.
//
// Solo acepta sesiones web. Un agent token nunca debe poder pedir páginas: su
// alcance es reportar sincronizaciones, no navegar el panel.

// Evita un open redirect: solo se acepta una ruta relativa de este mismo sitio.
// Sin esto, /login?next=https://sitio-malo/ mandaría al usuario fuera después
// de escribir su contraseña.
const safeNext = (url) => {
  if (typeof url !== 'string') return null;
  if (!url.startsWith('/')) return null;
  if (url.startsWith('//')) return null; // "//host" es una URL absoluta
  return url;
};

const requireAuthPage = (req, res, next) => {
  const payload = readPayload(req);

  if (!payload || payload.type !== 'user') {
    const next_ = safeNext(req.originalUrl);
    const query = next_ ? `?next=${encodeURIComponent(next_)}` : '';
    return res.redirect(`/login${query}`);
  }

  req.auth = { type: payload.type, userId: payload.userId, role: payload.role };
  // Disponible en todas las vistas sin pasarlo a mano en cada render.
  res.locals.currentUser = { id: payload.userId, role: payload.role };
  return next();
};

module.exports = requireAuthPage;
module.exports.safeNext = safeNext;
