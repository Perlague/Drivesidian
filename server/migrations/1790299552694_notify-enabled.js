'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Interruptor de notificaciones por usuario, manejado desde el panel web.
  // Por defecto encendido: quien no lo toque recibe sus avisos.
  //
  // No hay columna para el topic de ntfy: se deriva por HMAC desde el id del
  // usuario (ver src/utils/ntfyTopic.js).
  pgm.addColumn('users', {
    notify_enabled: { type: 'boolean', notNull: true, default: true },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('users', 'notify_enabled');
};
