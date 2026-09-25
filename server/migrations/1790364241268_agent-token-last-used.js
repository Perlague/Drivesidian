'use strict';

exports.shorthands = undefined;

exports.up = (pgm) => {
  // Los agent tokens no expiran: la revocación es su único mecanismo de
  // caducidad. El problema de eso no es que duren, es que son invisibles —
  // nadie sabe si se están usando ni desde cuándo.
  //
  // Con esta columna el panel muestra "último uso: hace 2 minutos", y un token
  // activo mientras el equipo de su dueño está apagado se nota de inmediato.
  // Eso convierte la revocación en algo que se puede usar a tiempo en vez de a
  // ciegas.
  pgm.addColumn('agent_tokens', {
    last_used_at: { type: 'timestamptz' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumn('agent_tokens', 'last_used_at');
};
