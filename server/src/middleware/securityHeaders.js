'use strict';

// Encabezados de seguridad de las páginas del panel.
//
// **Viven aquí y no en el Caddyfile a propósito.** Estaban ahí hasta que se
// añadió el despliegue con ngrok, que va directo al servidor sin pasar por
// Caddy: la CSP se quedaba sin aplicar justo en el modo más fácil de levantar,
// que es el que alguien usaría para una demo. La app es además quien sabe qué
// carga, así que es quien puede mantener la política al día.
//
// Caddy conserva lo que sí es suyo: TLS, gzip y el tope de body de la red
// exterior. No duplica estos encabezados — dos CSP distintas se aplican como la
// intersección de ambas, y depurar eso no es gratis.

// CSP estricta: ni 'unsafe-inline' ni ningún origen externo. Es la segunda línea
// de defensa del preview del editor — un <script> que se colara pese a
// DOMPurify no se ejecutaría igual.
//
// Para que esto sea posible NO hay estilos ni scripts en línea en web/views/
// (los datos del servidor viajan como atributos data-* del <body>, ver
// partials/head.ejs) y `marked` y DOMPurify se sirven desde web/public/vendor/
// en vez de cdnjs.
//
// **Nunca añadir 'unsafe-inline' "para que algo funcione"**: anula casi todo lo
// que este encabezado protege. Si una vista nueva lo necesita, se arregla la
// vista.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  // data: es para los QR, que se generan en el servidor y se mandan como data
  // URL. Las imágenes remotas de una nota quedan fuera a propósito: una <img> a
  // un servidor ajeno avisaría a su dueño cada vez que alguien abre la nota.
  "img-src 'self' data:",
  "connect-src 'self'",
  "form-action 'self'",
  "base-uri 'none'",
  "frame-ancestors 'none'",
].join('; ');

const securityHeaders = (req, res, next) => {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // HSTS solo tiene sentido sobre una conexión que ya es HTTPS: mandarlo por
  // HTTP plano no hace nada, y en desarrollo local comprometería `localhost` a
  // servir HTTPS en el navegador del desarrollador durante un año.
  //
  // req.secure mira X-Forwarded-Proto cuando Express confía en el proxy (ver
  // TRUST_PROXY), que es como llega detrás de Caddy o de ngrok.
  if (req.secure) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Express lo pone por defecto y delata la tecnología del servidor.
  res.removeHeader('X-Powered-By');

  return next();
};

module.exports = securityHeaders;
module.exports.CSP = CSP;
