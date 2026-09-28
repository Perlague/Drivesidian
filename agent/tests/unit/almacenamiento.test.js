'use strict';

const { RAIZ, lineas, comoPlataforma, cargarFresco, borrar } = require('../helpers/entorno');
const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const paths = require('../../src/paths');
const stateIndex = require('../../src/stateIndex');
const config = require('../../src/config');

// El archivo que deja el instalador junto a la aplicación. Una prueba lo crea a
// propósito; si una corrida anterior se cortó a medias, podría haber quedado.
const CONFIG_DEL_INSTALADOR = path.join(__dirname, '..', '..', 'config.default.json');

const limpiarDatos = () => {
  borrar(process.env.DRIVESIDIAN_DATA_DIR);
  borrar(CONFIG_DEL_INSTALADOR);
  stateIndex.reiniciar();
};

describe('dónde guarda el agente sus datos', () => {
  it('respeta DRIVESIDIAN_DATA_DIR', () => {
    assert.equal(paths.dataDir(), process.env.DRIVESIDIAN_DATA_DIR);
    assert.equal(paths.configFile(), path.join(process.env.DRIVESIDIAN_DATA_DIR, 'config.json'));
  });

  it('en Windows usa %APPDATA%\\Drivesidian, no la carpeta del programa', (t) => {
    const original = process.env.DRIVESIDIAN_DATA_DIR;
    delete process.env.DRIVESIDIAN_DATA_DIR;
    t.after(() => {
      process.env.DRIVESIDIAN_DATA_DIR = original;
    });
    comoPlataforma(t, 'win32');
    assert.equal(paths.dataDir(), path.join(process.env.APPDATA, 'Drivesidian'));
  });

  it('fuera de Windows usa ~/.config/drivesidian', (t) => {
    const original = process.env.DRIVESIDIAN_DATA_DIR;
    delete process.env.DRIVESIDIAN_DATA_DIR;
    t.after(() => {
      process.env.DRIVESIDIAN_DATA_DIR = original;
    });
    comoPlataforma(t, 'linux');
    assert.equal(paths.dataDir(), path.join(process.env.XDG_CONFIG_HOME, 'drivesidian'));
  });
});

describe('índice de estado local', () => {
  beforeEach(limpiarDatos);

  it('sin archivo previo arranca vacío y lo dice (dispara la reconciliación)', () => {
    assert.equal(stateIndex.obtener('Drivesidian/a.md'), null);
    assert.equal(stateIndex.estabaPresente(), false);
  });

  it('guarda hash y versión por nota, y sobrevive a un reinicio del agente', () => {
    stateIndex.registrar('Drivesidian/a.md', stateIndex.hashDe('hola'), 3);
    stateIndex.registrarVarios([{ vaultPath: 'Drivesidian/b.md', hash: 'h', version: 1 }]);
    stateIndex.reiniciar();
    assert.deepEqual(stateIndex.obtener('Drivesidian/a.md'), { hash: stateIndex.hashDe('hola'), version: 3 });
    assert.deepEqual(stateIndex.rutas().sort(), ['Drivesidian/a.md', 'Drivesidian/b.md']);
    assert.equal(stateIndex.estabaPresente(), true);
    stateIndex.olvidar('Drivesidian/a.md');
    assert.equal(stateIndex.obtener('Drivesidian/a.md'), null);
  });

  it('un índice corrupto se trata como ausente, sin tumbar al agente', () => {
    fs.mkdirSync(path.dirname(stateIndex.archivoIndice()), { recursive: true });
    fs.writeFileSync(stateIndex.archivoIndice(), '{roto');
    assert.equal(stateIndex.estabaPresente(), false);
    assert.deepEqual(stateIndex.rutas(), []);
  });

  it('si no puede guardar, lo registra en el log en vez de fallar', (t) => {
    const original = process.env.DRIVESIDIAN_DATA_DIR;
    const archivo = path.join(RAIZ, 'soy-un-archivo');
    fs.writeFileSync(archivo, 'x');
    process.env.DRIVESIDIAN_DATA_DIR = path.join(archivo, 'no-puede-ser-carpeta');
    t.after(() => {
      process.env.DRIVESIDIAN_DATA_DIR = original;
    });
    stateIndex.reiniciar();
    stateIndex.registrar('Drivesidian/x.md', 'h', 1);
    assert.ok(lineas.some((l) => l.includes('No se pudo guardar el índice')));
  });
});

