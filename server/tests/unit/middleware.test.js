'use strict';

const { feed } = require('../helpers/entorno');
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { resFalsa, reqFalsa, correr } = require('../helpers/falsos');
const { cerrarBase } = require('../helpers/datos');
const securityHeaders = require('../../src/middleware/securityHeaders');
const requireScope = require('../../src/middleware/requireScope');
const requireRole = require('../../src/middleware/requireRole');
const requireRolePage = require('../../src/middleware/requireRolePage');
const requireAuthPage = require('../../src/middleware/requireAuthPage');
const rateLimit = require('../../src/middleware/rateLimit');
const { safeNext } = require('../../src/middleware/requireAuthPage');
const { parseCookies, readToken, readPayload } = require('../../src/utils/session');
const { success, error, validationError, conflict } = require('../../src/utils/response');
const { sign } = require('../../src/utils/jwt');
const { z } = require('zod');

after(cerrarBase);

describe('encabezados de seguridad', () => {
  it('pone una CSP estricta sin unsafe-inline ni orígenes externos', async () => {
    const res = resFalsa();
    res.cabeceras['x-powered-by'] = 'Express';
    assert.equal(await correr(securityHeaders, reqFalsa({ secure: false }), res), true);
    const csp = res.cabeceras['content-security-policy'];
    assert.match(csp, /default-src 'none'/);
    assert.match(csp, /script-src 'self'/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.doesNotMatch(csp, /unsafe-inline/);
    assert.doesNotMatch(csp, /https?:/);
    assert.equal(res.cabeceras['x-content-type-options'], 'nosniff');
    assert.equal(res.cabeceras['x-frame-options'], 'DENY');
    assert.equal(res.cabeceras['x-powered-by'], undefined);
  });

  it('aísla el panel de otros orígenes y no deja datos privados en cachés', async () => {
    const res = resFalsa();
    await correr(securityHeaders, reqFalsa({ secure: false }), res);
    assert.match(res.cabeceras['permissions-policy'], /camera=\(\)/);
    assert.equal(res.cabeceras['cross-origin-opener-policy'], 'same-origin');
    assert.equal(res.cabeceras['cross-origin-resource-policy'], 'same-origin');
    assert.equal(res.cabeceras['cross-origin-embedder-policy'], 'require-corp');
    assert.equal(res.cabeceras['cache-control'], 'no-store');
  });

  it('manda HSTS solo sobre HTTPS, nunca por HTTP plano', async () => {
    const http = resFalsa();
    await correr(securityHeaders, reqFalsa({ secure: false }), http);
    assert.equal(http.cabeceras['strict-transport-security'], undefined);

    const https = resFalsa();
    await correr(securityHeaders, reqFalsa({ secure: true }), https);
    assert.match(https.cabeceras['strict-transport-security'], /max-age=31536000/);
  });
});

describe('alcances del token de agente', () => {
  it('deja pasar a la sesión web: los alcances son solo del agente', async () => {
    assert.equal(await correr(requireScope('notes:write'), reqFalsa({ auth: { type: 'user' } }), resFalsa()), true);
  });

  it('deja pasar a un token con el alcance pedido', async () => {
    const req = reqFalsa({ auth: { type: 'agent', scope: ['notes:read', 'notes:write'] } });
    assert.equal(await correr(requireScope('notes:write'), req, resFalsa()), true);
  });

  it('corta con 403 a un token sin ese alcance', async () => {
    const res = resFalsa();
    const req = reqFalsa({ auth: { type: 'agent', scope: ['notes:read'] } });
    assert.equal(await correr(requireScope('notes:write'), req, res), false);
    assert.equal(res.statusCode, 403);
  });
});

describe('control por rol', () => {
  it('deja pasar al rol correcto', async () => {
    assert.equal(await correr(requireRole('admin'), reqFalsa({ auth: { role: 'admin', userId: 1 } }), resFalsa()), true);
  });

  it('responde 403 y emite authz.denied UNA vez por ventana, no una por intento', async () => {
    const antes = feed.length;
    for (let i = 0; i < 5; i += 1) {
      const res = resFalsa();
      const req = reqFalsa({ auth: { role: 'user', userId: 91 }, method: 'GET', baseUrl: '/api/admin', path: '/users' });
      assert.equal(await correr(requireRole('admin'), req, res), false);
      assert.equal(res.statusCode, 403);
    }
    const nuevos = feed.slice(antes).filter((e) => e.type === 'authz.denied');
    assert.equal(nuevos.length, 1);
    assert.equal(nuevos[0].severity, 'warn');
    assert.equal(nuevos[0].details.surface, 'api');
    assert.equal(nuevos[0].details.required_role, 'admin');
    assert.equal(nuevos[0].details.actual_role, 'user');
  });

  it('en páginas redirige a /notes en vez de mostrar un error', async () => {
    const res = resFalsa();
    assert.equal(await correr(requireRolePage('admin'), reqFalsa({ auth: { role: 'user', userId: 92 } }), res), false);
    assert.equal(res.redirigido, '/notes');
    assert.equal(await correr(requireRolePage('admin'), reqFalsa({ auth: { role: 'admin' } }), resFalsa()), true);
  });
});

describe('guardia de páginas', () => {
  it('solo acepta rutas internas como destino después del login (evita open redirect)', () => {
    assert.equal(safeNext('/pair?code=AB'), '/pair?code=AB');
    assert.equal(safeNext('https://malicioso.com'), null);
    assert.equal(safeNext('//malicioso.com'), null);
    assert.equal(safeNext(undefined), null);
  });

  it('sin sesión manda al login recordando a dónde iba', async () => {
    const res = resFalsa();
    assert.equal(await correr(requireAuthPage, reqFalsa({ originalUrl: '/notes/5' }), res), false);
    assert.equal(res.redirigido, '/login?next=%2Fnotes%2F5');
  });

  it('un token de agente no abre páginas del panel', async () => {
    const token = sign({ type: 'agent', userId: 1 }, process.env.JWT_SECRET);
    const res = resFalsa();
    const req = reqFalsa({ headers: { authorization: `Bearer ${token}` }, originalUrl: '/notes' });
    assert.equal(await correr(requireAuthPage, req, res), false);
  });

  it('con sesión web deja pasar y expone al usuario a la vista', async () => {
    const token = sign({ type: 'user', userId: 3, role: 'user' }, process.env.JWT_SECRET, 60);
    const res = resFalsa();
    res.locals = {};
    const req = reqFalsa({ headers: { cookie: `drivesidian_session=${token}` } });
    assert.equal(await correr(requireAuthPage, req, res), true);
    assert.deepEqual(res.locals.currentUser, { id: 3, role: 'user' });
  });
});

describe('limitador de peticiones', () => {
  it('deja pasar hasta el tope, luego 429 con Retry-After, y un solo evento con el conteo', async () => {
    const antes = feed.length;
    const limitador = rateLimit({ windowMs: 60_000, max: 3, keyBy: (req) => req.ip });
    const resultados = [];
    let ultima;
    for (let i = 0; i < 10; i += 1) {
      ultima = resFalsa();
      resultados.push(await correr(limitador, reqFalsa({ ip: '198.51.100.7' }), ultima));
    }
    assert.deepEqual(resultados, [true, true, true, false, false, false, false, false, false, false]);
    assert.equal(ultima.statusCode, 429);
    assert.equal(ultima.cabeceras['retry-after'], '60');
    const eventos = feed.slice(antes).filter((e) => e.type === 'ratelimit.exceeded');
    assert.equal(eventos.length, 1, 'una línea por ventana, no una por rechazo');
    assert.equal(eventos[0].details.hits, 4);
    assert.equal(eventos[0].details.max, 3);
  });

  it('cada clave tiene su propio contador', async () => {
    const limitador = rateLimit({ windowMs: 60_000, max: 1, keyBy: (req) => req.ip });
    assert.equal(await correr(limitador, reqFalsa({ ip: '192.0.2.1' }), resFalsa()), true);
    assert.equal(await correr(limitador, reqFalsa({ ip: '192.0.2.2' }), resFalsa()), true);
    assert.equal(await correr(limitador, reqFalsa({ ip: '192.0.2.1' }), resFalsa()), false);
  });

  it('ignora las peticiones sin clave', async () => {
    const limitador = rateLimit({ windowMs: 60_000, max: 0, keyBy: () => null });
    assert.equal(await correr(limitador, reqFalsa(), resFalsa()), true);
  });

  it('la ventana se renueva al pasar el tiempo', async (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 5_000_000 });
    const limitador = rateLimit({ windowMs: 1_000, max: 1, keyBy: () => 'k' });
    assert.equal(await correr(limitador, reqFalsa(), resFalsa()), true);
    assert.equal(await correr(limitador, reqFalsa(), resFalsa()), false);
    t.mock.timers.tick(1_001);
    assert.equal(await correr(limitador, reqFalsa(), resFalsa()), true);
  });
});

