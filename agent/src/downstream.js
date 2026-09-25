'use strict';

const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const log = require('./log');
const stateIndex = require('./stateIndex');
const { descargarCambios } = require('./api');
const { SYNCED_FOLDER } = require('./paths');

const INTERVALO_MS = 60 * 1000;

const rutaAbsoluta = (vaultPath, notaPath) => path.join(vaultPath, ...notaPath.split('/'));

const leerSiExiste = async (ruta) => {
  try {
    return await fs.readFile(ruta, 'utf8');
  } catch {
    return null;
  }
};

// Escribe una nota que vino del servidor.
//
// El orden importa y es la clave del anti-bucle: el hash se apunta en el
// índice ANTES de tocar el disco. Cuando chokidar avise del cambio, el
// watcher comparará el contenido con el índice, verá que es lo que el propio
// agente acaba de escribir, y no lo reportará. Sin temporizadores ni listas de
// rutas suprimidas.
const escribirNota = async (vaultPath, nota) => {
  const destino = rutaAbsoluta(vaultPath, nota.vault_path);

  stateIndex.registrar(nota.vault_path, stateIndex.hashDe(nota.content), nota.version);

  await fs.mkdir(path.dirname(destino), { recursive: true });
  await fs.writeFile(destino, nota.content, 'utf8');
};

// Aplica una tanda de cambios bajados. Devuelve cuántas se escribieron.
//
// Una nota solo se escribe si el archivo local coincide con lo que el índice
// dice que sincronizamos. Si el disco cambió por su cuenta, escribir encima
// borraría el trabajo del usuario: eso es un conflicto y lo resuelve el
// camino de subida, que lo reportará al servidor.
const aplicarCambios = async (vaultPath, notas) => {
  let escritas = 0;

  for (const nota of notas) {
    const destino = rutaAbsoluta(vaultPath, nota.vault_path);
    const conocida = stateIndex.obtener(nota.vault_path);
    const enDisco = await leerSiExiste(destino);

    if (enDisco !== null && conocida && stateIndex.hashDe(enDisco) !== conocida.hash) {
      log.warn(`"${nota.vault_path}" cambió en el disco: no se sobrescribe con la versión del servidor.`);
      continue;
    }

    if (enDisco !== null && stateIndex.hashDe(enDisco) === stateIndex.hashDe(nota.content)) {
      // Ya coincide: basta con dejar constancia de la versión.
      stateIndex.registrar(nota.vault_path, stateIndex.hashDe(nota.content), nota.version);
      continue;
    }

    await escribirNota(vaultPath, nota);
    escritas += 1;
    log.info(`Bajada: ${nota.vault_path}`);
  }

  return escritas;
};

// Recorre todas las páginas desde un cursor. `alAplicar` recibe cada tanda.
const recorrerCambios = async (contexto, cursorInicial, alAplicar) => {
  let cursor = cursorInicial;
  let vueltas = 0;

  // Tope de seguridad: si algo va mal con el cursor, mejor cortar que quedarse
  // pidiendo páginas para siempre.
  while (vueltas < 100) {
    const datos = await descargarCambios({ ...contexto, cursor });
    if (!datos) return cursor;

    await alAplicar(datos.notes);
    if (datos.cursor) cursor = datos.cursor;

    vueltas += 1;
    if (!datos.has_more) break;
  }

  return cursor;
};

// Lista las notas .md del vault, con la ruta en el formato que usa el servidor
// (relativa y con barras normales).
const notasEnDisco = async (vaultPath) => {
  const raiz = path.join(vaultPath, SYNCED_FOLDER);
  const encontradas = [];

  const recorrer = async (dir) => {
    let entradas;
    try {
      entradas = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entrada of entradas) {
      const completa = path.join(dir, entrada.name);
      if (entrada.isDirectory()) {
        if (entrada.name === '.obsidian' || entrada.name === '.trash') continue;
        await recorrer(completa);
      } else if (path.extname(entrada.name).toLowerCase() === '.md') {
        encontradas.push(path.relative(vaultPath, completa).split(path.sep).join('/'));
      }
    }
  };

  await recorrer(raiz);
  return encontradas;
};

