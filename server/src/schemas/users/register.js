'use strict';

const { z } = require('zod');

const registerSchema = z.object({
  email: z
    .string({
      error: (issue) => (issue.input === undefined ? 'El correo es requerido.' : 'El correo debe ser texto.'),
    })
    .email('El correo no tiene un formato válido.'),
  password: z
    .string({
      error: (issue) => (issue.input === undefined ? 'La contraseña es requerida.' : 'La contraseña debe ser texto.'),
    })
    .min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

module.exports = { registerSchema };
