'use strict';

require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, detener, pedir, cookieDeSesion } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, tokenDeAgente, esperarEventos, pool } = require('../helpers/datos');
const { crearGithubFalso } = require('../helpers/githubFalso');
const { runSyncForUser } = require('../../src/workers/syncWorker');

let ana;
let bob;
let cookieAna;
let cookieBob;

before(async () => {
  await limpiarBase();
  await iniciar();
  ana = await crearUsuario({ email: 'ana@ejemplo.com' });
  bob = await crearUsuario({ email: 'bob@ejemplo.com' });
  cookieAna = cookieDeSesion(ana);
  cookieBob = cookieDeSesion(bob);
});
after(async () => {
  await detener();
  await cerrarBase();
});

const crear = (cookie, vault_path, content = 'hola') =>
  pedir('POST', '/api/notes', { cookie, body: { vault_path, content } });

describe('crear notas desde el panel', () => {
  it('la crea dentro de la carpeta sincronizada, en versión 1 y pendiente de subir', async () => {
    const res = await crear(cookieAna, 'ideas');
    assert.equal(res.status, 201);
    assert.equal(res.body.data.vault_path, 'Drivesidian/ideas.md');
    assert.equal(res.body.data.version, 1);
    assert.equal(res.body.data.sync_status, 'pending');
  });

  it('no pisa una nota que ya existe con ese nombre', async () => {
    assert.equal((await crear(cookieAna, 'ideas')).status, 409);
  });

  it('rechaza nombres inválidos y contenido de más de 1 MiB (medido en bytes)', async () => {
    assert.equal((await crear(cookieAna, '.md')).status, 400);
    assert.equal((await pedir('POST', '/api/notes', { cookie: cookieAna, body: {} })).status, 400);
    // 600 mil "ñ" son 600 mil caracteres pero 1.2 MB: pasa el límite de caracteres, no el de bytes.
    const res = await crear(cookieAna, 'pesada', 'ñ'.repeat(600_000));
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /1 MiB/);
  });
});

describe('leer y listar', () => {
  it('la lista no arrastra el contenido de las notas', async () => {
    const res = await pedir('GET', '/api/notes', { cookie: cookieAna });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.length >= 1);
    assert.equal(res.body.data[0].content, undefined);
    assert.equal(res.body.data[0].in_conflict, false);
  });

  it('una nota ajena responde 404, no 403: no se confirma que exista', async () => {
    const { body } = await crear(cookieAna, 'privada', 'secreto de ana');
    const res = await pedir('GET', `/api/notes/${body.data.id}`, { cookie: cookieBob });
    assert.equal(res.status, 404);
    const propia = await pedir('GET', `/api/notes/${body.data.id}`, { cookie: cookieAna });
    assert.equal(propia.body.data.content, 'secreto de ana');
  });

  it('un id que no es número responde 400', async () => {
    assert.equal((await pedir('GET', '/api/notes/abc', { cookie: cookieAna })).status, 400);
  });

  it('un token de agente no puede usar los endpoints del panel', async () => {
    const token = await tokenDeAgente(ana.id);
    assert.equal((await pedir('GET', '/api/notes', { token })).status, 403);
    assert.equal((await pedir('GET', '/api/notes/1', { token })).status, 403);
    assert.equal((await pedir('POST', '/api/notes', { token, body: { vault_path: 'x' } })).status, 403);
    assert.equal((await pedir('PUT', '/api/notes/1', { token, body: {} })).status, 403);
    assert.equal((await pedir('POST', '/api/notes/1/resolve', { token, body: {} })).status, 403);
    assert.equal((await pedir('POST', '/api/notes/sync-now', { token })).status, 403);
  });
});

