'use strict';

const { z } = require('zod');
const { withinByteLimit, byteLimitMessage } = require('./sync');
const { normalizarRutaDeNota } = require('../../utils/notePath');

// Usado por el panel web en POST /api/notes.
//
// A diferencia del agente —que reporta rutas que ya existen en un disco—, aquí
// el nombre lo teclea una persona, así que se normaliza antes de validar: se
// fuerza la carpeta sincronizada y la extensión .md.
const createSchema = z.object({
  vault_path: z
    .string({
      error: (issue) =>
        issue.input === undefined ? 'El nombre es requerido.' : 'El nombre debe ser texto.',
    })
    .max(1024, 'El nombre es demasiado largo.')
    .transform(normalizarRutaDeNota)
    .refine((ruta) => ruta.length > 0, 'Ese nombre no es válido para una nota.'),
  content: z
    .string({ error: () => 'content debe ser texto.' })
    .refine(withinByteLimit, byteLimitMessage)
    .optional()
    .default(''),
});

module.exports = { createSchema };
