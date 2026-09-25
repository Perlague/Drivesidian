'use strict';

const form = document.getElementById('form-login');
const aviso = document.getElementById('aviso');
const campoTotp = document.getElementById('campo-totp');
const inputTotp = document.getElementById('totp');
const boton = document.getElementById('btn-entrar');

form.addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiarAviso(aviso);
  boton.disabled = true;

  const cuerpo = {
    email: document.getElementById('email').value.trim(),
    password: document.getElementById('password').value,
  };
  const codigo = inputTotp.value.trim();
  if (codigo) cuerpo.totp_code = codigo;

  const res = await API.post('/users/login', cuerpo);
  boton.disabled = false;

  if (res.ok) {
    window.location.href = window.SIGUIENTE || '/notes';
    return;
  }

  // El servidor pide el segundo factor con un 400 sin errores de campo. Un 400
  // CON `fields` es una validación del body y no tiene que ver con el 2FA.
  if (res.status === 400 && !res.fields) {
    campoTotp.hidden = false;
    inputTotp.focus();
    mostrarAviso(aviso, res.message, 'atencion');
    return;
  }

  // Si el campo ya estaba visible, un 401 significa código incorrecto: se
  // limpia para que el usuario teclee el siguiente sin borrar a mano.
  if (res.status === 401 && !campoTotp.hidden) {
    inputTotp.value = '';
    inputTotp.focus();
  }

  // El 403 es la cuenta bloqueada por intentos fallidos: no es un error del
  // usuario al teclear, así que se muestra como advertencia.
  mostrarAviso(aviso, res.message, res.status === 403 ? 'atencion' : 'error');
});
