'use strict';

require('../helpers/entorno');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  slugFromEmail,
  sanitizeVaultPath,
  buildUserFolder,
  buildRepoPath,
} = require('../../src/utils/repoPath');
const { normalizarRutaDeNota } = require('../../src/utils/notePath');

describe('carpeta de cada usuario en el repositorio compartido', () => {
  it('arma el slug desde la parte local del correo, sin acentos', () => {
    assert.equal(slugFromEmail('José.Pérez+notas@ejemplo.com'), 'jose-perez-notas');
    assert.equal(slugFromEmail(''), '');
    assert.equal(slugFromEmail(null), '');
  });

  it('recorta el slug a 30 caracteres sin dejar un guion colgando', () => {
    const slug = slugFromEmail(`${'a'.repeat(29)}-b@x.com`);
    assert.ok(slug.length <= 30);
    assert.ok(!slug.endsWith('-'));
  });

  it('usa solo el id si el correo no deja un slug útil', () => {
    assert.equal(buildUserFolder(4, '...@x.com'), 'user-4');
    assert.equal(buildUserFolder(4, 'ana@x.com'), 'user-4-ana');
  });
});

describe('saneamiento de rutas del vault (path traversal)', () => {
  it('descarta segmentos .. y . y normaliza barras de Windows', () => {
    assert.equal(sanitizeVaultPath('..\\..\\otro\\nota.md'), 'otro/nota.md');
    assert.equal(sanitizeVaultPath('./a/../b//c.md'), 'a/b/c.md');
    assert.equal(sanitizeVaultPath(undefined), '');
  });

  it('una ruta maliciosa no puede salir de la carpeta del usuario', () => {
    const ruta = buildRepoPath(1, 'ana@x.com', '../../user-2-bob/robada.md');
    assert.equal(ruta, 'user-1-ana/user-2-bob/robada.md');
    assert.ok(ruta.startsWith('user-1-ana/'));
  });
});

describe('nombre de una nota creada desde la web', () => {
  it('la mete en la carpeta sincronizada y le pone extensión .md', () => {
    assert.equal(normalizarRutaDeNota('ideas'), 'Drivesidian/ideas.md');
    assert.equal(normalizarRutaDeNota('Drivesidian/ideas.md'), 'Drivesidian/ideas.md');
    assert.equal(normalizarRutaDeNota('proyectos/plan.MD'), 'Drivesidian/proyectos/plan.MD');
  });

  it('rechaza nombres vacíos o que solo son la extensión', () => {
    assert.equal(normalizarRutaDeNota('   '), '');
    assert.equal(normalizarRutaDeNota('.md'), '');
    assert.equal(normalizarRutaDeNota('../..'), '');
  });
});
