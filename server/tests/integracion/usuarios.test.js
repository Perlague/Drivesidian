'use strict';

const { feed } = require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, detener, pedir, cookieDeSesion, cookieDeRespuesta } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, esperarEventos, pool } = require('../helpers/datos');
const { generateTotp } = require('../../src/utils/totp');

before(async () => {
  await limpiarBase();
  await iniciar();
});
after(async () => {
  await detener();
  await cerrarBase();
});

describe('registro', () => {
  it('crea la cuenta y no devuelve el hash de la contraseña', async () => {
    const res = await pedir('POST', '/api/users/register', {
      body: { email: 'nueva@ejemplo.com', password: 'una-clave-larga' },
    });
    assert.equal(res.status, 201);
    assert.equal(res.body.data.email, 'nueva@ejemplo.com');
    assert.equal(res.body.data.role, 'user');
    assert.equal(res.body.data.password_hash, undefined);
    const [evento] = await esperarEventos('auth.register');
    assert.equal(evento.severity, 'info');
  });

  it('rechaza un correo repetido con 409', async () => {
    const res = await pedir('POST', '/api/users/register', {
      body: { email: 'nueva@ejemplo.com', password: 'otra-clave-larga' },
    });
    assert.equal(res.status, 409);
  });

  it('valida el cuerpo con mensajes por campo', async () => {
    const res = await pedir('POST', '/api/users/register', { body: { email: 'no-es-correo', password: 'corta' } });
    assert.equal(res.status, 400);
    assert.ok(res.body.error.fields.email);
    assert.ok(res.body.error.fields.password);
  });

  it('guarda la contraseña con scrypt, nunca en claro', async () => {
    const { rows } = await pool.query(`SELECT password_hash FROM users WHERE email = 'nueva@ejemplo.com'`);
    assert.doesNotMatch(rows[0].password_hash, /una-clave-larga/);
    assert.match(rows[0].password_hash, /^[0-9a-f]{32}:[0-9a-f]{128}$/);
  });
});

