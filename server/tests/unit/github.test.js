'use strict';

require('../helpers/entorno');
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { crearGithubFalso } = require('../helpers/githubFalso');
const { putBatch, readBranchHead, encodeSegments, GitHubError } = require('../../src/utils/github');
const { notify } = require('../../src/utils/ntfy');

const LOTE = [
  { path: 'user-1-ana/Drivesidian/a.md', content: 'A' },
  { path: 'user-1-ana/Drivesidian/b.md', content: 'B' },
];

const usar = (t, opciones) => {
  const gh = crearGithubFalso(opciones);
  t.mock.method(globalThis, 'fetch', gh.fetch);
  return gh;
};

describe('cliente de la Git Data API', () => {
  it('un lote vacío no llama a GitHub', async (t) => {
    const gh = usar(t);
    assert.equal(await putBatch([], 'nada'), null);
    assert.equal(gh.llamadas.length, 0);
  });

  it('sube un lote en UN solo commit con cinco llamadas, lleve las notas que lleve', async (t) => {
    const gh = usar(t);
    const resultado = await putBatch(LOTE, 'Sync: 2 notas');
    assert.deepEqual(resultado, { commitSha: 'commit-nuevo', files: 2 });

    const pasos = gh.aGithub().map((l) => `${l.metodo} ${l.ruta.replace('/repos/duenio/notas', '')}`);
    assert.deepEqual(pasos, [
      'GET /git/ref/heads/main',
      'GET /git/commits/commit-inicial',
      'POST /git/trees',
      'POST /git/commits',
      'PATCH /git/refs/heads/main',
    ]);

    const arbol = gh.aGithub()[2].cuerpo;
    assert.equal(arbol.base_tree, 'arbol-inicial', 'hereda lo que ya existe: no borra nada');
    assert.deepEqual(arbol.tree.map((e) => e.path), LOTE.map((f) => f.path));
    assert.ok(arbol.tree.every((e) => e.mode === '100644' && e.type === 'blob'));
    assert.deepEqual(gh.aGithub()[3].cuerpo.parents, ['commit-inicial']);
  });

  it('se autentica con el token del servidor y manda User-Agent', async (t) => {
    const gh = usar(t);
    await putBatch(LOTE, 'x');
    const cabeceras = gh.aGithub()[0].cabeceras;
    assert.equal(cabeceras.Authorization, 'Bearer token-falso');
    assert.equal(cabeceras['User-Agent'], 'drivesidian-server');
  });

  it('en un repositorio sin commits siembra el primero con la Contents API y sigue', async (t) => {
    const gh = usar(t, { vacio: true });
    const resultado = await putBatch(LOTE, 'primer lote');
    assert.equal(resultado.files, 2);

    const pasos = gh.aGithub().map((l) => `${l.metodo} ${l.ruta.replace('/repos/duenio/notas', '')}`);
    assert.deepEqual(pasos.slice(0, 3), [
      'GET /git/ref/heads/main',
      'PUT /contents/README.md',
      'GET /git/ref/heads/main',
    ]);
    const semilla = gh.aGithub()[1].cuerpo;
    assert.equal(semilla.branch, 'main');
    assert.match(Buffer.from(semilla.content, 'base64').toString('utf8'), /Notas de Drivesidian/);
    assert.equal(gh.aGithub().find((l) => l.ruta.endsWith('/git/trees')).cuerpo.base_tree, 'arbol-semilla');
  });

  it('si otro commit movió la rama (422), relee la punta y reintenta', async (t) => {
    const gh = usar(t, { fallos422: 2 });
    const resultado = await putBatch(LOTE, 'x');
    assert.equal(resultado.commitSha, 'commit-nuevo');
    const lecturas = gh.aGithub().filter((l) => l.ruta.endsWith('/git/ref/heads/main') && l.metodo === 'GET');
    assert.equal(lecturas.length, 3);
  });

  it('se rinde tras tres intentos fallidos en el ref', async (t) => {
    usar(t, { fallos422: 5 });
    await assert.rejects(putBatch(LOTE, 'x'), (err) => err instanceof GitHubError && err.status === 422);
  });

  it('un error distinto de 422 al mover el ref no se reintenta', async (t) => {
    const gh = usar(t, { errorEn: { metodo: 'PATCH', ruta: '/git/refs/heads/', status: 500 } });
    await assert.rejects(putBatch(LOTE, 'x'), (err) => err.status === 500);
    assert.equal(gh.aGithub().filter((l) => l.metodo === 'PATCH').length, 1);
  });

  it('propaga el error si falla crear el árbol', async (t) => {
    usar(t, { errorEn: { metodo: 'POST', ruta: '/git/trees', status: 502 } });
    await assert.rejects(putBatch(LOTE, 'x'), (err) => err instanceof GitHubError && err.status === 502);
  });

  it('propaga el error si falla leer la rama con algo que no es 404 ni 409', async (t) => {
    usar(t, { errorEn: { metodo: 'GET', ruta: '/git/ref/heads/', status: 401 } });
    await assert.rejects(readBranchHead(), (err) => err.status === 401);
  });

  it('una rama inexistente (404) cuenta como "sin punta"', async (t) => {
    usar(t, { errorEn: { metodo: 'GET', ruta: '/git/ref/heads/', status: 404 } });
    assert.equal(await readBranchHead(), null);
  });

  it('usa main si no se configuró rama', async (t) => {
    const original = process.env.GITHUB_BRANCH;
    delete process.env.GITHUB_BRANCH;
    try {
      const gh = usar(t);
      await readBranchHead();
      assert.ok(gh.aGithub()[0].ruta.endsWith('/git/ref/heads/main'));
    } finally {
      process.env.GITHUB_BRANCH = original;
    }
  });

  it('codifica cada segmento de una rama anidada sin romper las barras', () => {
    assert.equal(encodeSegments('feature/mi rama'), 'feature/mi%20rama');
  });
});

describe('cliente de ntfy', () => {
  it('publica en el topic del usuario', async (t) => {
    const gh = usar(t);
    await notify('drivesidian-abc', '3 notas sincronizadas');
    assert.equal(gh.aNtfy()[0].metodo, 'POST');
    assert.equal(gh.aNtfy()[0].ruta, '/drivesidian-abc');
  });

  it('falla si ntfy responde con error', async (t) => {
    usar(t, { ntfyStatus: 500 });
    await assert.rejects(notify('drivesidian-abc', 'x'), /ntfy.sh respondió 500/);
  });
});
