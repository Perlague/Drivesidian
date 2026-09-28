'use strict';

// Simula la Git Data API de GitHub, la Contents API y ntfy.sh sustituyendo a
// fetch. Registra cada llamada y deja programar el escenario: repositorio con
// historia o vacío, carreras en el ref, fallos de red, o una edición que llega
// justo mientras se sube el lote.

const respuesta = (status, cuerpo) =>
  new Response(typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const crearGithubFalso = ({
  vacio = false,
  fallos422 = 0,
  errorEn = null,
  alSubirArbol = null,
  ntfyStatus = 200,
} = {}) => {
  const llamadas = [];
  let punta = vacio ? null : { commit: 'commit-inicial', arbol: 'arbol-inicial' };
  let pendientes422 = fallos422;

  const fetch = async (url, opciones = {}) => {
    const metodo = opciones.method || 'GET';
    const u = new URL(url);
    let cuerpo = null;
    if (typeof opciones.body === 'string') {
      try {
        cuerpo = JSON.parse(opciones.body);
      } catch {
        cuerpo = opciones.body;
      }
    }
    llamadas.push({ metodo, host: u.host, ruta: u.pathname, cuerpo, cabeceras: opciones.headers || {} });

    if (u.host === 'ntfy.sh') return respuesta(ntfyStatus, '');

    const ruta = u.pathname.replace('/repos/duenio/notas', '');

    if (errorEn && metodo === errorEn.metodo && ruta.startsWith(errorEn.ruta)) {
      return respuesta(errorEn.status, { message: 'fallo simulado' });
    }

    // Un repositorio sin commits rechaza TODA la Git Data API con 409.
    if (!punta && ruta.startsWith('/git/')) {
      return respuesta(409, { message: 'Git Repository is empty.' });
    }

    if (metodo === 'GET' && ruta.startsWith('/git/ref/heads/')) {
      return respuesta(200, { object: { sha: punta.commit } });
    }
    if (metodo === 'GET' && ruta.startsWith('/git/commits/')) {
      return respuesta(200, { tree: { sha: punta.arbol } });
    }
    if (metodo === 'PUT' && ruta.startsWith('/contents/')) {
      punta = { commit: 'commit-semilla', arbol: 'arbol-semilla' };
      return respuesta(201, { commit: { sha: punta.commit } });
    }
    if (metodo === 'POST' && ruta === '/git/trees') {
      if (alSubirArbol) await alSubirArbol();
      return respuesta(201, { sha: 'arbol-nuevo' });
    }
    if (metodo === 'POST' && ruta === '/git/commits') {
      return respuesta(201, { sha: 'commit-nuevo' });
    }
    if (metodo === 'PATCH' && ruta.startsWith('/git/refs/heads/')) {
      if (pendientes422 > 0) {
        pendientes422 -= 1;
        return respuesta(422, { message: 'Update is not a fast forward' });
      }
      punta = { commit: 'commit-nuevo', arbol: 'arbol-nuevo' };
      return respuesta(200, { object: { sha: punta.commit } });
    }
    if (metodo === 'POST' && ruta === '/git/refs') {
      punta = { commit: 'commit-nuevo', arbol: 'arbol-nuevo' };
      return respuesta(201, { object: { sha: punta.commit } });
    }
    return respuesta(404, { message: `No simulado: ${metodo} ${ruta}` });
  };

  const aGithub = () => llamadas.filter((l) => l.host === 'api.github.com');
  const aNtfy = () => llamadas.filter((l) => l.host === 'ntfy.sh');

  return { fetch, llamadas, aGithub, aNtfy };
};

module.exports = { crearGithubFalso, respuesta };
