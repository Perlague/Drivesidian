'use strict';

const { z } = require('zod');

const POR_PAGINA = 25;
const MAX_POR_PAGINA = 100;
// Con el tope de 2000 notas por usuario ninguna página real pasa de aquí. El
// techo existe para que (page - 1) * limit nunca salga del rango del OFFSET de
// Postgres: un número gigante daría un 500 en vez de un 400.
const MAX_PAGINA = 100_000;

// Los query params llegan siempre como texto, así que se convierten aquí en vez
// de dejar que el modelo reciba strings donde espera números.
const listQuerySchema = z.object({
  page: z.coerce
    .number({ error: () => 'page debe ser un número.' })
    .int('page debe ser un entero.')
    .positive('page empieza en 1.')
    .max(MAX_PAGINA, `page no puede pasar de ${MAX_PAGINA}.`)
    .optional()
    .default(1),
  limit: z.coerce
    .number({ error: () => 'limit debe ser un número.' })
    .int('limit debe ser un entero.')
    .positive('limit debe ser mayor que 0.')
    .max(MAX_POR_PAGINA, `limit no puede pasar de ${MAX_POR_PAGINA}.`)
    .optional()
    .default(POR_PAGINA),
});

module.exports = { listQuerySchema, POR_PAGINA, MAX_POR_PAGINA };
