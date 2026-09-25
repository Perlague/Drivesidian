'use strict';

const aviso = document.getElementById('aviso');
const tabla = document.getElementById('tabla-tokens');
const interruptor = document.getElementById('notificaciones');
const resultadoSync = document.getElementById('resultado-sync');

let urlNtfy = '';

// --- Perfil, notificaciones y canal de ntfy ---
const cargarPerfil = async () => {
  const res = await API.get('/users/me');
  if (!res.ok) {
    mostrarAviso(aviso, res.message);
    return;
  }

  document.getElementById('correo').textContent = res.data.email;
  interruptor.checked = res.data.notify_enabled;
  urlNtfy = res.data.ntfy_url;
  document.getElementById('ntfy-url').textContent = urlNtfy;

  const qr = document.getElementById('qr-ntfy');
  qr.src = res.data.ntfy_qr;
  qr.hidden = false;
};

interruptor.addEventListener('change', async () => {
  limpiarAviso(aviso);
  const deseado = interruptor.checked;
  interruptor.disabled = true;

  const res = await API.patch('/users/me/notifications', { notify_enabled: deseado });
  interruptor.disabled = false;

  if (!res.ok) {
    interruptor.checked = !deseado; // se revierte: el servidor no lo aceptó
    mostrarAviso(aviso, res.message);
    return;
  }

  mostrarAviso(
    aviso,
    deseado ? 'Recibirás avisos al terminar cada sincronización.' : 'Notificaciones desactivadas.',
    'exito',
  );
});

document.getElementById('btn-copiar-ntfy')
  .addEventListener('click', (e) => copiar(urlNtfy, e.target));

// --- Equipos vinculados ---
const pintarTokens = (tokens) => {
  tabla.innerHTML = '';

  if (tokens.length === 0) {
    tabla.innerHTML = '<tr><td colspan="5" class="vacio">Todavía no hay ningún equipo vinculado.</td></tr>';
    return;
  }

  for (const token of tokens) {
    const fila = document.createElement('tr');
    const revocado = Boolean(token.revoked_at);

    const id = document.createElement('td');
    id.className = 'mono';
    id.textContent = token.id;

    const creado = document.createElement('td');
    creado.textContent = fechaLegible(token.created_at);

    // Un token activo mientras tu equipo está apagado se nota aquí, y es la
    // señal para revocarlo.
    const ultimoUso = document.createElement('td');
    ultimoUso.textContent = token.last_used_at ? fechaLegible(token.last_used_at) : 'nunca';
    if (!token.last_used_at) ultimoUso.className = 'mono';

    const estado = document.createElement('td');
    estado.innerHTML = revocado
      ? `<span class="etiqueta pendiente">Revocado</span>`
      : `<span class="etiqueta sincronizada">Activo</span>`;

    const acciones = document.createElement('td');
    if (!revocado) {
      const boton = document.createElement('button');
      boton.className = 'peligro';
      boton.textContent = 'Revocar';
      boton.addEventListener('click', () => revocar(token.id, boton));
      acciones.appendChild(boton);
    }

    fila.append(id, creado, ultimoUso, estado, acciones);
    tabla.appendChild(fila);
  }
};

const cargarTokens = async () => {
  const res = await API.get('/agent-tokens');
  if (!res.ok) {
    tabla.innerHTML = `<tr><td colspan="5" class="vacio">${res.message}</td></tr>`;
    return;
  }
  pintarTokens(res.data);
};

const revocar = async (id, boton) => {
  // Revocar deja al agente de ese equipo sin acceso, así que se confirma.
  if (!window.confirm('El agente de ese equipo dejará de sincronizar. ¿Revocar su acceso?')) return;

  limpiarAviso(aviso);
  boton.disabled = true;

  const res = await API.del(`/agent-tokens/${id}`);
  if (!res.ok) {
    boton.disabled = false;
    mostrarAviso(aviso, res.message);
    return;
  }

  mostrarAviso(aviso, 'Acceso revocado.', 'exito');
  cargarTokens();
};

document.getElementById('btn-crear-token').addEventListener('click', async (evento) => {
  limpiarAviso(aviso);
  evento.target.disabled = true;

  const res = await API.post('/agent-tokens');
  evento.target.disabled = false;

  if (!res.ok) {
    mostrarAviso(aviso, res.message);
    return;
  }

  // El servidor solo guarda el hash: este es el único momento en que el token
  // completo existe fuera del agente.
  document.getElementById('token-valor').textContent = res.data.token;
  document.getElementById('token-nuevo').hidden = false;
  cargarTokens();
});

document.getElementById('btn-copiar-token').addEventListener('click', (e) => {
  copiar(document.getElementById('token-valor').textContent, e.target);
});

// --- Sincronización bajo demanda ---
document.getElementById('btn-sync').addEventListener('click', async (evento) => {
  limpiarAviso(aviso);
  resultadoSync.textContent = '';
  evento.target.disabled = true;
  evento.target.textContent = 'Sincronizando…';

  const res = await API.post('/notes/sync-now');
  evento.target.disabled = false;
  evento.target.textContent = 'Sincronizar ahora';

  if (!res.ok) {
    // El 409 es el candado global: otro lote está commiteando contra el repo.
    mostrarAviso(aviso, res.message, res.status === 409 ? 'atencion' : 'error');
    return;
  }

  resultadoSync.textContent = res.data.synced > 0
    ? `${res.data.synced} nota(s) subidas a GitHub.`
    : 'No había nada pendiente.';
});

cargarPerfil();
cargarTokens();
