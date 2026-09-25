'use strict';

const form = document.getElementById('form-registro');
const aviso = document.getElementById('aviso');
const boton = document.getElementById('btn-crear');

// El servidor lo pasa como atributo data-* del <body>, no como script en
// línea: así la CSP no necesita 'unsafe-inline' en script-src.
const siguiente = document.body.dataset.siguiente;

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiarAviso(aviso);
  boton.disabled = true;

  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;

  const creado = await API.post('/users/register', { email, password });
  if (!creado.ok) {
    boton.disabled = false;
    // Los errores de zod vienen por campo; se muestra el primero, que es el
    // que el usuario tiene que corregir.
    const detalle = creado.fields ? Object.values(creado.fields)[0] : creado.message;
    mostrarAviso(aviso, detalle);
    return;
  }

  // Se entra de una vez para que el usuario no teclee sus datos dos veces.
  const sesion = await API.post('/users/login', { email, password });
  boton.disabled = false;

  if (!sesion.ok) {
    mostrarAviso(aviso, 'Cuenta creada, pero no se pudo iniciar sesión. Entra manualmente.', 'atencion');
    setTimeout(() => { window.location.href = '/login'; }, 2000);
    return;
  }

  // Recién registrado nadie tiene 2FA: el siguiente paso es enrolarlo, y de
  // ahí se continúa a donde el usuario iba (p. ej. la vinculación del agente).
  const query = siguiente ? `?next=${encodeURIComponent(siguiente)}` : '';
  window.location.href = `/2fa${query}`;
});
