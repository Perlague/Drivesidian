'use strict';

require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { iniciar, detener, pedir, cookieDeSesion } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, tokenDeAgente, esperarEventos, pool } = require('../helpers/datos');

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

let conDosPasos;
let sinDosPasos;

before(async () => {
  await limpiarBase();
  await iniciar();
  conDosPasos = await crearUsuario({ con2fa: true });
  sinDosPasos = await crearUsuario();
});
after(async () => {
  await detener();
  await cerrarBase();
});

// Lo que hace el agente al arrancar sin token: inventa un secreto, manda su hash.
const pedirCodigo = async (vaults = [{ name: 'Notas', path: 'C:\\Users\\ana\\Notas' }]) => {
  const verifier = crypto.randomBytes(32).toString('hex');
  const res = await pedir('POST', '/api/pairing/start', {
    body: { verifier_hash: sha256(verifier), device_name: 'Laptop de Ana', vaults },
  });
  return { verifier, res, code: res.body?.data?.code };
};

const consultar = (code, verifier) =>
  pedir('GET', `/api/pairing/status?code=${encodeURIComponent(code)}`, {
    headers: verifier ? { 'x-pair-verifier': verifier } : {},
  });

const aprobar = (usuario, body) => pedir('POST', '/api/pairing/approve', { cookie: cookieDeSesion(usuario), body });

describe('el agente pide un código', () => {
  it('recibe un código legible XXXX-XXXX, sin caracteres ambiguos, y la URL para abrir', async () => {
    const { res, code } = await pedirCodigo();
    assert.equal(res.status, 201);
    assert.match(code, /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
    assert.ok(!/[01OIL]/.test(code));
    assert.match(res.body.data.pair_url, new RegExp(`/pair\\?code=${code}$`));
    await esperarEventos('pairing.requested');
  });

  it('valida lo que manda el agente', async () => {
    const res = await pedir('POST', '/api/pairing/start', { body: { verifier_hash: 'no-es-sha256' } });
    assert.equal(res.status, 400);
  });

  it('mientras nadie aprueba, la consulta dice "pendiente"', async () => {
    const { code, verifier } = await pedirCodigo();
    const res = await consultar(code, verifier);
    assert.equal(res.body.data.status, 'pending');
  });

  it('pide código y verifier, y rechaza un código inexistente', async () => {
    assert.equal((await consultar('')).status, 400);
    assert.equal((await consultar('ZZZZ-ZZZZ', 'x')).status, 404);
  });
});

describe('quien vio el código en pantalla no puede llevarse el token', () => {
  it('sin el secreto del agente, el canje se rechaza con un evento CRÍTICO', async () => {
    const { code } = await pedirCodigo();
    const res = await consultar(code, 'lo-que-vi-en-la-pantalla');
    assert.equal(res.status, 403);
    const [evento] = await esperarEventos('pairing.rejected');
    assert.equal(evento.severity, 'critical');
    assert.equal(evento.details.reason, 'verifier_incorrecto');
  });
});

describe('la persona aprueba desde el navegador', () => {
  it('sin segundo factor no puede vincular: 403 con código para que la web redirija', async () => {
    const { code } = await pedirCodigo();
    const res = await aprobar(sinDosPasos, { code });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, 'twofa_required');
  });

  it('ve qué equipo pide vincularse, sin el hash del verifier', async () => {
    const { code } = await pedirCodigo();
    const res = await pedir('GET', `/api/pairing/${code}`, { cookie: cookieDeSesion(conDosPasos) });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.device_name, 'Laptop de Ana');
    assert.equal(res.body.data.verifier_hash, undefined);
    assert.equal((await pedir('GET', `/api/pairing/${code}`)).status, 401);
    assert.equal((await pedir('GET', '/api/pairing/NOPE-NOPE', { cookie: cookieDeSesion(conDosPasos) })).status, 404);
  });

  it('flujo completo: aprobar, canjear una sola vez, y el token funciona', async () => {
    const { code, verifier } = await pedirCodigo();
    const aprobado = await aprobar(conDosPasos, { code });
    assert.equal(aprobado.status, 200);
    assert.equal(aprobado.body.data.selected_vault, 'C:\\Users\\ana\\Notas', 'un solo vault se elige solo');
    await esperarEventos('pairing.approved', { userId: conDosPasos.id });

    const canje = await consultar(code, verifier);
    assert.equal(canje.body.data.status, 'approved');
    assert.equal(canje.body.data.vault_path, 'C:\\Users\\ana\\Notas');
    const token = canje.body.data.token;
    assert.equal((await pedir('GET', '/api/notes/changes', { token })).status, 200);

    assert.equal((await consultar(code, verifier)).status, 410, 'el código es de un solo uso');
    await esperarEventos('pairing.consumed', { userId: conDosPasos.id });
    const [creado] = await esperarEventos('token.created', { userId: conDosPasos.id });
    assert.equal(creado.details.source, 'vinculación');

    const { rows } = await pool.query('SELECT token_hash FROM agent_tokens');
    assert.ok(rows.every((r) => !token.includes(r.token_hash)), 'en la base solo queda el hash');
  });

  it('no se aprueba dos veces el mismo código', async () => {
    const { code } = await pedirCodigo();
    await aprobar(conDosPasos, { code });
    assert.equal((await aprobar(conDosPasos, { code })).status, 409);
  });

  it('con varios vaults hay que elegir uno de los que detectó el agente', async () => {
    const { code } = await pedirCodigo([
      { name: 'Trabajo', path: 'D:\\Trabajo' },
      { name: 'Personal', path: 'D:\\Personal' },
    ]);
    assert.equal((await aprobar(conDosPasos, { code })).status, 400);
    assert.equal((await aprobar(conDosPasos, { code, selected_vault: 'C:\\Windows' })).status, 400);
    const res = await aprobar(conDosPasos, { code, selected_vault: 'D:\\Personal' });
    assert.equal(res.body.data.selected_vault, 'D:\\Personal');
  });

  it('valida el cuerpo y rechaza códigos inexistentes', async () => {
    assert.equal((await aprobar(conDosPasos, {})).status, 400);
    assert.equal((await aprobar(conDosPasos, { code: 'ZZZZ-ZZZZ' })).status, 404);
  });

  it('un token de agente no puede aprobar vinculaciones', async () => {
    const token = await tokenDeAgente(conDosPasos.id);
    assert.equal((await pedir('POST', '/api/pairing/approve', { token, body: { code: 'x' } })).status, 403);
  });

  it('una sesión de una cuenta borrada no aprueba nada', async () => {
    assert.equal((await aprobar({ id: 987654 }, { code: 'x' })).status, 401);
  });
});

