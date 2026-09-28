'use strict';

const { lineas, vaultTemporal, esperarHasta, borrar } = require('../helpers/entorno');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const stateIndex = require('../../src/stateIndex');
const { ColaDeSync, descargarCambios } = require('../../src/api');
const {
  aplicarCambios,
  escribirNota,
  notasEnDisco,
  reconciliar,
  iniciarBajada,
} = require('../../src/downstream');

const json = (status, cuerpo, cabeceras = {}) =>
  new Response(JSON.stringify(cuerpo), { status, headers: { 'content-type': 'application/json', ...cabeceras } });

// Un servidor falso programable: una respuesta (o función) por llamada.
const servidorFalso = (t, respuestas) => {
  const llamadas = [];
  let i = 0;
  t.mock.method(globalThis, 'fetch', async (url, opciones = {}) => {
    llamadas.push({ url, opciones, cuerpo: opciones.body ? JSON.parse(opciones.body) : null });
    const r = respuestas[Math.min(i, respuestas.length - 1)];
    i += 1;
    if (typeof r === 'function') return r(url, opciones);
    return r;
  });
  return llamadas;
};

const nuevaCola = (extra = {}) => new ColaDeSync({ apiUrl: 'http://s', agentToken: 'tok', onTokenInvalido: () => {}, ...extra });

beforeEach(() => {
  borrar(process.env.DRIVESIDIAN_DATA_DIR);
  stateIndex.reiniciar();
});

describe('cola de subida', () => {
  it('manda la nota con el token y apunta en el índice la versión que confirmó el servidor', async (t) => {
    const llamadas = servidorFalso(t, [json(200, { data: { version: 4, changed: true } })]);
    const cola = nuevaCola();
    cola.encolar('Drivesidian/a.md', 'hola');
    await esperarHasta(() => !cola.drenando);
    assert.equal(llamadas[0].url, 'http://s/api/notes/sync');
    assert.equal(llamadas[0].opciones.headers.Authorization, 'Bearer tok');
    assert.deepEqual(llamadas[0].cuerpo, { vault_path: 'Drivesidian/a.md', content: 'hola' });
    assert.deepEqual(stateIndex.obtener('Drivesidian/a.md'), { hash: stateIndex.hashDe('hola'), version: 4 });
  });

  it('manda base_version cuando conoce la nota', async (t) => {
    stateIndex.registrar('Drivesidian/a.md', 'h', 2);
    const llamadas = servidorFalso(t, [json(200, { data: { version: 3, changed: false } })]);
    const cola = nuevaCola();
    cola.encolar('Drivesidian/a.md', 'hola');
    await esperarHasta(() => !cola.drenando);
    assert.equal(llamadas[0].cuerpo.base_version, 2);
    assert.ok(lineas.some((l) => l.includes('Sin cambios: Drivesidian/a.md')));
  });

  it('ante un conflicto (409) no decide nada y no vuelve a insistir con ese contenido', async (t) => {
    const llamadas = servidorFalso(t, [json(409, {})]);
    const cola = nuevaCola();
    cola.encolar('Drivesidian/a.md', 'hola');
    await esperarHasta(() => !cola.drenando);
    assert.equal(llamadas.length, 1);
    assert.equal(stateIndex.obtener('Drivesidian/a.md'), null);
    assert.ok(lineas.some((l) => l.includes('resuélvelo desde el panel')));
  });

  it('si revocaron el token (401), se detiene, vacía la cola y avisa', async (t) => {
    servidorFalso(t, [json(401, { error: { message: 'revocado' } })]);
    let avisado = false;
    const cola = nuevaCola({ onTokenInvalido: () => { avisado = true; } });
    cola.encolar('Drivesidian/a.md', 'x');
    cola.encolar('Drivesidian/b.md', 'y');
    await esperarHasta(() => !cola.drenando);
    assert.equal(avisado, true);
    assert.equal(cola.pendientes.size, 0);
  });

  for (const status of [400, 403, 413]) {
    it(`un ${status} descarta la nota en vez de reintentarla para siempre`, async (t) => {
      const llamadas = servidorFalso(t, [json(status, { error: { message: 'no' } })]);
      const cola = nuevaCola();
      cola.encolar('Drivesidian/a.md', 'x');
      await esperarHasta(() => !cola.drenando);
      assert.equal(llamadas.length, 1);
    });
  }

  it('sin red reintenta con espera creciente hasta que el servidor vuelve', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let intentos = 0;
    servidorFalso(t, [
      async () => {
        intentos += 1;
        if (intentos < 3) throw new Error('ECONNREFUSED');
        return json(200, { data: { version: 1 } });
      },
    ]);
    const cola = nuevaCola();
    cola.encolar('Drivesidian/a.md', 'x');
    for (let i = 0; i < 20 && cola.drenando; i += 1) {
      await new Promise((r) => setImmediate(r));
      t.mock.timers.tick(10_000);
    }
    assert.equal(intentos, 3);
    assert.equal(cola.esperaMs, 2000, 'tras un éxito la espera vuelve al mínimo');
  });

  it('con 429 espera lo que diga Retry-After', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    servidorFalso(t, [json(429, {}, { 'retry-after': '30' }), json(200, { data: { version: 1 } })]);
    const cola = nuevaCola();
    cola.encolar('Drivesidian/a.md', 'x');
    for (let i = 0; i < 10; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(cola.esperaMs, 30_000);
    t.mock.timers.tick(30_000);
    // Con setTimeout simulado no se puede esperar con temporizadores: solo con setImmediate.
    for (let i = 0; i < 50 && cola.drenando; i += 1) await new Promise((r) => setImmediate(r));
    assert.equal(cola.pendientes.size, 0);
  });

  it('con un error del servidor (500) reintenta', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const llamadas = servidorFalso(t, [json(500, {}), json(200, { data: { version: 1 } })]);
    const cola = nuevaCola();
    cola.encolar('Drivesidian/a.md', 'x');
    for (let i = 0; i < 20 && cola.drenando; i += 1) {
      await new Promise((r) => setImmediate(r));
      t.mock.timers.tick(5_000);
    }
    assert.equal(llamadas.length, 2);
  });

  it('si la nota se edita mientras se envía, manda la versión nueva después', async (t) => {
    let cola;
    const llamadas = servidorFalso(t, [
      async () => {
        cola.encolar('Drivesidian/a.md', 'versión 2');
        return json(200, { data: { version: 1 } });
      },
      json(200, { data: { version: 2 } }),
    ]);
    cola = nuevaCola();
    cola.encolar('Drivesidian/a.md', 'versión 1');
    await esperarHasta(() => !cola.drenando && cola.pendientes.size === 0);
    assert.deepEqual(llamadas.map((l) => l.cuerpo.content), ['versión 1', 'versión 2']);
  });
});

