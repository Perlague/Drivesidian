'use strict';

// Va en su propio archivo porque consume casi todo el límite de 10 logins por
// minuto: cada archivo corre en un proceso nuevo, con su limitador a cero.

require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, detener, pedir } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, esperarEventos, pool } = require('../helpers/datos');
const { generateTotp } = require('../../src/utils/totp');

let usuario;
let malo;

before(async () => {
  await limpiarBase();
  await iniciar();
  usuario = await crearUsuario({ con2fa: true });
  const vigentes = [-1, 0, 1].map((d) => generateTotp(usuario.secreto, d));
  malo = ['000000', '111111', '222222', '333333'].find((c) => !vigentes.includes(c));
});
after(async () => {
  await detener();
  await cerrarBase();
});

const intentar = (codigo) =>
  pedir('POST', '/api/users/login', {
    body: { email: usuario.email, password: usuario.password, totp_code: codigo },
  });

describe('bloqueo por fuerza bruta al segundo factor', () => {
  it('cuenta cada código incorrecto y bloquea al quinto con un evento crítico', async () => {
    for (let i = 1; i <= 5; i += 1) {
      const res = await intentar(malo);
      assert.equal(res.status, 401, `intento ${i}`);
    }
    const fallos = await esperarEventos('auth.login.failed_totp', { minimo: 5, userId: usuario.id });
    assert.deepEqual(fallos.map((e) => e.details.failed_attempts), [1, 2, 3, 4, 5]);
    assert.ok(fallos.every((e) => e.severity === 'warn'));

    const [bloqueo] = await esperarEventos('auth.lockout', { userId: usuario.id });
    assert.equal(bloqueo.severity, 'critical');
    assert.equal(bloqueo.details.failed_attempts, 5);
  });

  it('mientras dura el bloqueo, ni el código correcto entra', async () => {
    const res = await intentar(generateTotp(usuario.secreto));
    assert.equal(res.status, 403);
    const [evento] = await esperarEventos('auth.login.blocked', { userId: usuario.id });
    assert.equal(evento.severity, 'warn');
  });

  it('el bloqueo dura 15 minutos', async () => {
    const { rows } = await pool.query(
      `SELECT extract(epoch FROM locked_until - now()) AS segundos FROM users WHERE id = $1`,
      [usuario.id],
    );
    assert.ok(rows[0].segundos > 14 * 60 && rows[0].segundos <= 15 * 60);
  });

  it('pasado el bloqueo, el código correcto entra y el contador vuelve a cero', async () => {
    await pool.query(`UPDATE users SET locked_until = now() - interval '1 second' WHERE id = $1`, [usuario.id]);
    const res = await intentar(generateTotp(usuario.secreto));
    assert.equal(res.status, 200);
    const { rows } = await pool.query('SELECT failed_2fa_attempts, locked_until FROM users WHERE id = $1', [usuario.id]);
    assert.equal(rows[0].failed_2fa_attempts, 0);
    assert.equal(rows[0].locked_until, null);
  });
});
