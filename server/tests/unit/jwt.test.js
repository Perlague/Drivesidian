'use strict';

require('../helpers/entorno');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { sign, verify } = require('../../src/utils/jwt');

const SECRETO = 'secreto-de-prueba';
const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');

describe('JWT propio (HS256)', () => {
  it('firma y verifica un token válido', () => {
    const token = sign({ userId: 7, role: 'user' }, SECRETO, 60);
    const payload = verify(token, SECRETO);
    assert.equal(payload.userId, 7);
    assert.equal(payload.role, 'user');
    assert.equal(typeof payload.exp, 'number');
  });

  it('sin tiempo de vida no pone exp: así son los tokens de agente', () => {
    const payload = verify(sign({ type: 'agent' }, SECRETO), SECRETO);
    assert.equal(payload.exp, undefined);
  });

  it('rechaza un token firmado con otro secreto', () => {
    assert.equal(verify(sign({ a: 1 }, 'otro'), SECRETO), null);
  });

  it('rechaza un token con el payload alterado', () => {
    const [h, , s] = sign({ role: 'user' }, SECRETO).split('.');
    assert.equal(verify(`${h}.${b64({ role: 'admin' })}.${s}`, SECRETO), null);
  });

  it('rechaza alg "none" sin firma: la cabecera alg nunca se lee', () => {
    const falso = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ role: 'admin' })}.`;
    assert.equal(verify(falso, SECRETO), null);
  });

  it('rechaza un token de alg "none" aunque traiga una firma inventada', () => {
    const falso = `${b64({ alg: 'none' })}.${b64({ role: 'admin' })}.${'x'.repeat(43)}`;
    assert.equal(verify(falso, SECRETO), null);
  });

  it('ignora la cabecera: un token con alg distinto pero firma HS256 correcta sigue siendo HS256', () => {
    const cabecera = b64({ alg: 'RS256', typ: 'JWT' });
    const cuerpo = b64({ userId: 1 });
    const firma = crypto.createHmac('sha256', SECRETO).update(`${cabecera}.${cuerpo}`).digest('base64url');
    assert.equal(verify(`${cabecera}.${cuerpo}.${firma}`, SECRETO).userId, 1);
  });

  it('rechaza un token expirado', (t) => {
    t.mock.timers.enable({ apis: ['Date'], now: 1_000_000_000_000 });
    const token = sign({ a: 1 }, SECRETO, 10);
    t.mock.timers.tick(11_000);
    assert.equal(verify(token, SECRETO), null);
  });

  it('rechaza entradas mal formadas', () => {
    assert.equal(verify(undefined, SECRETO), null);
    assert.equal(verify(12345, SECRETO), null);
    assert.equal(verify('solo.dos', SECRETO), null);
    assert.equal(verify('a.b.c.d', SECRETO), null);
  });

  it('rechaza un payload que no es JSON aunque la firma sea correcta', () => {
    const cabecera = b64({ alg: 'HS256' });
    const cuerpo = Buffer.from('no es json').toString('base64url');
    const firma = crypto.createHmac('sha256', SECRETO).update(`${cabecera}.${cuerpo}`).digest('base64url');
    assert.equal(verify(`${cabecera}.${cuerpo}.${firma}`, SECRETO), null);
  });
});
