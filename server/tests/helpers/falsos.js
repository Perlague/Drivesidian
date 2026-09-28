'use strict';

// Petición y respuesta mínimas de Express, para probar middleware aislado.

const resFalsa = () => ({
  statusCode: 200,
  cabeceras: {},
  cuerpo: null,
  redirigido: null,
  status(codigo) {
    this.statusCode = codigo;
    return this;
  },
  json(cuerpo) {
    this.cuerpo = cuerpo;
    return this;
  },
  set(nombre, valor) {
    this.cabeceras[nombre.toLowerCase()] = valor;
    return this;
  },
  setHeader(nombre, valor) {
    this.cabeceras[nombre.toLowerCase()] = valor;
  },
  removeHeader(nombre) {
    delete this.cabeceras[nombre.toLowerCase()];
  },
  redirect(url) {
    this.redirigido = url;
  },
});

const reqFalsa = (extra = {}) => ({
  method: 'GET',
  ip: '203.0.113.10',
  headers: {},
  originalUrl: '/',
  path: '/',
  baseUrl: '',
  query: {},
  ...extra,
});

// Ejecuta un middleware y dice si llamó a next().
const correr = async (middleware, req, res) => {
  let siguio = false;
  await middleware(req, res, () => {
    siguio = true;
  });
  return siguio;
};

module.exports = { resFalsa, reqFalsa, correr };