describe('edición con control de versión', () => {
  it('guarda si se parte de la versión actual y la sube en uno', async () => {
    const { body } = await crear(cookieAna, 'editable', 'v1');
    const res = await pedir('PUT', `/api/notes/${body.data.id}`, {
      cookie: cookieAna,
      body: { content: 'v2', version: 1 },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.version, 2);
  });

  it('si otro la cambió antes, responde 409 con las dos versiones y no pisa nada', async () => {
    const { body } = await crear(cookieAna, 'disputada', 'original');
    await pedir('PUT', `/api/notes/${body.data.id}`, { cookie: cookieAna, body: { content: 'de la web', version: 1 } });
    const res = await pedir('PUT', `/api/notes/${body.data.id}`, {
      cookie: cookieAna,
      body: { content: 'de otra pestaña', version: 1 },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.conflict.yours.content, 'de otra pestaña');
    assert.equal(res.body.conflict.server.content, 'de la web');
    assert.equal(res.body.conflict.server.version, 2);
  });

  it('valida el cuerpo y la propiedad de la nota', async () => {
    const { body } = await crear(cookieAna, 'validada');
    assert.equal((await pedir('PUT', `/api/notes/${body.data.id}`, { cookie: cookieAna, body: { content: 'x' } })).status, 400);
    assert.equal((await pedir('PUT', `/api/notes/${body.data.id}`, { cookie: cookieBob, body: { content: 'x', version: 1 } })).status, 404);
    assert.equal((await pedir('PUT', '/api/notes/abc', { cookie: cookieAna, body: { content: 'x', version: 1 } })).status, 400);
  });
});

describe('conflictos entre la web y el disco', () => {
  const enConflicto = async () => {
    const { body } = await crear(cookieAna, `conflicto-${Date.now()}`, 'del servidor');
    await pool.query(
      `UPDATE notes SET conflict_content = 'del disco', conflict_hash = 'h', conflict_detected_at = now() WHERE id = $1`,
      [body.data.id],
    );
    return body.data.id;
  };

  it('se niega a editar una nota en conflicto hasta resolverlo', async () => {
    const id = await enConflicto();
    const res = await pedir('PUT', `/api/notes/${id}`, { cookie: cookieAna, body: { content: 'x', version: 1 } });
    assert.equal(res.status, 409);
    assert.match(res.body.error.message, /conflicto sin resolver/);
  });

  it('la lista marca las notas que necesitan atención', async () => {
    const id = await enConflicto();
    const { body } = await pedir('GET', '/api/notes', { cookie: cookieAna });
    assert.equal(body.data.find((n) => n.id === id).in_conflict, true);
  });

  it('conservar la del servidor descarta la del disco sin cambiar la versión', async () => {
    const id = await enConflicto();
    const res = await pedir('POST', `/api/notes/${id}/resolve`, { cookie: cookieAna, body: { keep: 'server' } });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.content, 'del servidor');
    assert.equal(res.body.data.version, 1);
    assert.equal(res.body.data.conflict_content, null);
    const otra = await pedir('POST', `/api/notes/${id}/resolve`, { cookie: cookieAna, body: { keep: 'server' } });
    assert.equal(otra.status, 404, 'ya no hay conflicto que resolver');
  });

  it('conservar la del disco la vuelve la versión del servidor y la reencola', async () => {
    const id = await enConflicto();
    const res = await pedir('POST', `/api/notes/${id}/resolve`, { cookie: cookieAna, body: { keep: 'local' } });
    assert.equal(res.body.data.content, 'del disco');
    assert.equal(res.body.data.version, 2);
    assert.equal(res.body.data.sync_status, 'pending');
  });

  it('valida la elección y la propiedad', async () => {
    const id = await enConflicto();
    assert.equal((await pedir('POST', `/api/notes/${id}/resolve`, { cookie: cookieAna, body: { keep: 'ambas' } })).status, 400);
    assert.equal((await pedir('POST', `/api/notes/${id}/resolve`, { cookie: cookieBob, body: { keep: 'server' } })).status, 404);
    assert.equal((await pedir('POST', '/api/notes/x/resolve', { cookie: cookieAna, body: { keep: 'server' } })).status, 400);
  });
});

describe('sincronizar ahora', () => {
  it('sube las pendientes del usuario sin esperar al ciclo', async (t) => {
    const gh = crearGithubFalso();
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const res = await pedir('POST', '/api/notes/sync-now', { cookie: cookieBob });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.synced, 0);
    await crear(cookieBob, 'para-subir');
    const segunda = await pedir('POST', '/api/notes/sync-now', { cookie: cookieBob });
    assert.equal(segunda.body.data.synced, 1);
  });

  it('si ya hay una subida en curso responde 409', async (t) => {
    let soltar;
    const barrera = new Promise((r) => {
      soltar = r;
    });
    t.mock.method(globalThis, 'fetch', crearGithubFalso({ alSubirArbol: () => barrera }).fetch);
    await crear(cookieBob, 'lenta');
    const enCurso = runSyncForUser(bob.id);
    await new Promise((r) => setTimeout(r, 50));
    const res = await pedir('POST', '/api/notes/sync-now', { cookie: cookieBob });
    assert.equal(res.status, 409);
    soltar();
    await enCurso;
  });
});

describe('cuota de notas', () => {
  it('al llegar a 2000 notas no deja crear más y lo reporta', async () => {
    const carla = await crearUsuario();
    await pool.query(
      `INSERT INTO notes (user_id, vault_path, content, content_hash)
       SELECT $1, 'Drivesidian/n' || g || '.md', '', 'h' FROM generate_series(1, 2000) g`,
      [carla.id],
    );
    const res = await crear(cookieDeSesion(carla), 'una-mas');
    assert.equal(res.status, 403);
    const [evento] = await esperarEventos('quota.exceeded', { userId: carla.id });
    assert.equal(evento.details.quota, 2000);
  });
});
