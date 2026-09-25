'use strict';

const { z } = require('zod');

// Usado por el panel web en POST /api/pairing/approve, con sesión iniciada.
const approveSchema = z.object({
  code: z
    .string({
      error: (issue) => (issue.input === undefined ? 'code es requerido.' : 'code debe ser texto.'),
    })
    .min(1, 'code no puede estar vacío.')
    .max(32, 'code inválido.'),
  // Cuál de los vaults detectados vigilará el agente. Si solo había uno, el
  // agente ya lo eligió y la web no manda nada.
  selected_vault: z.string().max(1024).optional(),
});

module.exports = { approveSchema };