describe('consulta de cambios', () => {
  it('pide desde el cursor que dio el servidor', async (t) => {
    const llamadas = servidorFalso(t, [json(200, { data: { notes: [], cursor: null, has_more: false } })]);
    const datos = await descargarCambios({
      apiUrl: 'http://s',
      agentToken: 'tok',
      cursor: { since: '2026-09-28 10:00:00.123456+00', since_id: '7' },
    });
    assert.deepEqual(datos.notes, []);
    assert.match(llamadas[0].url, /since=2026-09-28%2010%3A00%3A00\.123456%2B00&since_id=7$/);
  });

  it('devuelve null sin red o con error, y avisa si el token fue revocado', async (t) => {
    servidorFalso(t, [
      async () => {
        throw new Error('sin red');
      },
      json(500, { error: { message: 'x' } }),
      json(401, { error: { message: 'revocado' } }),
    ]);
    let revocado = false;
    const ctx = { apiUrl: 'http://s', agentToken: 'tok', onTokenInvalido: () => { revocado = true; } };
    assert.equal(await descargarCambios(ctx), null);
    assert.equal(await descargarCambios(ctx), null);
    assert.equal(await descargarCambios(ctx), null);
    assert.equal(revocado, true);
  });
});

describe('bajada al disco', () => {
  it('apunta el hash en el índice ANTES de escribir, para no reportar su propia escritura', async () => {
    const vault = vaultTemporal();
    await escribirNota(vault, { vault_path: 'Drivesidian/sub/n.md', content: 'del servidor', version: 5 });
    assert.equal(fs.readFileSync(path.join(vault, 'Drivesidian', 'sub', 'n.md'), 'utf8'), 'del servidor');
    assert.deepEqual(stateIndex.obtener('Drivesidian/sub/n.md'), { hash: stateIndex.hashDe('del servidor'), version: 5 });
  });

  it('escribe lo nuevo, no pisa lo que el usuario cambió y no reescribe lo que ya coincide', async () => {
    const vault = vaultTemporal();
    const carpeta = path.join(vault, 'Drivesidian');
    fs.writeFileSync(path.join(carpeta, 'editada.md'), 'cambio local sin subir');
    stateIndex.registrar('Drivesidian/editada.md', stateIndex.hashDe('lo último sincronizado'), 1);
    fs.writeFileSync(path.join(carpeta, 'igual.md'), 'mismo texto');

    const escritas = await aplicarCambios(vault, [
      { vault_path: 'Drivesidian/nueva.md', content: 'nueva', version: 1 },
      { vault_path: 'Drivesidian/editada.md', content: 'versión del servidor', version: 2 },
      { vault_path: 'Drivesidian/igual.md', content: 'mismo texto', version: 3 },
    ]);

    assert.equal(escritas, 1);
    assert.equal(fs.readFileSync(path.join(carpeta, 'nueva.md'), 'utf8'), 'nueva');
    assert.equal(fs.readFileSync(path.join(carpeta, 'editada.md'), 'utf8'), 'cambio local sin subir');
    assert.equal(stateIndex.obtener('Drivesidian/igual.md').version, 3);
  });

  it('lista solo las notas .md de la carpeta sincronizada, sin .obsidian ni .trash', async () => {
    const vault = vaultTemporal();
    const carpeta = path.join(vault, 'Drivesidian');
    fs.mkdirSync(path.join(carpeta, 'sub'));
    fs.mkdirSync(path.join(carpeta, '.obsidian'));
    fs.mkdirSync(path.join(carpeta, '.trash'));
    fs.writeFileSync(path.join(carpeta, 'a.md'), '');
    fs.writeFileSync(path.join(carpeta, 'sub', 'b.MD'), '');
    fs.writeFileSync(path.join(carpeta, 'imagen.png'), '');
    fs.writeFileSync(path.join(carpeta, '.obsidian', 'c.md'), '');
    fs.writeFileSync(path.join(carpeta, '.trash', 'd.md'), '');
    assert.deepEqual((await notasEnDisco(vault)).sort(), ['Drivesidian/a.md', 'Drivesidian/sub/b.MD']);
    assert.deepEqual(await notasEnDisco(path.join(vault, 'no-existe')), []);
  });
});

