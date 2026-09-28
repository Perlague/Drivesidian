'use strict';

const { errores } = require('../helpers/entorno');
const { describe, it, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { crearGithubFalso } = require('../helpers/githubFalso');
const { pool, limpiarBase, cerrarBase, crearUsuario, nota } = require('../helpers/datos');
const {
  runSyncForUser,
  runSyncCycle,
  isSyncing,
  takeWithinByteBudget,
  startSyncWorker,
} = require('../../src/workers/syncWorker');
const { runRetentionCycle, startRetentionWorker } = require('../../src/workers/retentionWorker');
const { MAX_BATCH_BYTES } = require('../../src/config');

before(limpiarBase);
beforeEach(limpiarBase);
after(cerrarBase);

const pendiente = async (userId, ruta, contenido = `contenido de ${ruta}`) =>
  (
    await pool.query(
      `INSERT INTO notes (user_id, vault_path, content, content_hash, version, sync_status)
       VALUES ($1, $2, $3, 'hash', 1, 'pending') RETURNING *`,
      [userId, ruta, contenido],
    )
  ).rows[0];

describe('presupuesto de bytes por lote', () => {
  it('un lote vacío no pesa nada', () => {
    assert.deepEqual(takeWithinByteBudget([]), { included: [], bytes: 0 });
  });

  it('corta al pasar de 20 MiB y deja el resto para el siguiente ciclo', () => {
    const grande = 'x'.repeat(12 * 1024 * 1024);
    const { included } = takeWithinByteBudget([{ content: grande }, { content: grande }, { content: 'y' }]);
    assert.equal(included.length, 1);
  });

  it('la primera nota entra siempre, aunque sola exceda el presupuesto', () => {
    const enorme = 'x'.repeat(MAX_BATCH_BYTES + 10);
    assert.equal(takeWithinByteBudget([{ content: enorme }]).included.length, 1);
  });
});

describe('worker de sincronización', () => {
  it('sin notas pendientes no llama a GitHub', async (t) => {
    const gh = crearGithubFalso();
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const usuario = await crearUsuario();
    assert.deepEqual(await runSyncForUser(usuario.id), { busy: false, result: 0 });
    assert.equal(gh.llamadas.length, 0);
  });

  it('sube el lote, marca las notas como synced y manda UN aviso', async (t) => {
    const gh = crearGithubFalso();
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const usuario = await crearUsuario({ email: 'ana@ejemplo.com' });
    const a = await pendiente(usuario.id, 'Drivesidian/a.md');
    const b = await pendiente(usuario.id, 'Drivesidian/b.md');

    assert.deepEqual(await runSyncForUser(usuario.id), { busy: false, result: 2 });
    assert.equal((await nota(a.id)).sync_status, 'synced');
    assert.equal((await nota(b.id)).sync_status, 'synced');

    const arbol = gh.aGithub().find((l) => l.ruta.endsWith('/git/trees')).cuerpo;
    assert.deepEqual(arbol.tree.map((e) => e.path).sort(), [
      `user-${usuario.id}-ana/Drivesidian/a.md`,
      `user-${usuario.id}-ana/Drivesidian/b.md`,
    ]);
    assert.equal(gh.aNtfy().length, 1);
    assert.match(gh.aNtfy()[0].cuerpo, /2 nota/);
  });

  it('NO marca como subida una nota editada mientras se subía el lote', async (t) => {
    const usuario = await crearUsuario();
    const quieta = await pendiente(usuario.id, 'Drivesidian/quieta.md');
    const editada = await pendiente(usuario.id, 'Drivesidian/editada.md', 'versión 1');

    // Justo cuando el worker ya leyó el lote y está armando el commit, llega
    // una edición del agente: la nota pasa a versión 2 con contenido nuevo.
    const gh = crearGithubFalso({
      alSubirArbol: () =>
        pool.query(
          `UPDATE notes SET content = 'versión 2', version = 2, sync_status = 'pending' WHERE id = $1`,
          [editada.id],
        ),
    });
    t.mock.method(globalThis, 'fetch', gh.fetch);

    const { result } = await runSyncForUser(usuario.id);
    assert.equal(result, 1, 'solo cuenta la nota que de verdad se subió');
    assert.equal((await nota(quieta.id)).sync_status, 'synced');
    assert.equal((await nota(editada.id)).sync_status, 'pending', 'la versión 2 no llegó a GitHub');
    assert.match(gh.aNtfy()[0].cuerpo, /1 nota/);
  });

  it('si GitHub falla, el lote entero se queda pendiente para el siguiente ciclo', async (t) => {
    const gh = crearGithubFalso({ errorEn: { metodo: 'POST', ruta: '/git/trees', status: 500 } });
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const usuario = await crearUsuario();
    const n = await pendiente(usuario.id, 'Drivesidian/x.md');

    assert.equal((await runSyncForUser(usuario.id)).result, 0);
    assert.equal((await nota(n.id)).sync_status, 'pending');
    assert.equal(gh.aNtfy().length, 0);
    assert.ok(errores.some((e) => e.includes('fallo subiendo el lote')));
  });

  it('respeta al usuario que apagó las notificaciones', async (t) => {
    const gh = crearGithubFalso();
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const usuario = await crearUsuario();
    await pool.query('UPDATE users SET notify_enabled = false WHERE id = $1', [usuario.id]);
    const n = await pendiente(usuario.id, 'Drivesidian/x.md');

    assert.equal((await runSyncForUser(usuario.id)).result, 1);
    assert.equal((await nota(n.id)).sync_status, 'synced');
    assert.equal(gh.aNtfy().length, 0);
  });

  it('un fallo de ntfy no deshace la sincronización', async (t) => {
    const gh = crearGithubFalso({ ntfyStatus: 503 });
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const usuario = await crearUsuario();
    const n = await pendiente(usuario.id, 'Drivesidian/x.md');

    assert.equal((await runSyncForUser(usuario.id)).result, 1);
    assert.equal((await nota(n.id)).sync_status, 'synced');
    assert.ok(errores.some((e) => e.includes('fallo notificando a ntfy')));
  });

  it('un solo escritor a la vez: la segunda sincronización simultánea recibe "ocupado"', async (t) => {
    let soltar;
    const barrera = new Promise((r) => {
      soltar = r;
    });
    const gh = crearGithubFalso({ alSubirArbol: () => barrera });
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const usuario = await crearUsuario();
    await pendiente(usuario.id, 'Drivesidian/x.md');

    const primera = runSyncForUser(usuario.id);
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(isSyncing(), true);
    assert.deepEqual(await runSyncForUser(usuario.id), { busy: true, result: null });
    await runSyncCycle(); // el ciclo periódico también respeta el candado
    soltar();
    assert.equal((await primera).result, 1);
    assert.equal(isSyncing(), false);
  });

  it('el ciclo periódico hace un commit por usuario, cada uno en su carpeta', async (t) => {
    const gh = crearGithubFalso();
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const ana = await crearUsuario({ email: 'ana@ejemplo.com' });
    const bob = await crearUsuario({ email: 'bob@ejemplo.com' });
    await pendiente(ana.id, 'Drivesidian/idea.md');
    await pendiente(bob.id, 'Drivesidian/idea.md');

    await runSyncCycle();
    const commits = gh.aGithub().filter((l) => l.metodo === 'PATCH');
    assert.equal(commits.length, 2);
    const rutas = gh
      .aGithub()
      .filter((l) => l.ruta.endsWith('/git/trees'))
      .flatMap((l) => l.cuerpo.tree.map((e) => e.path))
      .sort();
    assert.deepEqual(rutas, [`user-${ana.id}-ana/Drivesidian/idea.md`, `user-${bob.id}-bob/Drivesidian/idea.md`]);
  });

  it('el ciclo sin pendientes no hace nada', async (t) => {
    const gh = crearGithubFalso();
    t.mock.method(globalThis, 'fetch', gh.fetch);
    await runSyncCycle();
    assert.equal(gh.llamadas.length, 0);
  });

  it('el worker se programa con el intervalo configurado', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const gh = crearGithubFalso();
    t.mock.method(globalThis, 'fetch', gh.fetch);
    const usuario = await crearUsuario();
    const n = await pendiente(usuario.id, 'Drivesidian/programada.md');
    process.env.SYNC_INTERVAL_MS = '1000';
    try {
      startSyncWorker();
      t.mock.timers.tick(1000);
      for (let i = 0; i < 40 && (await nota(n.id)).sync_status !== 'synced'; i += 1) {
        await new Promise((r) => setImmediate(r));
      }
      assert.equal((await nota(n.id)).sync_status, 'synced');
    } finally {
      delete process.env.SYNC_INTERVAL_MS;
    }
  });
});

