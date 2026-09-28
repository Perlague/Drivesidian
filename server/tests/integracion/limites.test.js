'use strict';

// Los limitadores viven en memoria de cada proceso. Este archivo es el único
// que los agota a propósito.

require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { iniciar, detener, pedir, cookieDeSesion } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, tokenDeAgente, esperarEventos } = require('../helpers/datos');
const { crearGithubFalso } = require('../helpers/githubFalso');

before(async () => {
  await limpiarBase();
  await iniciar();
});
after(async () => {
  await detener();
  await cerrarBase();
});

const rafaga = async (n, fn) => {
  const estados = [];
  for (let i = 0; i < n; i += 1) estados.push((await fn()).status);
  return estados;
};

describe('límites de uso', () => {
  it('login: 10 intentos por minuto por IP, y una sola línea en el feed con el conteo', async () => {
    const estados = await rafaga(25, () =>
      pedir('POST', '/api/users/login', { body: { email: 'x@ejemplo.com', password: 'y' } }),
    );
    assert.deepEqual(estados.slice(0, 10), Array(10).fill(401));
    assert.deepEqual(estados.slice(10), Array(15).fill(429));
    const eventos = await esperarEventos('ratelimit.exceeded');
    await new Promise((r) => setTimeout(r, 200));
    const todos = (await esperarEventos('ratelimit.exceeded')).filter((e) => e.details.path === '/api/users/login');
    assert.equal(todos.length, 1, '15 rechazos, un solo evento');
    assert.equal(eventos[0].details.max, 10);
  });

  it('"sincronizar ahora": 5 por minuto por usuario', async (t) => {
    t.mock.method(globalThis, 'fetch', crearGithubFalso().fetch);
    const usuario = await crearUsuario();
    const cookie = cookieDeSesion(usuario);
    const estados = await rafaga(6, () => pedir('POST', '/api/notes/sync-now', { cookie }));
    assert.deepEqual(estados, [200, 200, 200, 200, 200, 429]);
  });

  it('token de agente: 300 peticiones por hora por token, no por IP', async () => {
    const usuario = await crearUsuario();
    const token = await tokenDeAgente(usuario.id);
    const estados = await rafaga(301, () => pedir('GET', '/api/notes/changes', { token }));
    assert.equal(estados.filter((s) => s === 200).length, 300);
    assert.equal(estados[300], 429);
    const otro = await tokenDeAgente(usuario.id);
    assert.equal((await pedir('GET', '/api/notes/changes', { token: otro })).status, 200, 'otro token, otro contador');
  });

  it('pedir códigos de vinculación: 20 por hora por IP', async () => {
    const hash = crypto.createHash('sha256').update('v').digest('hex');
    const estados = await rafaga(21, () => pedir('POST', '/api/pairing/start', { body: { verifier_hash: hash } }));
    assert.equal(estados.filter((s) => s === 201).length, 20);
    assert.equal(estados[20], 429);
  });
});
