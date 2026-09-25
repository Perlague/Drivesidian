'use strict';

const log = require('./log');
const stateIndex = require('./stateIndex');

const REINTENTO_BASE_MS = 2000;
const REINTENTO_MAX_MS = 5 * 60 * 1000;

// Cola en memoria indexada por ruta: si una nota se edita cinco veces mientras
// no hay red, solo se manda su contenido final. No persiste entre reinicios, y
// no hace falta que lo haga — al arrancar, el watcher recorre la carpeta otra
// vez y el servidor descarta lo que no cambió comparando content_hash.
class ColaDeSync {
  constructor({ apiUrl, agentToken, onTokenInvalido }) {
    this.apiUrl = apiUrl;
    this.agentToken = agentToken;
    this.onTokenInvalido = onTokenInvalido;
    this.pendientes = new Map();
    this.drenando = false;
    this.esperaMs = REINTENTO_BASE_MS;
  }

  encolar(vaultPath, content) {
    this.pendientes.set(vaultPath, content);
    this.drenar();
  }

  async drenar() {
    if (this.drenando) return;
    this.drenando = true;

    try {
      while (this.pendientes.size > 0) {
        const [vaultPath, content] = this.pendientes.entries().next().value;
        const resultado = await this.enviar(vaultPath, content);

        if (resultado === 'ok' || resultado === 'descartar') {
          // Se borra por clave y no la primera entrada: si la nota se volvió a
          // editar mientras se enviaba, ese contenido nuevo ya la reemplazó y
          // borrarla perdería la edición.
          if (this.pendientes.get(vaultPath) === content) this.pendientes.delete(vaultPath);
          this.esperaMs = REINTENTO_BASE_MS;
          continue;
        }

        if (resultado === 'detener') {
          this.pendientes.clear();
          break;
        }

        // 'reintentar': se espera con backoff y se vuelve a intentar la misma.
        log.warn(`Reintentando en ${Math.round(this.esperaMs / 1000)}s…`);
        await new Promise((r) => setTimeout(r, this.esperaMs));
        this.esperaMs = Math.min(this.esperaMs * 2, REINTENTO_MAX_MS);
      }
    } finally {
      this.drenando = false;
    }
  }

  async enviar(vaultPath, content) {
    // La versión de la que parte esta edición, según el índice local. Es lo
    // que permite al servidor distinguir "el agente va al día" de "cambiaron
    // los dos lados". Si la ruta no está en el índice no se manda nada, y el
    // servidor lo trata como conflicto en vez de sobrescribir a ciegas.
    const conocida = stateIndex.obtener(vaultPath);

    let respuesta;
    try {
      respuesta = await fetch(`${this.apiUrl}/api/notes/sync`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.agentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          vault_path: vaultPath,
          content,
          ...(conocida ? { base_version: conocida.version } : {}),
        }),
      });
    } catch (err) {
      log.warn(`Sin conexión con el servidor (${err.message}).`);
      return 'reintentar';
    }

    if (respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => null);
      const nota = cuerpo?.data;

      // El índice se actualiza con lo que el servidor confirmó, no con lo que
      // creíamos: si no, la próxima subida mandaría una base_version que el
      // servidor ya no reconoce y se inventaría un conflicto.
      if (nota) stateIndex.registrar(vaultPath, stateIndex.hashDe(content), nota.version);

      // changed = false significa que el contenido era idéntico al guardado y
      // el servidor no reencoló nada. Pasa en cada arranque del agente.
      if (nota?.changed === false) log.info(`Sin cambios: ${vaultPath}`);
      else log.info(`Reportada: ${vaultPath}`);
      return 'ok';
    }

    // 409 = el servidor y el disco cambiaron los dos desde la última
    // sincronización. El agente NO decide: corre en segundo plano sin nadie
    // mirando. La nota queda marcada en el servidor y se resuelve desde el
    // panel. Reintentar este mismo contenido daría 409 otra vez.
    if (respuesta.status === 409) {
      log.warn(`Conflicto en "${vaultPath}": resuélvelo desde el panel web.`);
      return 'descartar';
    }

    const cuerpo = await respuesta.json().catch(() => null);
    const mensaje = cuerpo?.error?.message || `HTTP ${respuesta.status}`;

    // El token dejó de valer: o lo revocaron desde el panel, o se desinstaló y
    // reinstaló. Insistir no sirve de nada y solo genera eventos de seguridad.
    if (respuesta.status === 401) {
      log.error(`El acceso de este equipo fue revocado (${mensaje}).`);
      this.onTokenInvalido();
      return 'detener';
    }

    // Errores del propio contenido: la nota es demasiado grande, o se alcanzó
    // la cuota. Reintentarla sería un bucle infinito con el mismo resultado.
    if (respuesta.status === 413 || respuesta.status === 403 || respuesta.status === 400) {
      log.error(`No se pudo sincronizar "${vaultPath}": ${mensaje}`);
      return 'descartar';
    }

    // Rate limit: el servidor dice cuánto esperar, así que se le hace caso en
    // vez de aplicar el backoff a ciegas.
    if (respuesta.status === 429) {
      const segundos = Number(respuesta.headers.get('retry-after')) || 60;
      log.warn(`Límite de peticiones alcanzado. Esperando ${segundos}s.`);
      this.esperaMs = segundos * 1000;
      return 'reintentar';
    }

    log.warn(`El servidor respondió ${respuesta.status} para "${vaultPath}": ${mensaje}`);
    return 'reintentar';
  }
}

// Bajada: qué cambió en el servidor desde el cursor. Devuelve null si no se
// pudo consultar, para que el bucle simplemente reintente en la vuelta
// siguiente en vez de tratarlo como un error fatal.
//
// El servidor no puede empujar —el agente está detrás del NAT del usuario—,
// así que el agente pregunta. Eso tiene una ventaja: con el equipo apagado no
// se acumula nada, porque nadie está preguntando.
const descargarCambios = async ({ apiUrl, agentToken, cursor, onTokenInvalido }) => {
  const query = cursor
    ? `?since=${encodeURIComponent(cursor.since)}&since_id=${encodeURIComponent(cursor.since_id)}`
    : '';

  let respuesta;
  try {
    respuesta = await fetch(`${apiUrl}/api/notes/changes${query}`, {
      headers: { Authorization: `Bearer ${agentToken}` },
    });
  } catch (err) {
    log.warn(`No se pudo consultar los cambios (${err.message}).`);
    return null;
  }

  if (respuesta.status === 401) {
    const cuerpo = await respuesta.json().catch(() => null);
    log.error(`El acceso de este equipo fue revocado (${cuerpo?.error?.message || 'HTTP 401'}).`);
    onTokenInvalido();
    return null;
  }

  if (!respuesta.ok) {
    const cuerpo = await respuesta.json().catch(() => null);
    log.warn(`El servidor respondió ${respuesta.status} al consultar cambios: ${cuerpo?.error?.message || ''}`);
    return null;
  }

  const cuerpo = await respuesta.json();
  return cuerpo.data;
};

module.exports = { ColaDeSync, descargarCambios };
