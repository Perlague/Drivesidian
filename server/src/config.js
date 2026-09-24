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
};