describe('inicio de sesión', () => {
  it('un correo inexistente responde igual que una contraseña mala (no enumera cuentas)', async () => {
    const res = await pedir('POST', '/api/users/login', {
      body: { email: 'nadie@ejemplo.com', password: 'lo-que-sea' },
      headers: { 'user-agent': 'pruebas-de-integracion' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, 'Correo o contraseña incorrectos.');
    const [evento] = await esperarEventos('auth.login.failed_password');
    assert.equal(evento.details.reason, 'unknown_email');
    assert.equal(evento.user_agent, 'pruebas-de-integracion');
    assert.equal(evento.user_id, null);
  });

  it('una contraseña mala responde 401 con el mismo mensaje', async () => {
    const res = await pedir('POST', '/api/users/login', {
      body: { email: 'nueva@ejemplo.com', password: 'equivocada' },
    });
    assert.equal(res.status, 401);
    assert.equal(res.body.error.message, 'Correo o contraseña incorrectos.');
    const eventos = await esperarEventos('auth.login.failed_password', { minimo: 2 });
    assert.equal(eventos[1].details.reason, 'bad_password');
  });

  it('con las credenciales correctas deja una cookie httpOnly y SameSite=Lax', async () => {
    const res = await pedir('POST', '/api/users/login', {
      body: { email: 'nueva@ejemplo.com', password: 'una-clave-larga' },
    });
    assert.equal(res.status, 200);
    const cookie = res.headers.getSetCookie().find((c) => c.startsWith('drivesidian_session='));
    assert.match(cookie, /HttpOnly/i);
    assert.match(cookie, /SameSite=Lax/i);
    const [evento] = await esperarEventos('auth.login.success');
    assert.equal(evento.details.twofa, false);
  });

  it('valida el cuerpo del login', async () => {
    const res = await pedir('POST', '/api/users/login', { body: { email: 'x@y.com', totp_code: '12' } });
    assert.equal(res.status, 400);
  });
});

describe('cuenta y preferencias', () => {
  it('/me devuelve el perfil, el topic de ntfy y su QR, sin secretos', async () => {
    const usuario = await crearUsuario();
    const res = await pedir('GET', '/api/users/me', { cookie: cookieDeSesion(usuario) });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.email, usuario.email);
    assert.equal(res.body.data.twofa_enabled, false);
    assert.match(res.body.data.ntfy_topic, /^drivesidian-[0-9a-f]{20}$/);
    assert.match(res.body.data.ntfy_qr, /^data:image\/png;base64,/);
    assert.equal(res.body.data.password_hash, undefined);
    assert.equal(res.body.data.totp_secret, undefined);
  });

  it('/me sin sesión responde 401', async () => {
    assert.equal((await pedir('GET', '/api/users/me')).status, 401);
  });

  it('/me de una cuenta que ya no existe responde 404', async () => {
    const res = await pedir('GET', '/api/users/me', { cookie: cookieDeSesion({ id: 999999 }) });
    assert.equal(res.status, 404);
  });

  it('activa y desactiva las notificaciones', async () => {
    const usuario = await crearUsuario();
    const cookie = cookieDeSesion(usuario);
    let res = await pedir('PATCH', '/api/users/me/notifications', { cookie, body: { notify_enabled: false } });
    assert.deepEqual(res.body.data, { id: usuario.id, notify_enabled: false });
    res = await pedir('PATCH', '/api/users/me/notifications', { cookie, body: { notify_enabled: 'sí' } });
    assert.equal(res.status, 400);
    res = await pedir('PATCH', '/api/users/me/notifications', {
      cookie: cookieDeSesion({ id: 999999 }),
      body: { notify_enabled: true },
    });
    assert.equal(res.status, 404);
  });

  it('cerrar sesión borra la cookie', async () => {
    const usuario = await crearUsuario();
    const res = await pedir('POST', '/api/users/logout', { cookie: cookieDeSesion(usuario) });
    assert.equal(res.status, 200);
    assert.match(res.headers.getSetCookie()[0], /drivesidian_session=;/);
    await esperarEventos('auth.logout', { userId: usuario.id });
  });
});

describe('enrolamiento del segundo factor', () => {
  it('entrega secreto, URI y QR, pero no guarda nada hasta confirmar', async () => {
    const usuario = await crearUsuario();
    const res = await pedir('POST', '/api/users/2fa/enroll', { cookie: cookieDeSesion(usuario) });
    assert.equal(res.status, 200);
    assert.match(res.body.data.secret, /^[A-Z2-7]{32}$/);
    assert.match(res.body.data.otpauth_uri, /^otpauth:\/\/totp\//);
    assert.match(res.body.data.qr_data_url, /^data:image\/png;base64,/);
    const { rows } = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [usuario.id]);
    assert.equal(rows[0].totp_secret, null);
  });

  it('un código incorrecto no activa el 2FA', async () => {
    const usuario = await crearUsuario();
    const cookie = cookieDeSesion(usuario);
    const { body } = await pedir('POST', '/api/users/2fa/enroll', { cookie });
    const vigentes = [-1, 0, 1].map((d) => generateTotp(body.data.secret, d));
    const malo = ['000000', '111111', '222222'].find((c) => !vigentes.includes(c));
    let res = await pedir('POST', '/api/users/2fa/confirm', { cookie, body: { secret: body.data.secret, code: malo } });
    assert.equal(res.status, 401);
    res = await pedir('POST', '/api/users/2fa/confirm', { cookie, body: { secret: body.data.secret, code: 'abc' } });
    assert.equal(res.status, 400);
  });

  it('el código correcto activa el 2FA y guarda el secreto cifrado', async () => {
    const usuario = await crearUsuario();
    const cookie = cookieDeSesion(usuario);
    const { body } = await pedir('POST', '/api/users/2fa/enroll', { cookie });
    const res = await pedir('POST', '/api/users/2fa/confirm', {
      cookie,
      body: { secret: body.data.secret, code: generateTotp(body.data.secret) },
    });
    assert.equal(res.status, 200);
    const { rows } = await pool.query('SELECT totp_secret FROM users WHERE id = $1', [usuario.id]);
    assert.notEqual(rows[0].totp_secret, body.data.secret, 'no queda en claro');
    assert.match(rows[0].totp_secret, /^[0-9a-f]{24}:[0-9a-f]{32}:[0-9a-f]+$/);
    await esperarEventos('2fa.enrolled', { userId: usuario.id });
    const me = await pedir('GET', '/api/users/me', { cookie });
    assert.equal(me.body.data.twofa_enabled, true);
  });

  it('con 2FA activo el login pide el código y lo acepta', async () => {
    const usuario = await crearUsuario({ con2fa: true });
    let res = await pedir('POST', '/api/users/login', { body: { email: usuario.email, password: usuario.password } });
    assert.equal(res.status, 400);
    res = await pedir('POST', '/api/users/login', {
      body: { email: usuario.email, password: usuario.password, totp_code: generateTotp(usuario.secreto) },
    });
    assert.equal(res.status, 200);
    assert.ok(cookieDeRespuesta(res));
  });

  it('el feed de seguridad nunca incluye la contraseña', () => {
    assert.ok(feed.length > 0);
    assert.ok(feed.every((e) => !JSON.stringify(e).includes('una-clave-larga')));
  });
});
