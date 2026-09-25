'use strict';

const log = require('./log');

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
    let respuesta;
    try {
      respuesta = await fetch(`${this.apiUrl}/api/notes/sync`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${this.agentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ vault_path: vaultPath, content }),
      });
    } catch (err) {
      log.warn(`Sin conexión con el servidor (${err.message}).`);
      return 'reintentar';
    }

    if (respuesta.ok) {
      const cuerpo = await respuesta.json().catch(() => null);
      // changed = false significa que el contenido era idéntico al guardado y
      // el servidor no reencoló nada. Pasa en cada arranque del agente.
      if (cuerpo?.data?.changed === false) log.info(`Sin cambios: ${vaultPath}`);
      else log.info(`Reportada: ${vaultPath}`);
      return 'ok';
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

module.exports = { ColaDeSync };
