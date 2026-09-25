'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Estado de conflicto: la versión local que el agente no pudo aplicar porque
  // el servidor también había cambiado desde la última sincronización.
  //
  // Una nota está en conflicto si conflict_content NO es nulo.
  //
  // NO se toca sync_status. Hoy significa "pendiente de subir a GitHub" y eso
  // sigue siendo cierto durante un conflicto, porque `content` sigue siendo la
  // versión autoritativa del servidor. Meter un tercer valor ahí mezclaría dos
  // conceptos distintos y complicaría el worker sin ganar nada.
  pgm.addColumns('notes', {
    conflict_content: { type: 'text' },
    conflict_hash: { type: 'text' },
    conflict_detected_at: { type: 'timestamptz' },
  });

  // El endpoint de bajada excluye las notas en conflicto y pagina por
  // (updated_at, id), que es el orden que recorre.
  pgm.createIndex('notes', ['user_id', 'updated_at', 'id']);
};

exports.down = (pgm) => {
  pgm.dropIndex('notes', ['user_id', 'updated_at', 'id']);
  pgm.dropColumns('notes', ['conflict_content', 'conflict_hash', 'conflict_detected_at']);
};
