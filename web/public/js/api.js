'use strict';

// Cliente compartido de la API. Toda la app responde con el mismo sobre
// ({ success, data } o { success, error }), así que se desenvuelve en un solo
// sitio en vez de repetirlo en cada página.

const API = {
  async request(method, path, body) {
    let res;
    try {
      res = await fetch(`/api${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch {
      // Fallo de red: el servidor no respondió nada.
      return { ok: false, status: 0, message: 'No se pudo contactar al servidor.' };
    }

    let payload = null;
    try {
      payload = await res.json();
    } catch {
      /* respuestas sin cuerpo */
    }

    if (res.ok) {
      return { ok: true, status: res.status, data: payload ? payload.data : null };
    }

    return {
      ok: false,
      status: res.status,
      message: payload?.error?.message || `Error ${res.status}.`,
      fields: payload?.error?.fields || null,
      // Solo lo trae el 409 del editor, con ambas versiones de la nota.
      conflict: payload?.conflict || null,
    };
  },

  get(path) { return this.request('GET', path); },
  post(path, body) { return this.request('POST', path, body); },
  put(path, body) { return this.request('PUT', path, body); },
  patch(path, body) { return this.request('PATCH', path, body); },
  del(path) { return this.request('DELETE', path); },
};

// --- Helpers de UI compartidos ---

function mostrarAviso(el, mensaje, tipo = 'error') {
  if (!el) return;
  el.textContent = mensaje;
  el.className = `aviso ${tipo}`;
}

function limpiarAviso(el) {
  if (!el) return;
  el.textContent = '';
  el.className = 'aviso';
}

function fechaLegible(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

async function copiar(texto, boton) {
  try {
    await navigator.clipboard.writeText(texto);
    const original = boton.textContent;
    boton.textContent = 'Copiado';
    setTimeout(() => { boton.textContent = original; }, 1500);
  } catch {
    // clipboard exige contexto seguro (https o localhost); en http plano falla.
    boton.textContent = 'Copia a mano';
  }
}

// El botón de salir vive en la barra de todas las páginas con sesión.
document.addEventListener('DOMContentLoaded', () => {
  const salir = document.getElementById('btn-logout');
  if (!salir) return;
  salir.addEventListener('click', async () => {
    await API.post('/users/logout');
    window.location.href = '/login';
  });
});