describe('worker de retención', () => {
  it('poda eventos de más de 90 días y códigos vencidos hace más de un día', async () => {
    await pool.query(
      `INSERT INTO security_events (type, severity, occurred_at) VALUES
       ('viejo', 'info', now() - interval '100 days'),
       ('reciente', 'info', now() - interval '1 day')`,
    );
    await pool.query(
      `INSERT INTO pairing_codes (code, verifier_hash, expires_at) VALUES
       ('VIEJ-OOOO', 'h', now() - interval '2 days'),
       ('VIGE-NTEE', 'h', now() + interval '5 minutes')`,
    );

    assert.deepEqual(await runRetentionCycle(), { events: 1, pairingCodes: 1 });
    const { rows } = await pool.query('SELECT type FROM security_events');
    assert.deepEqual(rows.map((r) => r.type), ['reciente']);
  });

  it('respeta los días de retención configurados', async () => {
    await pool.query(`INSERT INTO security_events (type, severity, occurred_at) VALUES ('x', 'info', now() - interval '10 days')`);
    process.env.SECURITY_EVENT_RETENTION_DAYS = '7';
    try {
      assert.equal((await runRetentionCycle()).events, 1);
    } finally {
      delete process.env.SECURITY_EVENT_RETENTION_DAYS;
    }
  });

  it('arranca podando de inmediato y luego a diario', async (t) => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    startRetentionWorker();
    t.mock.timers.tick(24 * 60 * 60 * 1000);
    await new Promise((r) => setTimeout(r, 50));
  });
});
