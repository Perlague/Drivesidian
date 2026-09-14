'use strict';

const { z } = require('zod');

const confirm2faSchema = z.object({
  secret: z
    .string({
      error: (issue) => (issue.input === undefined ? 'secret es requerido.' : 'secret debe ser texto.'),
    })
    .min(1, 'secret no puede estar vacío.'),
  code: z
    .string({
      error: (issue) => (issue.input === undefined ? 'code es requerido.' : 'code debe ser texto.'),
    })
    .regex(/^\d{6}$/, 'code debe ser un código de 6 dígitos.'),
});

module.exports = { confirm2faSchema };
