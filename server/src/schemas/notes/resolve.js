'use strict';

const { z } = require('zod');

// Body de POST /api/notes/:id/resolve.
//
// Dos opciones y no tres: a diferencia del editor web —donde el usuario tiene
// la nota abierta y puede fusionar a mano antes de guardar—, aquí solo se
// elige cuál de las dos versiones gana. La fusión manual sigue siendo posible
// después, editando la nota ya resuelta.
const resolveSchema = z.object({
  keep: z.enum(['server', 'local'], {
    error: (issue) =>
      issue.input === undefined
        ? 'keep es requerido.'
        : 'keep debe ser "server" (la del servidor) o "local" (la de tu computadora).',
  }),
});

module.exports = { resolveSchema };
