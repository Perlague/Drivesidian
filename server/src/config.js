'use strict';

const MAX_NOTE_BYTES = 1024 * 1024; // 1 MiB

module.exports = {
  SESSION_COOKIE_NAME: 'drivesidian_session',
  SESSION_TTL_SECONDS: 60 * 60 * 8, // 8 horas

  // Tamaño máximo del contenido de una nota. Se valida en bytes y no en
  // caracteres porque es lo que de verdad ocupa en memoria, en Postgres y en
  // el árbol que se manda a GitHub: un texto con acentos pesa más que su
  // número de caracteres.
  MAX_NOTE_BYTES,

  // Límite del body de Express. Va por encima de MAX_NOTE_BYTES para dejar
  // margen al escapado del JSON y al resto del payload, de modo que una nota
  // demasiado grande falle con el mensaje claro de zod en lugar de un 413
  // genérico. El 413 queda como red de seguridad para payloads absurdos.
  MAX_REQUEST_BODY: '1200kb',

  // Notas por usuario y por ciclo del worker. El límite es POR USUARIO, no
  // global: con un tope global y el orden por user_id, un usuario con cientos
  // de notas pendientes dejaría a los demás sin sincronizar nunca.
  SYNC_NOTES_PER_USER: 100,

  // Tope de bytes por lote enviado a GitHub. Con 100 notas de 1 MiB el lote
  // teórico serían 100 MiB en un solo request, que GitHub rechazaría y —al ser
  // el lote todo o nada— dejaría la cola de ese usuario atascada para siempre.
  // Lo que no entra se queda pendiente para el ciclo siguiente.
  MAX_BATCH_BYTES: 20 * 1024 * 1024, // 20 MiB

  // Notas que devuelve como mucho una consulta a /api/notes/changes. Acota la
  // memoria de la respuesta: con 2000 notas y 1 MiB cada una, devolverlas todas
  // de golpe sería insostenible. El agente pagina con el cursor.
  NOTES_CHANGES_LIMIT: 200,

  // A partir de cuántas notas en una sola respuesta se considera una lectura
  // masiva y se reporta al feed de seguridad. Un agente al día pide unas pocas;
  // alguien exfiltrando pide todo.
  BULK_READ_THRESHOLD: 100,

  // Una lectura masiva sostenida debe producir UN evento por ventana, no uno
  // por petición: Guardian lee el feed y cada línea le cuesta tokens.
  BULK_READ_WINDOW_MS: 60 * 60 * 1000,

  // Notas totales por usuario. Un vault normal ronda las cientos; 2000 deja
  // margen de sobra y ataja un agente en bucle o un vault clonado por error.
  MAX_NOTES_PER_USER: 2000,

  // Alcances de un agent token. Hoy el agente pide los dos, pero declararlos
  // permite que mañana un consumidor que solo lea —un visor en el celular, un
  // script de respaldo— pida uno con lectura nada más, sin inventar otra tabla
  // ni otro flujo de vinculación.
  AGENT_SCOPES: {
    READ: 'notes:read',
    WRITE: 'notes:write',
  },

  // Cada cuánto se refresca `agent_tokens.last_used_at`. requireAuth ya
  // consulta esa tabla en cada request del agente; sin este umbral cada
  // petición sumaría además una escritura. Configurable como el resto de los
  // intervalos, sobre todo para poder probarlo sin esperar cinco minutos.
  LAST_USED_REFRESH_MS: Number(process.env.LAST_USED_REFRESH_MS) || 5 * 60 * 1000,

  // Peticiones por hora de un mismo agent token. La clave es el jti del token
  // y no la IP, porque un portátil cambia de red constantemente. Un vault real
  // edita unas decenas de notas por hora, así que 300 sobra para uso legítimo
  // y corta en seco un watcher que se quedó en bucle.
  AGENT_RATE_LIMIT: { windowMs: 60 * 60 * 1000, max: 300 },

  // Rate limit por IP del login, que es donde se verifica el código TOTP.
  LOGIN_RATE_LIMIT: { windowMs: 60 * 1000, max: 10 },

  // "Sincronizar ahora" del panel: cada pulsación habla con la API de GitHub,
  // así que se limita por usuario para que nadie la use de ariete.
  SYNC_NOW_RATE_LIMIT: { windowMs: 60 * 1000, max: 5 },

  // Vida de un código de vinculación. Corto a propósito: es la ventana en la
  // que alguien que vea el código en pantalla podría intentar algo, aunque sin
  // el verifier del agente no pueda canjear el token.
  PAIRING_TTL_MS: 10 * 60 * 1000,

  // Pedir códigos es anónimo, así que se limita por IP para que nadie llene la
  // tabla de códigos basura.
  PAIRING_START_RATE_LIMIT: { windowMs: 60 * 60 * 1000, max: 20 },

  // El agente hace polling cada ~2s durante los 10 minutos de vida del código:
  // unas 300 peticiones legítimas. El tope va por código, no por IP.
  PAIRING_STATUS_RATE_LIMIT: { windowMs: 10 * 60 * 1000, max: 400 },
};
