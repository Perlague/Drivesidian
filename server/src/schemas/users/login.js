'use strict';

const { z } = require('zod');

const loginSchema = z.object({
  email: z
    .string({
      error: (issue) => (issue.input === undefined ? 'El correo es requerido.' : 'El correo debe ser texto.'),
    })
    .email('El correo no tiene un formato válido.'),
  password: z
    .string({
      error: (issue) => (issue.input === undefined ? 'La contraseña es requerida.' : 'La contraseña debe ser texto.'),
    })
    .min(1, 'La contraseña no puede estar vacía.'),
});

module.exports = { loginSchema };