describe('los códigos caducan a los 10 minutos', () => {
  it('un código vencido no se canjea ni se aprueba', async () => {
    const { code, verifier } = await pedirCodigo();
    await pool.query(`UPDATE pairing_codes SET expires_at = now() - interval '1 second' WHERE code = $1`, [code]);
    assert.equal((await consultar(code, verifier)).status, 410);
    assert.equal((await aprobar(conDosPasos, { code })).status, 410);
    await esperarEventos('pairing.expired', { minimo: 2 });
  });
});

describe('vincular este equipo desde el panel', () => {
  it('lista los códigos pendientes pedidos desde la misma IP, sin el verifier', async () => {
    const { code } = await pedirCodigo();
    const res = await pedir('GET', '/api/pairing/pending', { cookie: cookieDeSesion(conDosPasos) });
    assert.equal(res.status, 200);
    const encontrado = res.body.data.find((p) => p.code === code);
    assert.ok(encontrado, 'el código recién pedido debe aparecer');
    assert.equal(encontrado.device_name, 'Laptop de Ana');
    assert.deepEqual(encontrado.vaults, ['Notas']);
    assert.ok(!JSON.stringify(res.body).includes('verifier'));
  });

  it('no lista los que ya se aprobaron', async () => {
    const { code } = await pedirCodigo();
    await aprobar(conDosPasos, { code });
    const res = await pedir('GET', '/api/pairing/pending', { cookie: cookieDeSesion(conDosPasos) });
    assert.ok(!res.body.data.some((p) => p.code === code));
  });

  it('no lista los pedidos desde otra IP', async () => {
    const { code } = await pedirCodigo();
    await pool.query("UPDATE pairing_codes SET requester_ip = '203.0.113.9' WHERE code = $1", [code]);
    const res = await pedir('GET', '/api/pairing/pending', { cookie: cookieDeSesion(conDosPasos) });
    assert.ok(!res.body.data.some((p) => p.code === code));
  });

  it('exige sesión web', async () => {
    const res = await pedir('GET', '/api/pairing/pending');
    assert.equal(res.status, 401);
    const agente = await pedir('GET', '/api/pairing/pending', { headers: { authorization: `Bearer ${await tokenDeAgente(conDosPasos.id)}` } });
    assert.equal(agente.status, 403);
  });
});
