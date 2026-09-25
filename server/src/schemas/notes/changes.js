'use strict';

const { z } = require('zod');

// Query de GET /api/notes/changes. El cursor son dos campos y no uno porque la
// paginación va por (updated_at, id): dos notas escritas en la misma
// transacción comparten timestamp, y con un cursor de un solo campo el LIMIT
// dejaría una fuera para siempre.
//
// Sin `since` se devuelve desde el principio, que es lo que hace el agente
// cuando reconcilia por haber perdido su índice.
// `since` se valida pero NO se convierte a Date: se pasa a Postgres tal cual
// llegó. Un Date de JavaScript solo tiene milisegundos y truncaría los
// microsegundos del timestamp original, con lo que la última nota de cada
// página volvería a salir en la siguiente.
//
// Lo mismo con `since_id`: se queda como texto y lo castea Postgres, para no
// depender de que un bigint quepa en un número de JavaScript.
const changesQuerySchema = z.object({
  since: z
    .string({ error: () => 'since debe ser texto.' })
    .refine((valor) => !Number.isNaN(Date.parse(valor)), 'since debe ser una fecha válida.')
    .optional(),
  since_id: z
    .string({ error: () => 'since_id debe ser texto.' })
    .regex(/^\d+$/, 'since_id debe ser un entero.')
    .optional()
    .default('0'),
});

module.exports = { changesQuerySchema };
