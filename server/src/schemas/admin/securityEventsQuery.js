'use strict';

const { z } = require('zod');

const MAX_LIMIT = 500;

// Los query params llegan siempre como texto, así que se convierten aquí en vez
// de dejar que el modelo reciba strings donde espera números o fechas.
const securityEventsQuerySchema = z.object({
  type: z.string().max(60).optional(),
  severity: z.enum(['info', 'warn', 'critical'], {
    error: () => 'severity debe ser info, warn o critical.',
  }).optional(),
  since: z.coerce.date({ error: () => 'since debe ser una fecha válida.' }).optional(),
  until: z.coerce.date({ error: () => 'until debe ser una fecha válida.' }).optional(),
  limit: z.coerce
    .number({ error: () => 'limit debe ser un número.' })
    .int()
    .positive()
    .max(MAX_LIMIT, `limit no puede pasar de ${MAX_LIMIT}.`)
    .optional()
    .default(100),
  offset: z.coerce
    .number({ error: () => 'offset debe ser un número.' })
    .int()
    .min(0)
    .optional()
    .default(0),
});

module.exports = { securityEventsQuerySchema };
