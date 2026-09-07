'use strict';

const { z } = require('zod');

// Usado por la web en PUT /api/notes/:id: siempre exige version para el
// compare-and-swap.
const updateSchema = z.object({
  content: z.string({
    error: (issue) => (issue.input === undefined ? 'content es requerido.' : 'content debe ser texto.'),
  }),
  version: z
    .number({
      error: (issue) => (issue.input === undefined ? 'version es requerido.' : 'version debe ser un número.'),
    })
    .int('version debe ser un entero.')
    .positive('version debe ser mayor a cero.'),
});

module.exports = { updateSchema };
