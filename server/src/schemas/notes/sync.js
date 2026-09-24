'use strict';

const { z } = require('zod');
const { MAX_NOTE_BYTES } = require('../../config');

const MAX_VAULT_PATH_LENGTH = 1024;

// Se mide en bytes, no en caracteres: una nota de acentos o emojis pesa más de
// lo que aparenta, y lo que importa es lo que ocupa en Postgres y en el árbol
// que se manda a GitHub.
const withinByteLimit = (content) => Buffer.byteLength(content, 'utf8') <= MAX_NOTE_BYTES;
const byteLimitMessage = `La nota excede el máximo de ${MAX_NOTE_BYTES / 1024 / 1024} MiB.`;

// Usado por el agente en PUT /api/notes/sync: nunca manda version.
const syncSchema = z.object({
  vault_path: z
    .string({
      error: (issue) => (issue.input === undefined ? 'vault_path es requerido.' : 'vault_path debe ser texto.'),
    })
    .min(1, 'vault_path no puede estar vacío.')
    .max(MAX_VAULT_PATH_LENGTH, `vault_path no puede pasar de ${MAX_VAULT_PATH_LENGTH} caracteres.`),
  content: z
    .string({
      error: (issue) => (issue.input === undefined ? 'content es requerido.' : 'content debe ser texto.'),
    })
    .refine(withinByteLimit, byteLimitMessage),
});

module.exports = { syncSchema, withinByteLimit, byteLimitMessage };
