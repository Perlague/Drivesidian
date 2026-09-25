'use strict';

const { z } = require('zod');

// Usado por el agente en POST /api/pairing/start. Es un endpoint sin
// autenticación —el agente todavía no tiene token, justamente por eso
// vincula—, así que todo lo que llega aquí se valida con cuidado.
const startSchema = z.object({
  verifier_hash: z
    .string({
      error: (issue) =>
        issue.input === undefined ? 'verifier_hash es requerido.' : 'verifier_hash debe ser texto.',
    })
    .regex(/^[a-f0-9]{64}$/, 'verifier_hash debe ser un SHA-256 en hexadecimal.'),
  device_name: z.string().max(120, 'device_name no puede pasar de 120 caracteres.').optional(),
  vaults: z
    .array(
      z.object({
        name: z.string().max(200),
        path: z.string().max(1024),
      }),
    )
    .max(20, 'Demasiados vaults detectados.')
    .optional()
    .default([]),
});

module.exports = { startSchema };
