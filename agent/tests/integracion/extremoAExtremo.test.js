'use strict';

// De extremo a extremo: el agente real contra el servidor real y PostgreSQL.
// Recorre el flujo principal de un usuario sin simular nada salvo el navegador.

// Primero el entorno del servidor (base de pruebas, secretos) y luego el del
// agente (carpeta de datos temporal).
require('../../../server/tests/helpers/entorno');
const { vaultTemporal, cargarFresco, esperarHasta, borrar } = require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const childProcess = require('child_process');
const { EventEmitter } = require('events');

const { iniciar, detener, pedir, cookieDeSesion } = require('../../../server/tests/helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, pool } = require('../../../server/tests/helpers/datos');
const stateIndex = require('../../src/stateIndex');
const config = require('../../src/config');
const { ColaDeSync, descargarCambios } = require('../../src/api');
const { aplicarCambios } = require('../../src/downstream');
const { registroObsidian } = require('../../src/vaultDetect');

let apiUrl;
let usuario;
let vault;
let token;

before(async () => {
  await limpiarBase();
  apiUrl = await iniciar();
  usuario = await crearUsuario({ con2fa: true });
  vault = vaultTemporal('vault-e2e');
  fs.mkdirSync(path.dirname(registroObsidian()), { recursive: true });
  fs.writeFileSync(registroObsidian(), JSON.stringify({ vaults: { a: { path: vault, ts: 1 } } }));
  borrar(process.env.DRIVESIDIAN_DATA_DIR);
  stateIndex.reiniciar();
});
after(async () => {
  await detener();
  await cerrarBase();
});

const archivo = (ruta) => path.join(vault, ...ruta.split('/'));
const notaEnServidor = async (ruta) =>
  (await pool.query('SELECT * FROM notes WHERE user_id = $1 AND vault_path = $2', [usuario.id, ruta])).rows[0];
const drenar = (cola) => esperarHasta(() => !cola.drenando && cola.pendientes.size === 0);

describe('flujo completo de un usuario', () => {
  it('1 · vincula el equipo: el agente pide código, la persona aprueba, el agente recibe su token', async (t) => {
    const falsoNavegador = new EventEmitter();
    falsoNavegador.unref = () => {};
    t.mock.method(childProcess, 'spawn', () => falsoNavegador);
    const { vincular } = cargarFresco('pairing');

    const vinculacion = vincular(apiUrl);
    const codigo = await esperarHasta(async () => (await pool.query('SELECT code FROM pairing_codes')).rows[0]?.code);
    const aprobado = await pedir('POST', '/api/pairing/approve', {
      cookie: cookieDeSesion(usuario),
      body: { code: codigo },
    });
    assert.equal(aprobado.status, 200);

    const resultado = await vinculacion;
    token = resultado.agentToken;
    assert.equal(resultado.vaultPath, vault, 'el vault se detectó solo');
    assert.equal(config.cargar().agentToken, token, 'quedó guardado');
  });

  it('2 · una nota escrita en Obsidian llega al servidor, pendiente de subir a GitHub', async () => {
    fs.writeFileSync(archivo('Drivesidian/diario.md'), '# Lunes\nprimera línea');
    const cola = new ColaDeSync({ apiUrl, agentToken: token, onTokenInvalido: () => {} });
    cola.encolar('Drivesidian/diario.md', fs.readFileSync(archivo('Drivesidian/diario.md'), 'utf8'));
    await drenar(cola);

    const nota = await notaEnServidor('Drivesidian/diario.md');
    assert.equal(nota.content, '# Lunes\nprimera línea');
    assert.equal(nota.sync_status, 'pending');
    assert.equal(stateIndex.obtener('Drivesidian/diario.md').version, 1);
  });

  it('3 · lo que se edita en la web baja al disco en la siguiente consulta', async () => {
    const nota = await notaEnServidor('Drivesidian/diario.md');
    const editada = await pedir('PUT', `/api/notes/${nota.id}`, {
      cookie: cookieDeSesion(usuario),
      body: { content: '# Lunes\neditado desde la web', version: 1 },
    });
    assert.equal(editada.status, 200);

    const cambios = await descargarCambios({ apiUrl, agentToken: token, cursor: null });
    assert.equal(await aplicarCambios(vault, cambios.notes), 1);
    assert.equal(fs.readFileSync(archivo('Drivesidian/diario.md'), 'utf8'), '# Lunes\neditado desde la web');
    assert.equal(stateIndex.obtener('Drivesidian/diario.md').version, 2);
  });

  it('4 · una edición local posterior sube como versión 3, sin conflicto', async () => {
    const cola = new ColaDeSync({ apiUrl, agentToken: token, onTokenInvalido: () => {} });
    cola.encolar('Drivesidian/diario.md', '# Lunes\neditado en Obsidian');
    await drenar(cola);
    const nota = await notaEnServidor('Drivesidian/diario.md');
    assert.equal(nota.version, 3);
    assert.equal(nota.conflict_content, null);
  });

  it('5 · si cambian los dos lados, nadie pisa a nadie: conflicto que resuelve una persona', async () => {
    const nota = await notaEnServidor('Drivesidian/diario.md');
    await pedir('PUT', `/api/notes/${nota.id}`, {
      cookie: cookieDeSesion(usuario),
      body: { content: 'versión de la web', version: 3 },
    });

    // El disco también cambió, sin haber bajado antes la versión de la web.
    fs.writeFileSync(archivo('Drivesidian/diario.md'), 'versión del disco');
    const cola = new ColaDeSync({ apiUrl, agentToken: token, onTokenInvalido: () => {} });
    cola.encolar('Drivesidian/diario.md', 'versión del disco');
    await drenar(cola);

    let enServidor = await notaEnServidor('Drivesidian/diario.md');
    assert.equal(enServidor.content, 'versión de la web');
    assert.equal(enServidor.conflict_content, 'versión del disco');

    // Bajar cambios no toca el archivo local: la nota en conflicto no se entrega.
    const cambios = await descargarCambios({ apiUrl, agentToken: token, cursor: null });
    await aplicarCambios(vault, cambios.notes);
    assert.equal(fs.readFileSync(archivo('Drivesidian/diario.md'), 'utf8'), 'versión del disco');

    // La persona elige la versión del disco desde el panel.
    const resuelta = await pedir('POST', `/api/notes/${nota.id}/resolve`, {
      cookie: cookieDeSesion(usuario),
      body: { keep: 'local' },
    });
    enServidor = resuelta.body.data;
    assert.equal(enServidor.content, 'versión del disco');
    assert.equal(enServidor.version, 5);
  });

  it('6 · el agente arranca solo, vigila la carpeta y sube una nota nueva', async (t) => {
    // Se arranca envuelto para poder detenerlo con una salida limpia (cerrando su
    // stdin): en Windows, matar el proceso impide que escriba su cobertura.
    const envoltura = "process.stdin.resume(); process.stdin.on('end', () => process.exit(0)); require(process.argv[1]);";
    const hijo = spawn(process.execPath, ['-e', envoltura, path.join(__dirname, '..', '..', 'src', 'index.js')], {
      env: { ...process.env, DRIVESIDIAN_API_URL: apiUrl, DRIVESIDIAN_PULL_MS: '100' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let salida = '';
    hijo.stdout.on('data', (d) => {
      salida += d;
    });
    hijo.stderr.on('data', (d) => {
      salida += d;
    });
    const termino = new Promise((r) => hijo.on('exit', r));
    t.after(() => hijo.kill());

    assert.ok(await esperarHasta(() => salida.includes('Vigilando'), { timeoutMs: 15000 }), salida);
    fs.writeFileSync(archivo('Drivesidian/desde-el-agente.md'), 'la vio el watcher');
    const llegada = await esperarHasta(() => notaEnServidor('Drivesidian/desde-el-agente.md'), { timeoutMs: 15000 });
    assert.equal(llegada.content, 'la vio el watcher');

    hijo.stdin.end();
    assert.equal(await termino, 0);
  });

  it('7 · al desinstalar, el agente revoca su propio token y borra su configuración', async () => {
    const hijo = spawn(process.execPath, [path.join(__dirname, '..', '..', 'src', 'unpair.js')], {
      env: process.env,
      stdio: 'ignore',
    });
    const codigo = await new Promise((r) => hijo.on('exit', r));
    assert.equal(codigo, 0);
    assert.equal(fs.existsSync(config.configFile()), false);
    const { rows } = await pool.query('SELECT revoked_at FROM agent_tokens WHERE user_id = $1', [usuario.id]);
    assert.ok(rows.every((r) => r.revoked_at !== null), 'el token quedó revocado en el servidor');
    assert.equal((await pedir('GET', '/api/notes/changes', { token })).status, 401);
  });
});
