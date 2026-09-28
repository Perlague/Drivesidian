'use strict';

// Un id que llega por la URL o por la query es válido si es un entero positivo
// que cabe en un bigint de Postgres.
//
// Antes bastaba con /^\d+$/, y un número de 20 cifras pasaba el filtro: la base
// respondía con un error de rango y la API devolvía un 500 donde correspondía un
// 400. Cualquiera podía provocar errores del servidor a voluntad.
const MAX_BIGINT = 9223372036854775807n;

const esIdValido = (valor) => {
  const texto = String(valor);
  if (!/^\d{1,19}$/.test(texto)) return false;
  const numero = BigInt(texto);
  return numero > 0n && numero <= MAX_BIGINT;
};

// Igual, pero admite el 0: el cursor de la bajada empieza en 0.
const esCursorValido = (valor) => valor === '0' || esIdValido(valor);

module.exports = { esIdValido, esCursorValido };
