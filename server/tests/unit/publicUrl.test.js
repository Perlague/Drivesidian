'use strict';

require('../helpers/entorno');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { respuesta } = require('../helpers/githubFalso');
const publicUrl = require('../../src/utils/publicUrl');

const tuneles = (lista) => async () => respuesta(200, { tunnels: lista });
const sinNgrok = async () => {
  throw new Error('ECONNREFUSED');
};

beforeEach(() => {
  delete process.env.PUBLIC_URL;
  delete process.env.DOMAIN;
  delete process.env.USE_NGROK;
});

describe('resolución de la URL pública', () => {
  it('PUBLIC_URL gana sobre todo lo demás y se le quita la barra final', async (t) => {
    t.mock.method(globalThis, 'fetch', tuneles([{ proto: 'https', public_url: 'https://tunel.ngrok.app' }]));
    process.env.PUBLIC_URL = 'https://mio.com/';
    process.env.DOMAIN = 'otro.com';
    assert.deepEqual(await publicUrl.resolver(), { url: 'https://mio.com', fuente: 'PUBLIC_URL' });
  });

  it('sin PUBLIC_URL pregunta al túnel de ngrok y prefiere el https', async (t) => {
    t.mock.method(
      globalThis,
      'fetch',
      tuneles([
        { proto: 'http', public_url: 'http://tunel.ngrok.app' },
        { proto: 'https', public_url: 'https://tunel.ngrok.app/' },
      ]),
    );
    assert.deepEqual(await publicUrl.resolver(), { url: 'https://tunel.ngrok.app', fuente: 'ngrok' });
    assert.equal(publicUrl.getPublicUrl(), 'https://tunel.ngrok.app');
    assert.equal(publicUrl.getFuente(), 'ngrok');
  });

  it('sin túnel usa el dominio', async (t) => {
    t.mock.method(globalThis, 'fetch', sinNgrok);
    process.env.DOMAIN = 'drivesidian.ejemplo.com';
    assert.deepEqual(await publicUrl.resolver(), { url: 'https://drivesidian.ejemplo.com', fuente: 'DOMAIN' });
  });

  it('ignora respuestas raras de ngrok', async (t) => {
    t.mock.method(globalThis, 'fetch', async () => respuesta(500, {}));
    process.env.DOMAIN = 'a.com';
    assert.equal((await publicUrl.resolver()).fuente, 'DOMAIN');

    t.mock.method(globalThis, 'fetch', async () => respuesta(200, { tunnels: 'no es lista' }));
    assert.equal((await publicUrl.resolver()).fuente, 'DOMAIN');

    t.mock.method(globalThis, 'fetch', tuneles([{ proto: 'https' }]));
    assert.equal((await publicUrl.resolver()).fuente, 'DOMAIN');
  });

  it('sin nada configurado cae a localhost; DOMAIN=localhost no cuenta como dominio', async (t) => {
    t.mock.method(globalThis, 'fetch', sinNgrok);
    process.env.DOMAIN = 'localhost';
    assert.deepEqual(await publicUrl.resolver(), { url: 'http://127.0.0.1:3000', fuente: 'local' });
  });

  it('al arrancar con PUBLIC_URL no espera a nadie', async (t) => {
    t.mock.method(globalThis, 'fetch', sinNgrok);
    process.env.PUBLIC_URL = 'https://fijo.com';
    assert.deepEqual(await publicUrl.iniciarResolucion(), { url: 'https://fijo.com', fuente: 'PUBLIC_URL' });
  });

  it('sin ngrok configurado resuelve una sola vez', async (t) => {
    const fetchFalso = t.mock.fn(sinNgrok);
    t.mock.method(globalThis, 'fetch', fetchFalso);
    const { fuente } = await publicUrl.iniciarResolucion();
    assert.equal(fuente, 'local');
    assert.equal(fetchFalso.mock.callCount(), 1);
  });

  it('con ngrok refresca la URL cada minuto y detecta que cambió', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    process.env.USE_NGROK = '1';
    let actual = 'https://primera.ngrok.app';
    t.mock.method(globalThis, 'fetch', async () => respuesta(200, { tunnels: [{ proto: 'https', public_url: actual }] }));

    assert.equal((await publicUrl.iniciarResolucion()).url, 'https://primera.ngrok.app');
    actual = 'https://segunda.ngrok.app';
    t.mock.timers.tick(60_000);
    for (let i = 0; i < 5; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(publicUrl.getPublicUrl(), 'https://segunda.ngrok.app');
  });
});
