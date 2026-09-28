'use strict';

const { lineas, vaultTemporal, comoPlataforma, cargarFresco, esperarHasta, borrar } = require('../helpers/entorno');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const childProcess = require('child_process');
const stateIndex = require('../../src/stateIndex');
const config = require('../../src/config');
const { detectarVaults, asegurarCarpetaSincronizada, registroObsidian } = require('../../src/vaultDetect');
const { iniciarWatcher, rutaRelativa } = require('../../src/watcher');

const json = (status, cuerpo) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json' } });

const registrarObsidian = (vaults) => {
  const ruta = registroObsidian();
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  fs.writeFileSync(ruta, JSON.stringify({ vaults }));
};

beforeEach(() => {
  borrar(process.env.DRIVESIDIAN_DATA_DIR);
  borrar(registroObsidian());
  stateIndex.reiniciar();
});

describe('detección del vault de Obsidian', () => {
  it('busca el registro de Obsidian en la carpeta de cada sistema', (t) => {
    comoPlataforma(t, 'win32');
    assert.equal(registroObsidian(), path.join(process.env.APPDATA, 'obsidian', 'obsidian.json'));
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    assert.equal(registroObsidian(), path.join(os.homedir(), 'Library', 'Application Support', 'obsidian', 'obsidian.json'));
    Object.defineProperty(process, 'platform', { value: 'linux' });
    assert.equal(registroObsidian(), path.join(process.env.XDG_CONFIG_HOME, 'obsidian', 'obsidian.json'));
  });

  it('descarta vaults que ya no existen y ordena por el último abierto', () => {
    const viejo = vaultTemporal('viejo');
    const reciente = vaultTemporal('reciente');
    registrarObsidian({
      a: { path: viejo, ts: 100 },
      b: { path: reciente, ts: 900 },
      c: { path: path.join(viejo, 'borrado'), ts: 999 },
      d: { path: 42 },
      e: null,
    });
    assert.deepEqual(detectarVaults(), [
      { name: path.basename(reciente), path: reciente },
      { name: path.basename(viejo), path: viejo },
    ]);
  });

  it('sin Obsidian instalado o con un registro dañado no hay vaults', () => {
    assert.deepEqual(detectarVaults(), []);
    fs.mkdirSync(path.dirname(registroObsidian()), { recursive: true });
    fs.writeFileSync(registroObsidian(), 'dañado');
    assert.deepEqual(detectarVaults(), []);
    fs.writeFileSync(registroObsidian(), '{"otra":"cosa"}');
    assert.deepEqual(detectarVaults(), []);
  });

  it('crea la carpeta Drivesidian dentro del vault', () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'v-'));
    assert.equal(asegurarCarpetaSincronizada(vault), path.join(vault, 'Drivesidian'));
    assert.ok(fs.statSync(path.join(vault, 'Drivesidian')).isDirectory());
  });
});

