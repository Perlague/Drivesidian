'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  pgm.createTable('security_events', {
    id: { type: 'bigserial', primaryKey: true },
    occurred_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
    type: { type: 'text', notNull: true },
    severity: { type: 'text', notNull: true, default: 'info' },
    // Nullable a propósito: un login fallido con un correo inexistente no
    // tiene usuario al que atribuirse, y ese evento es justo uno de los que
    // más importan.
    user_id: { type: 'bigint', references: 'users' },
    ip: { type: 'text' },
    user_agent: { type: 'text' },
    details: { type: 'jsonb', notNull: true, default: '{}' },
  });
  pgm.addConstraint(
    'security_events',
    'security_events_severity_check',
    "CHECK (severity IN ('info', 'warn', 'critical'))",
  );

  // occurred_at DESC: el panel de admin y la poda por retención consultan
  // siempre por fecha, de lo más reciente hacia atrás.
  pgm.createIndex('security_events', [{ name: 'occurred_at', sort: 'DESC' }]);
  // Guardian filtra por tipo de evento y por IP para decidir si actúa.
  pgm.createIndex('security_events', 'type');
  pgm.createIndex('security_events', 'ip');
};

exports.down = (pgm) => {
  pgm.dropTable('security_events');
};
