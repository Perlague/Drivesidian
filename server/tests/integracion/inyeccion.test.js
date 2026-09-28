'use strict';

// Requerimiento RNF3: resistir inyección SQL, manipulación del JWT y path
// traversal. Cada carga maliciosa entra por un punto real de la API y se
// comprueba que se guarda o se rechaza como dato, nunca se ejecuta.

require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, detener, pedir, cookieDeSesion } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, tokenDeAgente, pool } = require('../helpers/datos');
const { crearGithubFalso } = require('../helpers/githubFalso');

const CARGAS_SQL = [
  "x'); DROP TABLE notes; --",
  "' OR '1'='1",
  "1; UPDATE users SET role='admin' --",
  "Drivesidian/' UNION SELECT password_hash FROM users --.md",
];

let usuario;
let admin;
let token;

before(async () => {
  await limpiarBase();
  await iniciar();
  usuario = await crearUsuario();
  admin = await crearUsuario({ role: 'admin' });
  token = await tokenDeAgente(usuario.id);
});
after(async () => {
  await detener();
  await cerrarBase();
});

const tablasIntactas = async () => {
  const { rows } = await pool.query(
    `SELECT count(*)::int AS n FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('users','notes','agent_tokens','security_events','pairing_codes')`,
  );
  return rows[0].n === 5;
};

describe('inyección SQL', () => {
  it('una ruta de nota maliciosa se guarda como texto y las tablas siguen ahí', async () => {
    for (const carga of CARGAS_SQL) {
      const res = await pedir('PUT', '/api/notes/sync', { token, body: { vault_path: carga, content: carga } });
      assert.equal(res.status, 200, carga);
      assert.equal(res.body.data.vault_path, carga, 'se guardó literal, no se interpretó');
    }
    assert.equal(await tablasIntactas(), true);
    const { rows } = await pool.query("SELECT count(*)::int AS admins FROM users WHERE role = 'admin'");
    assert.equal(rows[0].admins, 1, 'nadie se volvió administrador');
  });

  it('en el login no abre ninguna cuenta', async () => {
    for (const carga of ["admin@ejemplo.com' --", "' OR '1'='1"]) {
      const res = await pedir('POST', '/api/users/login', { body: { email: carga, password: carga } });
      assert.ok([400, 401].includes(res.status), `${carga} → ${res.status}`);
    }
  });

  it('en un id de la URL se rechaza antes de llegar a la base', async () => {
    const res = await pedir('GET', `/api/notes/${encodeURIComponent('1 OR 1=1')}`, { cookie: cookieDeSesion(usuario) });
    assert.equal(res.status, 400);
  });

  it('en los filtros del panel de administración no devuelve de más', async () => {
    const res = await pedir('GET', `/api/admin/security-events?type=${encodeURIComponent("x' OR '1'='1")}`, {
      cookie: cookieDeSesion(admin),
    });
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.data, []);
  });

  it('en el nombre de una nota creada desde la web', async () => {
    const res = await pedir('POST', '/api/notes', {
      cookie: cookieDeSesion(usuario),
      body: { vault_path: "a'); DELETE FROM notes; --", content: 'x' },
    });
    assert.equal(res.status, 201);
    assert.equal(await tablasIntactas(), true);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM notes WHERE user_id = $1', [usuario.id]);
    assert.ok(rows[0].n >= CARGAS_SQL.length + 1, 'no se borró ninguna nota');
  });
});

describe('ids fuera de rango', () => {
  // Un número de 20 cifras no cabe en un bigint: antes llegaba a la base y la
  // API respondía 500. Ahora se rechaza en la frontera con 400.
  const ENORME = '99999999999999999999';

  it('en las rutas del panel responde 400, nunca 500', async () => {
    const cookie = cookieDeSesion(usuario);
    assert.equal((await pedir('GET', `/api/notes/${ENORME}`, { cookie })).status, 400);
    assert.equal((await pedir('PUT', `/api/notes/${ENORME}`, { cookie, body: { content: 'x', version: 1 } })).status, 400);
    assert.equal((await pedir('POST', `/api/notes/${ENORME}/resolve`, { cookie, body: { keep: 'server' } })).status, 400);
    assert.equal((await pedir('DELETE', `/api/agent-tokens/${ENORME}`, { cookie })).status, 400);
    assert.equal((await pedir('GET', '/api/notes/0', { cookie })).status, 400);
  });

  it('en el cursor de la bajada responde 400', async () => {
    const res = await pedir('GET', `/api/notes/changes?since=2026-01-01&since_id=${ENORME}`, { token });
    assert.equal(res.status, 400);
    const inicio = await pedir('GET', '/api/notes/changes?since=2026-01-01&since_id=0', { token });
    assert.equal(inicio.status, 200);
  });
});

describe('path traversal', () => {
  it('una nota con ../ no escribe fuera de la carpeta del usuario en GitHub', async (t) => {
    const gh = crearGithubFalso();
    t.mock.method(globalThis, 'fetch', gh.fetch);
    await pedir('PUT', '/api/notes/sync', {
      token,
      body: { vault_path: '../../user-2-otro/robada.md', content: 'intento de escribir en otra carpeta' },
    });
    await pedir('POST', '/api/notes/sync-now', { cookie: cookieDeSesion(usuario) });
    const rutas = gh
      .aGithub()
      .filter((l) => l.ruta.endsWith('/git/trees'))
      .flatMap((l) => l.cuerpo.tree.map((e) => e.path));
    assert.ok(rutas.length > 0);
    for (const ruta of rutas) {
      assert.ok(ruta.startsWith(`user-${usuario.id}-`), ruta);
      assert.ok(!ruta.split('/').includes('..'), ruta);
    }
  });
});