describe('vinculación del equipo', () => {
  const cargarPairing = (t) => {
    const hijo = new EventEmitter();
    hijo.unref = () => {};
    const spawn = t.mock.method(childProcess, 'spawn', () => hijo);
    const pairing = cargarFresco('pairing');
    return { pairing, spawn, hijo };
  };
  const inicio = (minutos = 10) =>
    json(201, {
      data: {
        code: 'ABCD-EFGH',
        pair_url: 'https://s/pair?code=ABCD-EFGH',
        expires_at: new Date(Date.now() + minutos * 60_000).toISOString(),
      },
    });

  it('pide un código con el HASH del secreto, abre el navegador y canjea con el secreto', async (t) => {
    const vault = vaultTemporal();
    registrarObsidian({ a: { path: vault, ts: 1 } });
    const { pairing, spawn } = cargarPairing(t);
    const llamadas = [];
    let consultas = 0;
    t.mock.method(globalThis, 'fetch', async (url, opciones = {}) => {
      llamadas.push({ url, opciones });
      if (url.endsWith('/api/pairing/start')) return inicio();
      consultas += 1;
      return consultas < 3
        ? json(200, { data: { status: 'pending' } })
        : json(200, { data: { status: 'approved', token: 'tok.del.agente', vault_path: vault } });
    });

    const resultado = await pairing.vincular('https://s');

    assert.deepEqual(resultado, { agentToken: 'tok.del.agente', vaultPath: vault });
    const pedido = JSON.parse(llamadas[0].opciones.body);
    assert.match(pedido.verifier_hash, /^[0-9a-f]{64}$/);
    assert.equal(pedido.vaults[0].path, vault);
    const verifier = llamadas[1].opciones.headers['X-Pair-Verifier'];
    assert.notEqual(verifier, pedido.verifier_hash, 'en pantalla solo viaja el hash');
    assert.equal(require('crypto').createHash('sha256').update(verifier).digest('hex'), pedido.verifier_hash);
    assert.equal(spawn.mock.callCount(), 1);
    assert.equal(config.cargar().vaultPath, vault);
  });

  it('si el servidor no manda vault y solo hay uno detectado, usa ese', async (t) => {
    const vault = vaultTemporal();
    registrarObsidian({ a: { path: vault, ts: 1 } });
    const { pairing } = cargarPairing(t);
    t.mock.method(globalThis, 'fetch', async (url) =>
      url.endsWith('/start') ? inicio() : json(200, { data: { status: 'approved', token: 't' } }),
    );
    assert.equal((await pairing.vincular('https://s')).vaultPath, vault);
  });

  it('aprobado sin vault que usar es un error claro', async (t) => {
    const { pairing } = cargarPairing(t);
    t.mock.method(globalThis, 'fetch', async (url) =>
      url.endsWith('/start') ? inicio() : json(200, { data: { status: 'approved', token: 't' } }),
    );
    await assert.rejects(pairing.vincular('https://s'), /no se eligió ningún vault/);
  });

  it('un código caducado (410) o un error del servidor detienen la vinculación', async (t) => {
    const { pairing } = cargarPairing(t);
    t.mock.method(globalThis, 'fetch', async (url) =>
      url.endsWith('/start') ? inicio() : json(410, { error: { message: 'El código expiró.' } }),
    );
    await assert.rejects(pairing.vincular('https://s'), /El código expiró/);

    t.mock.method(globalThis, 'fetch', async (url) => (url.endsWith('/start') ? inicio() : json(500, {})));
    await assert.rejects(pairing.vincular('https://s'), /Error 500/);
  });

  it('tolera cortes de red y el límite de peticiones mientras espera', async (t) => {
    const { pairing } = cargarPairing(t);
    let n = 0;
    t.mock.method(globalThis, 'fetch', async (url) => {
      if (url.endsWith('/start')) return inicio();
      n += 1;
      if (n === 1) throw new Error('sin red');
      if (n === 2) return json(429, {});
      return json(200, { data: { status: 'approved', token: 't', vault_path: 'C:\\V' } });
    });
    assert.equal((await pairing.vincular('https://s')).agentToken, 't');
  });

  it('si el servidor rechaza la solicitud, lo dice', async (t) => {
    const { pairing } = cargarPairing(t);
    t.mock.method(globalThis, 'fetch', async () => new Response('límite', { status: 429 }));
    await assert.rejects(pairing.vincular('https://s'), /rechazó la solicitud de vinculación \(429\)/);
  });

  it('si nadie aprueba antes de que caduque el código, se rinde', async (t) => {
    const { pairing } = cargarPairing(t);
    t.mock.method(globalThis, 'fetch', async (url) =>
      url.endsWith('/start') ? inicio(0.001) : json(200, { data: { status: 'pending' } }),
    );
    await assert.rejects(pairing.vincular('https://s'), /caducó sin que nadie lo aprobara/);
  });

  it('abre el navegador con el comando de cada sistema, sin pasar por la shell', (t) => {
    const { pairing, spawn, hijo } = cargarPairing(t);
    comoPlataforma(t, 'win32');
    assert.equal(pairing.abrirNavegador('https://s/pair'), true);
    assert.deepEqual(spawn.mock.calls[0].arguments.slice(0, 2), ['rundll32', ['url.dll,FileProtocolHandler', 'https://s/pair']]);
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    pairing.abrirNavegador('u');
    assert.equal(spawn.mock.calls[1].arguments[0], 'open');
    Object.defineProperty(process, 'platform', { value: 'linux' });
    pairing.abrirNavegador('u');
    assert.equal(spawn.mock.calls[2].arguments[0], 'xdg-open');
    hijo.emit('error', new Error('no hay navegador'));
    assert.ok(lineas.some((l) => l.includes('No se pudo abrir el navegador')));
  });

  it('si ni siquiera puede lanzar el proceso, devuelve false', (t) => {
    t.mock.method(childProcess, 'spawn', () => {
      throw new Error('EACCES');
    });
    const pairing = cargarFresco('pairing');
    assert.equal(pairing.abrirNavegador('u'), false);
  });
});

describe('vigilante de la carpeta', () => {
  it('normaliza la ruta relativa con barras normales', () => {
    assert.equal(rutaRelativa(path.join('C:', 'V'), path.join('C:', 'V', 'Drivesidian', 'a.md')), 'Drivesidian/a.md');
  });

  it('reporta los .md nuevos y editados, e ignora su propia escritura y otros archivos', async (t) => {
    const vault = vaultTemporal();
    const carpeta = path.join(vault, 'Drivesidian');
    const encoladas = [];
    const watcher = iniciarWatcher(vault, { encolar: (ruta, contenido) => encoladas.push([ruta, contenido]) });
    t.after(() => watcher.close());
    await esperarHasta(() => lineas.some((l) => l.includes(`Vigilando ${carpeta}`)));

    stateIndex.registrar('Drivesidian/propia.md', stateIndex.hashDe('escrita por el agente'), 1);
    fs.writeFileSync(path.join(carpeta, 'propia.md'), 'escrita por el agente');
    fs.writeFileSync(path.join(carpeta, 'imagen.png'), 'no es nota');
    fs.writeFileSync(path.join(carpeta, 'nueva.md'), 'la escribió el usuario');

    assert.ok(await esperarHasta(() => encoladas.length >= 1));
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(encoladas, [['Drivesidian/nueva.md', 'la escribió el usuario']]);

    borrar(path.join(carpeta, 'nueva.md'));
    assert.ok(await esperarHasta(() => lineas.some((l) => l.includes('no se borra del servidor'))));
  });
});
