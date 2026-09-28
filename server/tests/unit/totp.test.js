'use strict';

require('../helpers/entorno');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { generateSecret, generateTotp, verifyTotp, buildOtpAuthUri } = require('../../src/utils/totp');

// Secreto del RFC 6238, apéndice B: "12345678901234567890" en ASCII, en base32.
const SECRETO_RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('TOTP propio (RFC 6238)', () => {
  // El RFC publica códigos de 8 dígitos; los de 6 son sus últimos 6.
  const vectores = [
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ];

  for (const [segundos, esperado] of vectores) {
    it(`coincide con el vector oficial del RFC en t=${segundos}`, (t) => {
      t.mock.timers.enable({ apis: ['Date'], now: segundos * 1000 });
      assert.equal(generateTotp(SECRETO_RFC), esperado);
    });
  }

  it('acepta el código actual y los de ±30 segundos por desfase de reloj', () => {
    const secreto = generateSecret();
    assert.equal(verifyTotp(secreto, generateTotp(secreto)), true);
    assert.equal(verifyTotp(secreto, generateTotp(secreto, -1)), true);
    assert.equal(verifyTotp(secreto, generateTotp(secreto, 1)), true);
  });

  it('rechaza un código de hace más de un paso', () => {
    const secreto = generateSecret();
    const viejo = generateTotp(secreto, -3);
    const vigentes = [-1, 0, 1].map((d) => generateTotp(secreto, d));
    if (!vigentes.includes(viejo)) assert.equal(verifyTotp(secreto, viejo), false);
  });

  it('rechaza formatos inválidos sin intentar calcular', () => {
    const secreto = generateSecret();
    for (const malo of ['12345', '1234567', 'abcdef', '', null, 123456]) {
      assert.equal(verifyTotp(secreto, malo), false);
    }
  });

  it('genera secretos de 160 bits en base32 y distintos cada vez', () => {
    const a = generateSecret();
    const b = generateSecret();
    assert.match(a, /^[A-Z2-7]{32}$/);
    assert.notEqual(a, b);
  });

  it('arma la URI otpauth que leen las apps de autenticación', () => {
    const uri = buildOtpAuthUri('ABC', 'ana@ejemplo.com');
    assert.match(uri, /^otpauth:\/\/totp\/Drivesidian%3Aana%40ejemplo\.com\?/);
    const params = new URL(uri).searchParams;
    assert.equal(params.get('secret'), 'ABC');
    assert.equal(params.get('digits'), '6');
    assert.equal(params.get('period'), '30');
    assert.equal(params.get('algorithm'), 'SHA1');
  });
});