describe('sesión y respuestas', () => {
  it('lee cookies y tokens por cabecera o por cookie', () => {
    assert.deepEqual(parseCookies('a=1; b=hola%20mundo; roto'), { a: '1', b: 'hola mundo' });
    assert.equal(readToken({ headers: { authorization: 'Bearer abc' } }), 'abc');
    assert.equal(readToken({ headers: { cookie: 'drivesidian_session=xyz' } }), 'xyz');
    assert.equal(readToken({ headers: {} }), null);
    assert.equal(readPayload({ headers: {} }), null);
  });

  it('da el mismo formato a éxitos, errores, validaciones y conflictos', () => {
    const ok = resFalsa();
    success(ok, { a: 1 }, 201);
    assert.deepEqual([ok.statusCode, ok.cuerpo], [201, { success: true, data: { a: 1 } }]);

    const mal = resFalsa();
    error(mal, 'no', 403, 'twofa_required');
    assert.deepEqual(mal.cuerpo, { success: false, error: { message: 'no', code: 'twofa_required' } });

    const val = resFalsa();
    validationError(val, z.object({ x: z.string() }).safeParse({}).error);
    assert.equal(val.statusCode, 400);
    assert.ok(val.cuerpo.error.fields.x);

    const conf = resFalsa();
    conflict(conf, { version: 1 }, { version: 2 });
    assert.equal(conf.statusCode, 409);
    assert.equal(conf.cuerpo.conflict.reason, 'version_mismatch');
  });
});
