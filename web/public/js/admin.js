'use strict';

const aviso = document.getElementById('aviso');
const tablaEventos = document.getElementById('tabla-eventos');
const tablaUsuarios = document.getElementById('tabla-usuarios');
const botonMas = document.getElementById('btn-mas');

const filtroSeveridad = document.getElementById('filtro-severidad');
const filtroTipo = document.getElementById('filtro-tipo');
const filtroDesde = document.getElementById('filtro-desde');

const POR_PAGINA = 50;
let offset = 0;

// --- Eventos ---

const construirQuery = () => {
  const params = new URLSearchParams({ limit: String(POR_PAGINA), offset: String(offset) });
  if (filtroSeveridad.value) params.set('severity', filtroSeveridad.value);
  if (filtroTipo.value) params.set('type', filtroTipo.value);

  if (filtroDesde.value) {
    const horas = Number(filtroDesde.value);
    params.set('since', new Date(Date.now() - horas * 3600 * 1000).toISOString());
  }

  return params.toString();
};

const filaDeEvento = (evento) => {
  const fila = document.createElement('tr');
  // Las críticas son las que piden una reacción, así que la fila entera se
  // distingue: buscarlas leyendo una columna sería perder el tiempo.
  if (evento.severity === 'critical') fila.className = 'fila-critica';

  const cuando = document.createElement('td');
  cuando.className = 'mono nowrap';
  cuando.textContent = fechaLegible(evento.occurred_at);

  const severidad = document.createElement('td');
  const etiqueta = document.createElement('span');
  etiqueta.className = `etiqueta sev-${evento.severity}`;
  etiqueta.textContent = evento.severity;
  severidad.appendChild(etiqueta);

  const tipo = document.createElement('td');
  tipo.className = 'mono';
  tipo.textContent = evento.type;

  const usuario = document.createElement('td');
  usuario.className = 'mono';
  // null es significativo: un login con un correo inexistente no tiene a quién
  // atribuirse, y es justo de los eventos que más importan.
  usuario.textContent = evento.user_id ?? '—';

  const ip = document.createElement('td');
  ip.className = 'mono';
  ip.textContent = evento.ip || '—';

  const detalles = document.createElement('td');
  detalles.className = 'mono detalles';
  // textContent: los detalles incluyen datos que vienen de fuera, como el
  // correo que alguien tecleó en un login fallido.
  detalles.textContent = Object.keys(evento.details || {}).length
    ? JSON.stringify(evento.details)
    : '';

  fila.append(cuando, severidad, tipo, usuario, ip, detalles);
  return fila;
};

const cargarEventos = async ({ reiniciar = false } = {}) => {
  if (reiniciar) {
    offset = 0;
    tablaEventos.innerHTML = '<tr><td colspan="6" class="cargando">Cargando…</td></tr>';
  }

  const res = await API.get(`/admin/security-events?${construirQuery()}`);

  if (!res.ok) {
    tablaEventos.innerHTML = '';
    mostrarAviso(aviso, res.message);
    return;
  }

  if (reiniciar) tablaEventos.innerHTML = '';

  if (res.data.length === 0 && offset === 0) {
    tablaEventos.innerHTML = '<tr><td colspan="6" class="vacio">Sin eventos para esos filtros.</td></tr>';
    botonMas.hidden = true;
    return;
  }

  for (const evento of res.data) tablaEventos.appendChild(filaDeEvento(evento));

  offset += res.data.length;
  // Si vino una página completa, probablemente hay más.
  botonMas.hidden = res.data.length < POR_PAGINA;
};

const cargarTipos = async () => {
  const res = await API.get('/admin/event-types');
  if (!res.ok) return;

  for (const tipo of res.data) {
    const opcion = document.createElement('option');
    opcion.value = tipo;
    opcion.textContent = tipo;
    filtroTipo.appendChild(opcion);
  }
};

for (const filtro of [filtroSeveridad, filtroTipo, filtroDesde]) {
  filtro.addEventListener('change', () => cargarEventos({ reiniciar: true }));
}
botonMas.addEventListener('click', () => cargarEventos());

// --- Usuarios ---

const cargarUsuarios = async () => {
  const res = await API.get('/admin/users');

  if (!res.ok) {
    tablaUsuarios.innerHTML = `<tr><td colspan="6" class="vacio">${res.message}</td></tr>`;
    return;
  }

  tablaUsuarios.innerHTML = '';

  for (const usuario of res.data) {
    const fila = document.createElement('tr');

    const id = document.createElement('td');
    id.className = 'mono';
    id.textContent = usuario.id;

    const correo = document.createElement('td');
    correo.textContent = usuario.email;

    const rol = document.createElement('td');
    rol.textContent = usuario.role;

    const dosFactores = document.createElement('td');
    const etiquetaFa = document.createElement('span');
    etiquetaFa.className = `etiqueta ${usuario.twofa_enabled ? 'sincronizada' : 'pendiente'}`;
    etiquetaFa.textContent = usuario.twofa_enabled ? 'Activo' : 'Sin 2FA';
    dosFactores.appendChild(etiquetaFa);

    const estado = document.createElement('td');
    const bloqueado = usuario.locked_until && new Date(usuario.locked_until) > new Date();
    if (bloqueado) {
      const etiquetaBloqueo = document.createElement('span');
      etiquetaBloqueo.className = 'etiqueta conflicto';
      etiquetaBloqueo.textContent = `Bloqueada hasta ${fechaLegible(usuario.locked_until)}`;
      estado.appendChild(etiquetaBloqueo);
    } else if (usuario.failed_2fa_attempts > 0) {
      estado.textContent = `${usuario.failed_2fa_attempts} fallo(s) de 2FA`;
    } else {
      estado.textContent = '—';
    }

    const alta = document.createElement('td');
    alta.className = 'nowrap';
    alta.textContent = fechaLegible(usuario.created_at);

    fila.append(id, correo, rol, dosFactores, estado, alta);
    tablaUsuarios.appendChild(fila);
  }
};

cargarTipos().then(() => cargarEventos({ reiniciar: true }));
cargarUsuarios();