// Reconciliación: el agente arranca sin memoria de lo que sincronizó —recién
// instalado, índice corrupto, o una cuenta con notas que se vincula desde otra
// máquina— pero el vault local ya tiene archivos.
//
// No puede imponer su estado. Subir el disco a ciegas pisaría versiones más
// nuevas del servidor; escribir el servidor a ciegas pisaría el trabajo local.
// Sin índice, lo único fiable es comparar CONTENIDO:
//
//   no existe en disco   -> se escribe
//   contenido igual      -> solo se apunta en el índice
//   contenido distinto   -> se sube sin base_version, y el servidor lo marca
//                           como conflicto: nadie pisa a nadie
//   solo en disco        -> se sube como nota nueva
const reconciliar = async (contexto, vaultPath, cola) => {
  log.info('Sin índice de sincronización: reconciliando contra el servidor antes de empezar.');

  const delServidor = new Set();
  let divergentes = 0;

  const cursor = await recorrerCambios(contexto, null, async (notas) => {
    const aRegistrar = [];

    for (const nota of notas) {
      delServidor.add(nota.vault_path);
      const destino = rutaAbsoluta(vaultPath, nota.vault_path);
      const enDisco = await leerSiExiste(destino);

      if (enDisco === null) {
        await escribirNota(vaultPath, nota);
        continue;
      }

      if (stateIndex.hashDe(enDisco) === stateIndex.hashDe(nota.content)) {
        aRegistrar.push({
          vaultPath: nota.vault_path,
          hash: stateIndex.hashDe(nota.content),
          version: nota.version,
        });
        continue;
      }

      // Difieren y no sabemos cuál es más nueva. Se manda la local SIN
      // registrar nada en el índice, para que la subida vaya sin
      // base_version y el servidor la marque como conflicto.
      divergentes += 1;
      cola.encolar(nota.vault_path, enDisco);
    }

    if (aRegistrar.length > 0) stateIndex.registrarVarios(aRegistrar);
  });

  // Lo que hay en el disco y el servidor no conoce: notas nuevas.
  const locales = await notasEnDisco(vaultPath);
  let nuevas = 0;
  for (const ruta of locales) {
    if (delServidor.has(ruta)) continue;
    const contenido = await leerSiExiste(rutaAbsoluta(vaultPath, ruta));
    if (contenido === null) continue;
    cola.encolar(ruta, contenido);
    nuevas += 1;
  }

  log.info(
    `Reconciliación lista: ${delServidor.size} nota(s) del servidor, ${nuevas} solo en disco, ${divergentes} en conflicto.`,
  );

  return cursor;
};

// Bucle de bajada. El propio sondeo hace de latido: si el servidor recibe esta
// consulta, el equipo está encendido. No hace falta un endpoint de ping
// aparte, que gastaría cuota sin traer trabajo.
const iniciarBajada = (contexto, vaultPath, cursorInicial) => {
  const intervalo = Number(process.env.DRIVESIDIAN_PULL_MS) || INTERVALO_MS;
  let cursor = cursorInicial;
  let enCurso = false;

  const vuelta = async () => {
    if (enCurso) return; // una consulta lenta no debe solaparse con la siguiente
    enCurso = true;
    try {
      cursor = await recorrerCambios(contexto, cursor, (notas) => aplicarCambios(vaultPath, notas));
    } catch (err) {
      log.error(`Error bajando cambios: ${err.message}`);
    } finally {
      enCurso = false;
    }
  };

  const temporizador = setInterval(vuelta, intervalo);
  log.info(`Consultando cambios del servidor cada ${Math.round(intervalo / 1000)}s`);
  vuelta();

  return () => clearInterval(temporizador);
};

module.exports = { reconciliar, iniciarBajada, aplicarCambios, escribirNota, notasEnDisco };
