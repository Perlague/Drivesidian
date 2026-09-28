'use strict';

require('../helpers/entorno');
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { iniciar, detener, pedir, cookieDeSesion } = require('../helpers/servidor');
const { limpiarBase, cerrarBase, crearUsuario, pool } = require('../helpers/datos');

let usuario;
let admin;

before(async () => {
  await limpiarBase();
  await iniciar();
  usuario = await crearUsuario();
  admin = await crearUsuario({ role: 'admin' });
});
after(async () => {
  await detener();
  await cerrarBase();
});

describe('páginas del panel', () => {
  it('la raíz manda al login sin sesión y a las notas con ella', async () => {
    assert.equal((await pedir('GET', '/')).headers.get('location'), '/login');
    assert.equal((await pedir('GET', '/', { cookie: cookieDeSesion(usuario) })).headers.get('location'), '/notes');
  });

  it('login y registro se muestran sin sesión y redirigen con ella', async () => {
    for (const ruta of ['/login', '/register']) {
      const res = await pedir('GET', ruta);
      assert.equal(res.status, 200);
      assert.match(res.headers.get('content-type'), /text\/html/);
      assert.equal((await pedir('GET', ruta, { cookie: cookieDeSesion(usuario) })).status, 302);
    }
  });

  it('las páginas privadas mandan al login recordando el destino', async () => {
    const res = await pedir('GET', '/pair?code=ABCD-EFGH');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/login?next=%2Fpair%3Fcode%3DABCD-EFGH');
  });

  it('con sesión, todas las páginas privadas cargan', async () => {
    const cookie = cookieDeSesion(usuario);
    for (const ruta of ['/notes', '/notes/5', '/dashboard', '/2fa', '/pair?code=ABCD-EFGH']) {
      assert.equal((await pedir('GET', ruta, { cookie })).status, 200, ruta);
    }
  });

  it('ninguna página lleva scripts ni estilos en línea (la CSP no los permitiría)', async () => {
    const cookie = cookieDeSesion(admin);
    for (const ruta of ['/login', '/register', '/notes', '/notes/5', '/dashboard', '/2fa', '/pair', '/admin']) {
      const { texto } = await pedir('GET', ruta, { cookie: ruta === '/login' || ruta === '/register' ? undefined : cookie });
      assert.doesNotMatch(texto, /<script>|<script\s+(?![^>]*\bsrc=)/i, `${ruta}: script en línea`);
      assert.doesNotMatch(texto, /\sstyle="/i, `${ruta}: estilo en línea`);
    }
  });

  it('la administración solo abre para el rol admin', async () => {
    assert.equal((await pedir('GET', '/admin', { cookie: cookieDeSesion(admin) })).status, 200);
    const res = await pedir('GET', '/admin', { cookie: cookieDeSesion(usuario) });
    assert.equal(res.headers.get('location'), '/notes');
  });

  it('cada respuesta lleva la política de seguridad de contenido', async () => {
    const res = await pedir('GET', '/login');
    assert.match(res.headers.get('content-security-policy'), /default-src 'none'/);
    assert.equal(res.headers.get('x-powered-by'), null);
  });

  it('sirve los archivos estáticos y las librerías locales', async () => {
    assert.equal((await pedir('GET', '/css/app.css')).status, 200);
    assert.equal((await pedir('GET', '/vendor/purify.min.js')).status, 200);
  });
});

describe('errores', () => {
  it('health responde', async () => {
    assert.deepEqual((await pedir('GET', '/health')).body, { success: true, data: { status: 'ok' } });
  });

  it('una ruta de API desconocida responde JSON y una página desconocida, HTML', async () => {
    const api = await pedir('GET', '/api/no-existe');
    assert.equal(api.status, 404);
    assert.equal(api.body.success, false);
    const pagina = await pedir('GET', '/no-existe', { headers: { accept: 'text/html' } });
    assert.equal(pagina.status, 404);
    assert.match(pagina.texto, /<html/i);
  });

  it('un cuerpo de más de 1200 kb se rechaza con 413 en JSON, sin la página de Express', async () => {
    const res = await pedir('POST', '/api/users/register', {
      crudo: JSON.stringify({ email: 'x@y.com', password: 'a'.repeat(1_300_000) }),
      headers: { 'content-type': 'application/json' },
    });
    assert.equal(res.status, 413);
    assert.match(res.body.error.message, /1200kb/);
    assert.doesNotMatch(res.texto, /node_modules|at [A-Za-z]+ \(/);
  });

  it('un JSON mal formado responde 400', async () => {
    const res = await pedir('POST', '/api/users/register', { crudo: '{roto', headers: { 'content-type': 'application/json' } });
    assert.equal(res.status, 400);
    assert.match(res.body.error.message, /JSON válido/);
  });

  it('si la base de datos falla, responde 500 genérico sin filtrar detalles internos', async (t) => {
    t.mock.method(pool, 'query', async () => {
      throw new Error('conexión perdida con 10.0.0.5:5432');
    });
    const res = await pedir('GET', '/api/notes', { cookie: cookieDeSesion(usuario) });
    assert.equal(res.status, 500);
    assert.equal(res.body.error.message, 'Error interno del servidor.');
    assert.doesNotMatch(res.texto, /10\.0\.0\.5|stack|conexión perdida/);
  });
});