describe('configuración del agente', () => {
  beforeEach(limpiarDatos);

  it('sin archivo apunta al servidor local de desarrollo', () => {
    assert.deepEqual(config.cargar(), {
      apiUrl: 'http://127.0.0.1:3000',
      agentToken: null,
      vaultPath: null,
      tokenEnClaro: false,
    });
  });

  it('DRIVESIDIAN_API_URL gana sobre el archivo y se le quita la barra final', (t) => {
    config.guardar({ apiUrl: 'https://del-archivo.com' });
    process.env.DRIVESIDIAN_API_URL = 'https://del-entorno.com/';
    t.after(() => delete process.env.DRIVESIDIAN_API_URL);
    assert.equal(config.cargar().apiUrl, 'https://del-entorno.com');
  });

  it('lee la URL que dejó el instalador aunque venga con BOM', () => {
    fs.writeFileSync(CONFIG_DEL_INSTALADOR, '\uFEFF{"apiUrl":"https://del-instalador.com"}');
    try {
      assert.equal(config.cargar().apiUrl, 'https://del-instalador.com');
    } finally {
      borrar(CONFIG_DEL_INSTALADOR);
    }
  });

  it('un config.json corrupto da un error claro', () => {
    fs.mkdirSync(path.dirname(config.configFile()), { recursive: true });
    fs.writeFileSync(config.configFile(), 'no es json');
    assert.throws(() => config.cargar(), /corrupto.*Bórralo/);
  });

  it('olvidar el token conserva el resto; borrar elimina el archivo', () => {
    config.olvidarToken(); // sin archivo no hace nada
    config.guardar({ apiUrl: 'https://s.com', vaultPath: 'C:\\Notas', agentToken: 'tok' });
    config.olvidarToken();
    const guardado = JSON.parse(fs.readFileSync(config.configFile(), 'utf8'));
    assert.deepEqual(guardado, { apiUrl: 'https://s.com', vaultPath: 'C:\\Notas' });
    config.borrar();
    assert.equal(fs.existsSync(config.configFile()), false);
    config.borrar(); // idempotente
  });

  it('borra el config.json aunque la ruta tenga acentos (C:\\Users\\José)', (t) => {
    const original = process.env.DRIVESIDIAN_DATA_DIR;
    process.env.DRIVESIDIAN_DATA_DIR = path.join(RAIZ, 'José', 'AppData', 'Drivesidian');
    t.after(() => {
      process.env.DRIVESIDIAN_DATA_DIR = original;
    });
    config.guardar({ apiUrl: 'https://s.com' });
    assert.equal(fs.existsSync(config.configFile()), true);
    config.borrar();
    assert.equal(fs.existsSync(config.configFile()), false, 'el desinstalador no debe dejar el archivo');
  });

  it('guardar el token como null lo quita del archivo', () => {
    config.guardar({ agentToken: 'tok' });
    config.guardar({ agentToken: null });
    const guardado = JSON.parse(fs.readFileSync(config.configFile(), 'utf8'));
    assert.equal(guardado.agentToken, undefined);
    assert.equal(guardado.agentTokenEnc, undefined);
  });
});

describe('token cifrado en disco', () => {
  beforeEach(limpiarDatos);

  if (process.platform === 'win32') {
    it('en Windows se cifra con DPAPI: el archivo nunca tiene el token en claro', () => {
      config.guardar({ agentToken: 'token.super.secreto' });
      const crudo = fs.readFileSync(config.configFile(), 'utf8');
      assert.doesNotMatch(crudo, /token\.super\.secreto/);
      assert.ok(JSON.parse(crudo).agentTokenEnc);
      const cargado = config.cargar();
      assert.equal(cargado.agentToken, 'token.super.secreto');
      assert.equal(cargado.tokenEnClaro, false);
    });

    it('un token que estaba en claro se migra a cifrado', () => {
      fs.mkdirSync(path.dirname(config.configFile()), { recursive: true });
      fs.writeFileSync(config.configFile(), JSON.stringify({ agentToken: 'viejo' }));
      assert.equal(config.cargar().tokenEnClaro, true);
      assert.equal(config.cifrarTokenExistente('viejo'), true);
      assert.equal(config.cargar().tokenEnClaro, false);
    });

    it('un blob de otra cuenta o de otro equipo no descifra: se trata como sin token', () => {
      fs.mkdirSync(path.dirname(config.configFile()), { recursive: true });
      fs.writeFileSync(config.configFile(), JSON.stringify({ agentTokenEnc: 'AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAA' }));
      assert.equal(config.cargar().agentToken, null);
    });
  }

  it('sin DPAPI (fuera de Windows) queda en claro y se reporta como tal', (t) => {
    comoPlataforma(t, 'linux');
    config.guardar({ agentToken: 'tok' });
    assert.equal(config.cargar().tokenEnClaro, true);
    assert.equal(config.cifrarTokenExistente('tok'), false);
  });

  it('si PowerShell falla al cifrar, guarda en claro y lo avisa en el log', (t) => {
    comoPlataforma(t, 'win32');
    t.mock.method(childProcess, 'execFileSync', () => {
      throw new Error('powershell no disponible');
    });
    const secureStore = cargarFresco('secureStore');
    t.after(() => cargarFresco('secureStore'));
    assert.equal(secureStore.cifrar('x'), null);
    assert.equal(secureStore.descifrar('x'), null);
    assert.ok(lineas.some((l) => l.includes('Se guardará en texto plano')));
    assert.ok(lineas.some((l) => l.includes('no se pudo descifrar')));
  });

  it('pasa el token a PowerShell por stdin, nunca como argumento', (t) => {
    comoPlataforma(t, 'win32');
    const llamada = t.mock.method(childProcess, 'execFileSync', () => 'BLOB\n');
    const secureStore = cargarFresco('secureStore');
    t.after(() => cargarFresco('secureStore'));
    assert.equal(secureStore.cifrar('token.secreto'), 'BLOB');
    const [, args, opciones] = llamada.mock.calls[0].arguments;
    assert.ok(args.every((a) => !a.includes('token.secreto')));
    assert.equal(opciones.input, 'token.secreto');
  });
});

describe('log a disco', () => {
  it('escribe cada línea en agent.log y rota el archivo al pasar de 5 MB', () => {
    const log = cargarFresco('log');
    fs.mkdirSync(path.dirname(log.logFile), { recursive: true });
    fs.writeFileSync(log.logFile, 'x'.repeat(5 * 1024 * 1024 + 10));
    const logRotado = cargarFresco('log');
    logRotado.info('primera línea tras rotar');
    logRotado.warn('aviso');
    logRotado.error('error');
    assert.ok(fs.existsSync(`${logRotado.logFile}.1`));
    const contenido = fs.readFileSync(logRotado.logFile, 'utf8');
    assert.match(contenido, /INFO  primera línea tras rotar/);
    assert.match(contenido, /ERROR error/);
  });
});
