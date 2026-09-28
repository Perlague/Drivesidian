'use strict';

// Punto de entrada de `pnpm run test:db`: deja una base de pruebas nueva y lista.
//
// 1. Borra el contenedor anterior si existe, esté detenido o corriendo. Un
//    `docker run` con el mismo nombre falla si quedó uno viejo, y un `stop`
//    no siempre lo borra (solo si se creó con --rm).
// 2. Levanta PostgreSQL 16 en el puerto 55432, lejos del 5432 de desarrollo.
// 3. Espera a que acepte conexiones: la imagen arranca, se reinicia una vez
//    para aplicar la configuración inicial y solo entonces está lista.
//
// En CI no se usa: ahí la base es un servicio del pipeline.

const { spawnSync } = require('child_process');

const NOMBRE = 'drivesidian-test-db';
const ESPERA_MAXIMA_MS = 60_000;

const docker = (args) => spawnSync('docker', args, { encoding: 'utf8' });

const salir = (mensaje) => {
  process.stderr.write(`${mensaje}\n`);
  process.exit(1);
};

const version = docker(['version', '--format', '{{.Server.Version}}']);
if (version.error || version.status !== 0) {
  salir('Docker no responde. Abre Docker Desktop y espera a que diga "Engine running".');
}

// Sin comprobar el resultado: si no existía, no hay nada que borrar.
docker(['rm', '-f', NOMBRE]);

const arranque = docker([
  'run', '--rm', '-d', '--name', NOMBRE,
  '-e', 'POSTGRES_USER=drivesidian',
  '-e', 'POSTGRES_PASSWORD=test',
  '-e', 'POSTGRES_DB=drivesidian_test',
  '-p', '55432:5432',
  'postgres:16-alpine',
]);
if (arranque.status !== 0) salir(arranque.stderr.trim());

// `pg_isready` contra la IP del contenedor y no por el socket: durante la
// inicialización la imagen levanta un servidor temporal solo por socket, y
// darlo por listo ahí haría fallar la primera conexión por TCP.
const inicio = Date.now();
const esperar = () => {
  const listo = docker(['exec', NOMBRE, 'pg_isready', '-h', '127.0.0.1', '-U', 'drivesidian']);
  if (listo.status === 0) {
    process.stdout.write(`Base de pruebas lista en localhost:55432 (${NOMBRE}).\n`);
    return;
  }
  if (Date.now() - inicio > ESPERA_MAXIMA_MS) {
    salir(`La base no respondió en ${ESPERA_MAXIMA_MS / 1000} s. Revisa: docker logs ${NOMBRE}`);
  }
  setTimeout(esperar, 500);
};
esperar();
