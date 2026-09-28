'use strict';

require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, detener, pedir, cookieDeSesion } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, tokenDeAgente, esperarEventos } = require('../helpers/datos');

let ana;
let admin;

before(async () => {
  await limpiarBase();
  await iniciar();
  ana = await crearUsuario();
  admin = await crearUsuario({ role: 'admin' });
});
after(async () => {
  await detener();
  await cerrarBase();
});

describe('tokens de agente desde el panel', () => {
  it('el token se muestra UNA vez; después solo se listan sus datos', async () => {
    const cookie = cookieDeSesion(ana);
    const creado = await pedir('POST', '/api/agent-tokens', { cookie });
    assert.equal(creado.status, 201);
    assert.equal(creado.body.data.token.split('.').length, 3);
    await esperarEventos('token.created', { userId: ana.id });

    const lista = await pedir('GET', '/api/agent-tokens', { cookie });
    assert.equal(lista.body.data.length, 1);
    assert.equal(lista.body.data[0].token, undefined);
    assert.equal(lista.body.data[0].token_hash, undefined);
  });

  it('revocarlo lo deja inservible al instante', async () => {
    const cookie = cookieDeSesion(ana);
    const { body } = await pedir('POST', '/api/agent-tokens', { cookie });
    const revocado = await pedir('DELETE', `/api/agent-tokens/${body.data.id}`, { cookie });
    assert.equal(revocado.status, 200);
    assert.equal((await pedir('GET', '/api/notes/changes', { token: body.data.token })).status, 401);
    assert.equal((await pedir('DELETE', `/api/agent-tokens/${body.data.id}`, { cookie })).status, 404);
    await esperarEventos('token.revoked', { userId: ana.id });
  });

  it('nadie revoca tokens ajenos', async () => {
    const { body } = await pedir('POST', '/api/agent-tokens', { cookie: cookieDeSesion(ana) });
    const res = await pedir('DELETE', `/api/agent-tokens/${body.data.id}`, { cookie: cookieDeSesion(admin) });
    assert.equal(res.status, 404);
    assert.equal((await pedir('DELETE', '/api/agent-tokens/abc', { cookie: cookieDeSesion(ana) })).status, 400);
  });

  it('un agente no crea, lista ni revoca tokens: solo puede autorrevocarse', async () => {
    const token = await tokenDeAgente(ana.id);
    assert.equal((await pedir('POST', '/api/agent-tokens', { token })).status, 403);
    assert.equal((await pedir('GET', '/api/agent-tokens', { token })).status, 403);
    assert.equal((await pedir('DELETE', '/api/agent-tokens/1', { token })).status, 403);
  });

  it('el desinstalador revoca su propio token y ya no puede usarlo', async () => {
    const token = await tokenDeAgente(ana.id);
    const res = await pedir('DELETE', '/api/agent-tokens/self', { token });
    assert.equal(res.status, 200);
    assert.equal((await pedir('GET', '/api/notes/changes', { token })).status, 401);
    assert.equal((await pedir('DELETE', '/api/agent-tokens/self', { cookie: cookieDeSesion(ana) })).status, 403);
  });
});

describe('administración', () => {
  it('un usuario normal recibe 403 y queda registrado como authz.denied', async () => {
    const res = await pedir('GET', '/api/admin/users', { cookie: cookieDeSesion(ana) });
    assert.equal(res.status, 403);
    const [evento] = await esperarEventos('authz.denied', { userId: ana.id });
    assert.equal(evento.details.surface, 'api');
    assert.equal(evento.details.path, '/api/admin/users');
  });

  it('el administrador lista usuarios sin ver hashes ni secretos', async () => {
    const res = await pedir('GET', '/api/admin/users', { cookie: cookieDeSesion(admin) });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 2);
    for (const u of res.body.data) {
      assert.equal(u.password_hash, undefined);
      assert.equal(u.totp_secret, undefined);
    }
  });

  it('consulta eventos filtrando por tipo y severidad', async () => {
    const cookie = cookieDeSesion(admin);
    const porTipo = await pedir('GET', '/api/admin/security-events?type=token.created', { cookie });
    assert.ok(porTipo.body.data.length >= 1);
    assert.ok(porTipo.body.data.every((e) => e.type === 'token.created'));

    const desde = new Date(Date.now() - 60_000).toISOString();
    const hasta = new Date(Date.now() + 60_000).toISOString();
    const porRango = await pedir(
      'GET',
      `/api/admin/security-events?severity=warn&since=${desde}&until=${hasta}&limit=5&offset=0`,
      { cookie },
    );
    assert.equal(porRango.status, 200);
    assert.ok(porRango.body.data.every((e) => e.severity === 'warn'));
  });

  it('valida los filtros', async () => {
    const cookie = cookieDeSesion(admin);
    assert.equal((await pedir('GET', '/api/admin/security-events?severity=grave', { cookie })).status, 400);
    assert.equal((await pedir('GET', '/api/admin/security-events?limit=501', { cookie })).status, 400);
  });

  it('publica el catálogo cerrado de 20 tipos de evento', async () => {
    const res = await pedir('GET', '/api/admin/event-types', { cookie: cookieDeSesion(admin) });
    assert.equal(res.body.data.length, 20);
    assert.deepEqual(res.body.data, [...res.body.data].sort());
  });
});
