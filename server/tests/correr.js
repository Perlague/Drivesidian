'use strict';

// Punto de entrada de `pnpm test`.
//
// 1. Aplica las migraciones a la base de pruebas (nunca a la de desarrollo).
// 2. Corre toda la suite con el runner nativo de Node, sin dependencias nuevas.
// 3. Mide la cobertura de src/ y FALLA si baja de los umbrales.
// 4. Deja los reportes: lcov para SonarQube, JUnit y un resumen legible en
//    reports/pruebas/ en la raíz del repositorio.
//
// La base se levanta aparte: `pnpm run test:db` en local, o el servicio de
// PostgreSQL del pipeline en CI.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const SERVER = path.join(__dirname, '..');
const REPORTES = path.join(SERVER, '..', 'reports', 'pruebas');
const DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://drivesidian:test@localhost:55432/drivesidian_test';

const migrar = spawnSync(
  process.execPath,
  [path.join(SERVER, 'node_modules', 'node-pg-migrate', 'bin', 'node-pg-migrate.js'), 'up'],
  { cwd: SERVER, env: { ...process.env, DATABASE_URL }, encoding: 'utf8' },
);
if (migrar.status !== 0) {
  process.stderr.write(`${migrar.stdout || ''}${migrar.stderr || ''}\n`);
  process.stderr.write(
    'No se pudo migrar la base de pruebas. ¿Está arriba?\n  pnpm run test:db\n',
  );
  process.exit(1);
}

fs.mkdirSync(path.join(SERVER, 'coverage'), { recursive: true });
fs.mkdirSync(REPORTES, { recursive: true });

const args = [
  '--test',
  // Un archivo a la vez: comparten la base de pruebas y cada uno la limpia.
  '--test-concurrency=1',
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
  `--test-reporter-destination=${path.join(REPORTES, 'servidor-junit.xml')}`,
  'tests/**/*.test.js',
];

const corrida = spawnSync(process.execPath, args, {
  cwd: SERVER,
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

// En el lcov cada ruta va desde la raíz del repositorio (server/src/...) y con
// barras normales: así SonarQube la encuentra, se genere en Windows o en Linux.
const lcov = fs
  .readFileSync(path.join(__dirname, '..', 'coverage', 'lcov.info'), 'utf8')
  .replace(/^SF:(.*)$/gm, (_, ruta) => `SF:server/${ruta.split('\\').join('/')}`);

fs.writeFileSync(path.join(REPORTES, 'servidor-resumen.txt'), sinRutasLocales(salida));
fs.writeFileSync(path.join(REPORTES, 'servidor-lcov.info'), lcov);
const junit = path.join(REPORTES, 'servidor-junit.xml');
// El reporte JUnit trae además el nombre del equipo en cada caso.
fs.writeFileSync(
  junit,
  sinRutasLocales(fs.readFileSync(junit, 'utf8')).replace(/hostname="[^"]*"/g, 'hostname="drivesidian"'),
);

process.exit(corrida.status ?? 1);