describe('reconciliación de un agente sin índice', () => {
  it('trae lo que falta, registra lo que coincide, y sube lo distinto y lo nuevo sin pisar nada', async (t) => {
    const vault = vaultTemporal();
    const carpeta = path.join(vault, 'Drivesidian');
    fs.writeFileSync(path.join(carpeta, 'igual.md'), 'igual');
    fs.writeFileSync(path.join(carpeta, 'distinta.md'), 'versión local');
    fs.writeFileSync(path.join(carpeta, 'solo-local.md'), 'nueva local');

    servidorFalso(t, [
      json(200, {
        data: {
          notes: [
            { vault_path: 'Drivesidian/solo-servidor.md', content: 'del servidor', version: 1 },
            { vault_path: 'Drivesidian/igual.md', content: 'igual', version: 2 },
          ],
          cursor: { since: 'a', since_id: '2' },
          has_more: true,
        },
      }),
      json(200, {
        data: {
          notes: [{ vault_path: 'Drivesidian/distinta.md', content: 'versión del servidor', version: 4 }],
          cursor: { since: 'b', since_id: '3' },
          has_more: false,
        },
      }),
    ]);
    const encoladas = [];
    const cola = { encolar: (ruta, contenido) => encoladas.push([ruta, contenido]) };

    const cursor = await reconciliar({ apiUrl: 'http://s', agentToken: 'tok' }, vault, cola);

    assert.deepEqual(cursor, { since: 'b', since_id: '3' });
    assert.equal(fs.readFileSync(path.join(carpeta, 'solo-servidor.md'), 'utf8'), 'del servidor');
    assert.equal(stateIndex.obtener('Drivesidian/igual.md').version, 2);
    assert.equal(stateIndex.obtener('Drivesidian/distinta.md'), null, 'sin índice: el servidor lo marcará como conflicto');
    assert.deepEqual(encoladas.sort(), [
      ['Drivesidian/distinta.md', 'versión local'],
      ['Drivesidian/solo-local.md', 'nueva local'],
    ]);
  });

  it('si el servidor no responde, conserva el cursor que tenía', async (t) => {
    servidorFalso(t, [json(500, {})]);
    const cursor = await reconciliar({ apiUrl: 'http://s', agentToken: 'tok' }, vaultTemporal(), { encolar() {} });
    assert.equal(cursor, null);
  });
});

describe('bucle de bajada', () => {
  it('consulta al arrancar y luego en cada intervalo, sin solaparse', async (t) => {
    const vault = vaultTemporal();
    let consultas = 0;
    servidorFalso(t, [
      async () => {
        consultas += 1;
        return json(200, {
          data: {
            notes: consultas === 1 ? [{ vault_path: 'Drivesidian/w.md', content: 'web', version: 1 }] : [],
            cursor: { since: 'x', since_id: String(consultas) },
            has_more: false,
          },
        });
      },
    ]);
    process.env.DRIVESIDIAN_PULL_MS = '20';
    const parar = iniciarBajada({ apiUrl: 'http://s', agentToken: 'tok' }, vault, null);
    t.after(() => {
      parar();
      delete process.env.DRIVESIDIAN_PULL_MS;
    });
    await esperarHasta(() => consultas >= 3);
    assert.equal(fs.readFileSync(path.join(vault, 'Drivesidian', 'w.md'), 'utf8'), 'web');
  });

  it('un error al aplicar se registra y no tumba el bucle', async (t) => {
    servidorFalso(t, [json(200, { data: { notes: [{ vault_path: 'Drivesidian/x.md', content: 42 }], has_more: false } })]);
    const parar = iniciarBajada({ apiUrl: 'http://s', agentToken: 'tok' }, vaultTemporal(), null);
    t.after(parar);
    assert.ok(await esperarHasta(() => lineas.some((l) => l.includes('Error bajando cambios'))));
  });
});
