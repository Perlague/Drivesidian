'use strict';

exports.shorthands = undefined;

// IP pública desde la que el agente pidió el código. Sirve para que el panel
// web ofrezca «Vincular este equipo» cuando el navegador no se abrió solo: el
// agente y el navegador de la misma computadora salen por la misma IP.
exports.up = (pgm) => {
  pgm.addColumns('pairing_codes', {
    requester_ip: { type: 'text' },
  });
};

exports.down = (pgm) => {
  pgm.dropColumns('pairing_codes', ['requester_ip']);
};
