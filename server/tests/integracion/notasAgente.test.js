'use strict';

require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { iniciar, detener, pedir, cookieDeSesion } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, tokenDeAgente, esperarEventos, pool } = require('../helpers/datos');
const agentTokensModel = require('../../src/models/agentTokens.model');
const { sign } = require('../../src/utils/jwt');

let usuario;
let token;

before(async () => {
  await limpiarBase();
  await iniciar();
  usuario = await crearUsuario();
  token = await tokenDeAgente(usuario.id);
});
after(async () => {
  await detener();
  await cerrarBase();
});

const subir = (vault_path, content, base_version, t = token) =>
  pedir('PUT', '/api/notes/sync', {
    token: t,
    body: base_version === undefined ? { vault_path, content } : { vault_path, content, base_version },
  });

describe('subida desde el disco', () => {
  it('una ruta nueva se crea en versión 1', async () => {
    const res = await subir('Drivesidian/a.md', 'uno');
    assert.equal(res.status, 200);
    assert.equal(res.body.data.outcome, 'created');
    assert.equal(res.body.data.version, 1);
  });

  it('el mismo contenido no hace nada: evita resubir el vault en cada arranque', async () => {
    const res = await subir('Drivesidian/a.md', 'uno', 1);
    assert.equal(res.body.data.outcome, 'unchanged');
    assert.equal(res.body.data.changed, false);
    assert.equal(res.body.data.version, 1);
  });

  it('partiendo de la versión actual, sobrescribe y sube la versión', async () => {
    const res = await subir('Drivesidian/a.md', 'dos', 1);
    assert.equal(res.body.data.outcome, 'updated');
    assert.equal(res.body.data.version, 2);
  });

  it('partiendo de una versión vieja, es conflicto: guarda lo del disco aparte y no pisa', async () => {
    const res = await subir('Drivesidian/a.md', 'tres desde el disco', 1);
    assert.equal(res.status, 409);
    assert.equal(res.body.conflict.server.content, 'dos');
    assert.equal(res.body.conflict.yours.content, 'tres desde el disco');
    const { rows } = await pool.query(`SELECT content, version, conflict_content FROM notes WHERE vault_path = 'Drivesidian/a.md'`);
    assert.deepEqual(rows[0], { content: 'dos', version: 2, conflict_content: 'tres desde el disco' });
  });

  it('sin base_version sobre una nota existente también es conflicto (agente sin índice)', async () => {
    await subir('Drivesidian/b.md', 'original');
    const res = await subir('Drivesidian/b.md', 'copia vieja de un agente reinstalado');
    assert.equal(res.status, 409);
  });

  it('si el disco vuelve a coincidir con el servidor, el conflicto se limpia solo', async () => {
    const res = await subir('Drivesidian/b.md', 'original');
    assert.equal(res.body.data.outcome, 'unchanged');
    assert.equal(res.body.data.conflict_content, null);
  });

  it('valida el cuerpo', async () => {
    assert.equal((await pedir('PUT', '/api/notes/sync', { token, body: { content: 'x' } })).status, 400);
    assert.equal((await subir('Drivesidian/c.md', 42)).status, 400);
    assert.equal((await subir('Drivesidian/c.md', 'x', -1)).status, 400);
  });

  it('una sesión web no puede usar los endpoints del agente', async () => {
    const cookie = cookieDeSesion(usuario);
    assert.equal((await pedir('PUT', '/api/notes/sync', { cookie, body: { vault_path: 'a', content: 'b' } })).status, 403);
    assert.equal((await pedir('GET', '/api/notes/changes', { cookie })).status, 403);
  });
});

