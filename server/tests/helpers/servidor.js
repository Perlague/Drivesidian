'use strict';

// Levanta la app real en un puerto efímero y ofrece un cliente HTTP mínimo.
// Se usa la aplicación completa —middleware, rutas, base de datos— y no mocks:
// los defectos más caros de este proyecto fueron de integración.

const { fetchReal } = require('./entorno');
const app = require('../../src/app');
const { sign } = require('../../src/utils/jwt');
const { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } = require('../../src/config');

let servidor = null;
let base = null;

const iniciar = () =>
  new Promise((resolve) => {
    servidor = app.listen(0, '127.0.0.1', () => {
      base = `http://127.0.0.1:${servidor.address().port}`;
      resolve(base);
    });
  });

const detener = () =>
  new Promise((resolve) => {
    if (!servidor) return resolve();
    servidor.closeAllConnections();
    return servidor.close(() => resolve());
  });

// { status, body, texto, headers }. body es el JSON parseado o null.
const pedir = async (metodo, ruta, { body, cookie, token, headers = {}, crudo } = {}) => {
  const cabeceras = { ...headers };
  if (body !== undefined && crudo === undefined) cabeceras['content-type'] = 'application/json';
  if (cookie) cabeceras.cookie = cookie;
  if (token) cabeceras.authorization = `Bearer ${token}`;

  const res = await fetchReal(`${base}${ruta}`, {
    method: metodo,
    headers: cabeceras,
    body: crudo !== undefined ? crudo : body !== undefined ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  const texto = await res.text();
  let json = null;
  try {
    json = JSON.parse(texto);
  } catch {
    json = null;
  }
  return { status: res.status, body: json, texto, headers: res.headers };
};

// Cookie de sesión firmada directamente, sin pasar por el login. Sirve para que
// las pruebas que no son del login no consuman el límite de 10 intentos por
// minuto que tiene ese endpoint.
const cookieDeSesion = ({ id, role = 'user' }) =>
  `${SESSION_COOKIE_NAME}=${sign({ type: 'user', userId: id, role }, process.env.JWT_SECRET, SESSION_TTL_SECONDS)}`;

// Extrae la cookie de sesión de un Set-Cookie real.
const cookieDeRespuesta = (res) => {
  const cookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : [];
  const sesion = cookies.find((c) => c.startsWith(`${SESSION_COOKIE_NAME}=`));
  return sesion ? sesion.split(';')[0] : null;
};

module.exports = { iniciar, detener, pedir, cookieDeSesion, cookieDeRespuesta };
