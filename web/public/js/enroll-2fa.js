'use strict';

const aviso = document.getElementById('aviso');
const cargando = document.getElementById('cargando');
const bloque = document.getElementById('enrolamiento');
const form = document.getElementById('form-confirmar');
const botonConfirmar = document.getElementById('btn-confirmar');

// El servidor lo pasa como atributo data-* del <body>, no como script en
// línea: así la CSP no necesita 'unsafe-inline' en script-src.
const siguiente = document.body.dataset.siguiente;

// El secreto se genera aquí y NO se guarda todavía: el servidor solo lo
// persiste (cifrado) cuando /2fa/confirm valida un código correcto. Así una
// cuenta nunca queda con 2FA "a medias" si el usuario cierra la pestaña.
let secreto = null;

const iniciar = async () => {
  const res = await API.post('/users/2fa/enroll');
  cargando.hidden = true;

  if (!res.ok) {
    mostrarAviso(aviso, res.message);
    return;
  }

  secreto = res.data.secret;
  document.getElementById('qr').src = res.data.qr_data_url;
  document.getElementById('secreto').textContent = secreto;
  bloque.hidden = false;
  document.getElementById('codigo').focus();
};

document.getElementById('btn-copiar').addEventListener('click', (e) => copiar(secreto, e.target));

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiarAviso(aviso);
  botonConfirmar.disabled = true;

  const codigo = document.getElementById('codigo').value.trim();
  const res = await API.post('/users/2fa/confirm', { secret: secreto, code: codigo });
  botonConfirmar.disabled = false;

  if (!res.ok) {
    document.getElementById('codigo').value = '';
    document.getElementById('codigo').focus();
    mostrarAviso(aviso, res.message);
    return;
  }

  mostrarAviso(aviso, 'Listo, tu cuenta ya pide un segundo factor.', 'exito');
  setTimeout(() => {
    window.location.href = siguiente || '/dashboard';
  }, 900);
});

iniciar();