describe('bajada al disco', () => {
  it('devuelve las notas cambiadas con un cursor del servidor, sin las que están en conflicto', async () => {
    const res = await pedir('GET', '/api/notes/changes', { token });
    assert.equal(res.status, 200);
    const rutas = res.body.data.notes.map((n) => n.vault_path);
    assert.ok(rutas.includes('Drivesidian/b.md'));
    assert.ok(!rutas.includes('Drivesidian/a.md'), 'a.md sigue en conflicto');
    assert.equal(res.body.data.notes[0].cursor_at, undefined);
    assert.ok(res.body.data.cursor.since);
    assert.equal(res.body.data.has_more, false);
  });

  it('con el cursor ya no repite lo que entregó', async () => {
    const primera = await pedir('GET', '/api/notes/changes', { token });
    const { since, since_id } = primera.body.data.cursor;
    const res = await pedir('GET', `/api/notes/changes?since=${encodeURIComponent(since)}&since_id=${since_id}`, { token });
    assert.deepEqual(res.body.data.notes, []);
    assert.equal(res.body.data.cursor, null);
  });

  it('valida el cursor', async () => {
    assert.equal((await pedir('GET', '/api/notes/changes?since=ayer', { token })).status, 400);
    assert.equal((await pedir('GET', '/api/notes/changes?since=2026-01-01&since_id=x', { token })).status, 400);
  });

  it('pedir 100 notas o más de golpe se reporta UNA vez por hora como lectura masiva', async () => {
    const otro = await crearUsuario();
    const suToken = await tokenDeAgente(otro.id);
    await pool.query(
      `INSERT INTO notes (user_id, vault_path, content, content_hash)
       SELECT $1, 'Drivesidian/m' || g || '.md', 'x', 'h' FROM generate_series(1, 120) g`,
      [otro.id],
    );
    await pedir('GET', '/api/notes/changes', { token: suToken });
    await pedir('GET', '/api/notes/changes', { token: suToken });
    const eventos = await esperarEventos('notes.bulk_read', { userId: otro.id });
    await new Promise((r) => setTimeout(r, 200));
    assert.equal((await esperarEventos('notes.bulk_read', { userId: otro.id })).length, 1);
    assert.equal(eventos[0].details.notes, 120);
  });
});

describe('cuota desde el agente', () => {
  it('una ruta nueva con la cuota llena se rechaza, pero editar una existente sigue funcionando', async () => {
    const lleno = await crearUsuario();
    const suToken = await tokenDeAgente(lleno.id);
    await pool.query(
      `INSERT INTO notes (user_id, vault_path, content, content_hash, version)
       SELECT $1, 'Drivesidian/q' || g || '.md', 'x', 'h', 1 FROM generate_series(1, 2000) g`,
      [lleno.id],
    );
    assert.equal((await subir('Drivesidian/nueva.md', 'x', undefined, suToken)).status, 403);
    assert.equal((await subir('Drivesidian/q1.md', 'editada', 1, suToken)).status, 200);
    await esperarEventos('quota.exceeded', { userId: lleno.id });
  });
});

describe('tokens de agente en la autenticación', () => {
  const hash = (jti) => crypto.createHash('sha256').update(jti).digest('hex');

  it('un token de solo lectura puede bajar pero no subir', async () => {
    const jti = 'solo-lectura';
    await agentTokensModel.create(usuario.id, hash(jti));
    const lectura = sign({ type: 'agent', userId: usuario.id, jti, scope: ['notes:read'] }, process.env.JWT_SECRET);
    assert.equal((await pedir('GET', '/api/notes/changes', { token: lectura })).status, 200);
    assert.equal((await subir('Drivesidian/z.md', 'x', undefined, lectura)).status, 403);
  });

  it('un token sin alcances se rechaza y pide volver a vincular', async () => {
    const sinAlcance = sign({ type: 'agent', userId: usuario.id, jti: 'x' }, process.env.JWT_SECRET);
    const res = await pedir('GET', '/api/notes/changes', { token: sinAlcance });
    assert.equal(res.status, 401);
    assert.match(res.body.error.message, /Vuelve a vincular/);
  });

  it('un token revocado se rechaza y dispara un evento CRÍTICO', async () => {
    const quemado = await tokenDeAgente(usuario.id);
    await pool.query('UPDATE agent_tokens SET revoked_at = now() WHERE id = (SELECT max(id) FROM agent_tokens)');
    const res = await pedir('GET', '/api/notes/changes', { token: quemado, headers: { 'user-agent': 'ladron' } });
    assert.equal(res.status, 401);
    const [evento] = await esperarEventos('token.used_after_revoke', { userId: usuario.id });
    assert.equal(evento.severity, 'critical');
    assert.equal(evento.user_agent, 'ladron');
  });

  it('un token válido de otro usuario (userId alterado) no pasa: la firma lo delata', async () => {
    const [, cuerpo] = token.split('.');
    const payload = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
    const alterado = token.replace(cuerpo, Buffer.from(JSON.stringify({ ...payload, userId: 999 })).toString('base64url'));
    assert.equal((await pedir('GET', '/api/notes/changes', { token: alterado })).status, 401);
  });

  it('registra el último uso del token para verlo en el panel', async () => {
    const { rows } = await pool.query('SELECT last_used_at FROM agent_tokens WHERE id = 1');
    assert.notEqual(rows[0].last_used_at, null);
  });
});
