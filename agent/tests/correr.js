'use strict';

// Punto de entrada de `pnpm test` del agente. Igual que el del servidor:
// migra la base de pruebas (la prueba de extremo a extremo levanta el servidor
// real), corre la suite con cobertura y falla si baja de los umbrales.
//
// Requiere las dependencias del servidor instaladas (`pnpm install` en server/)
// y la base de pruebas arriba (`pnpm run test:db` en server/).

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const AGENTE = path.join(__dirname, '..');
const SERVER = path.join(AGENTE, '..', 'server');
const REPORTES = path.join(AGENTE, '..', 'reports', 'pruebas');
const DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://drivesidian:test@localhost:55432/drivesidian_test';

const migrar = spawnSync(
  process.execPath,
  [path.join(SERVER, 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js'), 'up'],
  { cwd: SERVER, env: { ...process.env, DATABASE_URL }, encoding: 'utf8' },
);
if (migrar.status !== 0) {
  process.stderr.write(`${migrar.stdout || ''}${migrar.stderr || ''}\n`);
  process.stderr.write('No se pudo migrar la base de pruebas. En server/: pnpm run test:db\n');
  process.exit(1);
}

fs.mkdirSync(path.join(AGENTE, 'coverage'), { recursive: true });
fs.mkdirSync(REPORTES, { recursive: true });

const args = [
  '--test',
  '--test-concurrency=1',
  '--test-timeout=60000',
  '--experimental-test-coverage',
  '--test-coverage-include=src/**/*.js',
  '--test-coverage-lines=80',
  '--test-coverage-functions=80',
  '--test-coverage-branches=70',
  '--test-reporter=spec',
  '--test-reporter-destination=stdout',
  '--test-reporter=lcov',
  '--test-reporter-destination=coverage/lcov.info',
  '--test-reporter=junit',
  `--test-reporter-destination=${path.join(REPORTES, 'agente-junit.xml')}`,
  'tests/**/*.test.js',
];

const corrida = spawnSync(process.execPath, args, {
  cwd: AGENTE,
  env: { ...process.env, TEST_DATABASE_URL: DATABASE_URL, FORCE_COLOR: '0' },
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
});

const salida = `${corrida.stdout || ''}${corrida.stderr || ''}`;
process.stdout.write(salida);

// Los reportes se versionan y el repositorio es público: nada de rutas
// absolutas de la máquina de quien corrió las pruebas. Todo relativo a la raíz.
const RAIZ = path.join(__dirname, '..', '..');
const sinRutasLocales = (texto) =>
  [RAIZ, RAIZ.split(path.sep).join('/')].reduce(
    (acc, raiz) => acc.split(`${raiz}${path.sep}`).join('').split(`${raiz}/`).join('').split(raiz).join('.'),
    texto,
  );

// En el lcov cada ruta va desde la raíz del repositorio (agent/src/...) y con
// barras normales: así SonarQube la encuentra, se genere en Windows o en Linux.
const lcov = fs
  .readFileSync(path.join(__dirname, '..', 'coverage', 'lcov.info'), 'utf8')
  .replace(/^SF:(.*)$/gm, (_, ruta) => `SF:agent/${ruta.split('\\').join('/')}`);

fs.writeFileSync(path.join(REPORTES, 'agente-resumen.txt'), sinRutasLocales(salida));
fs.writeFileSync(path.join(REPORTES, 'agente-lcov.info'), lcov);
const junit = path.join(REPORTES, 'agente-junit.xml');
// El reporte JUnit trae además el nombre del equipo en cada caso.
fs.writeFileSync(
  junit,
  sinRutasLocales(fs.readFileSync(junit, 'utf8')).replace(/hostname="[^"]*"/g, 'hostname="drivesidian"'),
);

process.exit(corrida.status ?? 1);
