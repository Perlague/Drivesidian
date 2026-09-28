'use strict';

require('../helpers/entorno');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { esIdValido, esCursorValido } = require('../../src/utils/id');

describe('validación de ids', () => {
  it('acepta enteros positivos que caben en un bigint', () => {
    for (const valido of ['1', '42', '9223372036854775807']) assert.equal(esIdValido(valido), true, valido);
  });

  it('rechaza lo que no es un entero positivo o no cabe en un bigint', () => {
    for (const malo of ['0', '-1', '1.5', 'abc', '', ' 1', '9223372036854775808', '99999999999999999999']) {
      assert.equal(esIdValido(malo), false, malo);
    }
  });

  it('el cursor admite además el 0 del principio', () => {
    assert.equal(esCursorValido('0'), true);
    assert.equal(esCursorValido('5'), true);
    assert.equal(esCursorValido('-1'), false);
  });
});
