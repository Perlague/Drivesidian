'use strict';

require('../helpers/entorno');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword } = require('../../src/utils/password');
const { encryptSecret, decryptSecret } = require('../../src/utils/secretCrypto');
const { topicForUser, topicUrl } = require('../../src/utils/ntfyTopic');

describe('contraseñas con scrypt', () => {
  it('verifica la contraseña correcta y rechaza otra', async () => {
    const hash = await hashPassword('correcta-123');
    assert.equal(await verifyPassword('correcta-123', hash), true);
    assert.equal(await verifyPassword('incorrecta', hash), false);
  });

  it('usa una sal distinta cada vez: dos hashes de la misma clave no coinciden', async () => {
    const a = await hashPassword('igual');
    const b = await hashPassword('igual');
    assert.notEqual(a, b);
    assert.match(a, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });
});

describe('cifrado del secreto 2FA con AES-256-GCM', () => {
  it('descifra lo que cifró', () => {
    assert.equal(decryptSecret(encryptSecret('JBSWY3DPEHPK3PXP')), 'JBSWY3DPEHPK3PXP');
  });

  it('usa un IV aleatorio: el mismo secreto cifra distinto cada vez', () => {
    assert.notEqual(encryptSecret('x'), encryptSecret('x'));
  });

  it('detecta una alteración del texto cifrado gracias a la etiqueta de autenticación', () => {
    const [iv, tag, datos] = encryptSecret('secreto').split(':');
    const alterado = (parseInt(datos[0], 16) ^ 1).toString(16) + datos.slice(1);
    assert.throws(() => decryptSecret(`${iv}:${tag}:${alterado}`));
  });

  it('no descifra con otra llave', () => {
    const cifrado = encryptSecret('secreto');
    const original = process.env.TOTP_ENCRYPTION_KEY;
    process.env.TOTP_ENCRYPTION_KEY = 'cd'.repeat(32);
    try {
      assert.throws(() => decryptSecret(cifrado));
    } finally {
      process.env.TOTP_ENCRYPTION_KEY = original;
    }
  });
});

describe('topic de ntfy derivado por HMAC', () => {
  it('es estable para el mismo usuario y distinto entre usuarios', () => {
    assert.equal(topicForUser(1), topicForUser(1));
    assert.notEqual(topicForUser(1), topicForUser(2));
    assert.match(topicForUser(1), /^drivesidian-[0-9a-f]{20}$/);
    assert.equal(topicUrl(1), `https://ntfy.sh/${topicForUser(1)}`);
  });

  it('no se puede derivar sin el secreto del servidor', () => {
    const original = process.env.NTFY_SECRET;
    delete process.env.NTFY_SECRET;
    try {
      assert.throws(() => topicForUser(1), /NTFY_SECRET/);
    } finally {
      process.env.NTFY_SECRET = original;
    }
  });
});
