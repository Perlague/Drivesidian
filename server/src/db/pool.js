'use strict';

require('dotenv').config();
const { Pool } = require('pg');

// Cada conexión de Postgres es un proceso aparte del servidor, así que el
// tamaño del pool compite por la RAM de la instancia (una t3.small de 2 GB
// compartida con OpenClaw). El default de `pg` es 10 y no tiene relación con
// el max_connections de Postgres: 8 deja margen para las migraciones, un psql
// manual y cualquier otra conexión sin agotar el límite del servidor.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 8,
});

module.exports = pool;
