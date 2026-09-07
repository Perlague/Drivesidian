'use strict';

const { z } = require('zod');

// Usado por el agente en PUT /api/notes/sync: nunca manda version.
const syncSchema = z.object({
  vault_path: z
    .string({
      error: (issue) => (issue.input === undefined ? 'vault_path es requerido.' : 'vault_path debe ser texto.'),
    })
    .min(1, 'vault_path no puede estar vacío.'),
  content: z.string({
    error: (issue) => (issue.input === undefined ? 'content es requerido.' : 'content debe ser texto.'),
  }),
});

module.exports = { syncSchema };
