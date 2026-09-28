'use strict';

const aviso = document.getElementById('aviso');
const tabla = document.getElementById('tabla-notas');
const resumen = document.getElementById('resumen');
const dialogo = document.getElementById('dialogo-nueva');
const avisoNueva = document.getElementById('aviso-nueva');
const inputNombre = document.getElementById('nombre');
const paginacion = document.getElementById('paginacion');
const textoPagina = document.getElementById('texto-pagina');
const btnAnterior = document.getElementById('btn-anterior');
const btnSiguiente = document.getElementById('btn-siguiente');

const ESTADOS = {
  pending: { texto: 'Pendiente', clase: 'pendiente' },
  synced: { texto: 'Sincronizada', clase: 'sincronizada' },
};

// La página vive en la URL (?pagina=2): recargar o volver del editor con el
// botón de atrás deja al usuario donde estaba, no en la primera.
const paginaDeLaUrl = () => {
  const valor = Number(new URLSearchParams(window.location.search).get('pagina'));
  return Number.isInteger(valor) && valor > 0 ? valor : 1;
};
let pagina = paginaDeLaUrl();

const pintarResumen = ({ total, pending, conflicts }) => {
  // El conflicto manda en el resumen: es lo único que necesita una decisión.
  // Los conteos vienen del servidor y cubren todas las notas, no solo esta página.
  if (conflicts > 0) {
    resumen.innerHTML = `<strong>${conflicts} nota(s) necesitan que elijas una versión.</strong>`;
  } else {
    resumen.textContent = pending > 0
      ? `${total} nota(s), ${pending} pendiente(s) de subir a GitHub.`
      : `${total} nota(s), todas sincronizadas.`;
  }
};

const pintarPaginacion = ({ page, pages }) => {
  paginacion.hidden = pages <= 1;
  textoPagina.textContent = `Página ${page} de ${pages}`;
  btnAnterior.disabled = page <= 1;
  btnSiguiente.disabled = page >= pages;
};

const pintar = (datos) => {
  const notas = datos.notes;
  tabla.innerHTML = '';

  if (datos.total === 0) {
    tabla.innerHTML = `
      <tr><td colspan="4" class="vacio">
        Todavía no hay notas.<br />
        Crea una aquí, o instala el agente y guarda un archivo dentro de la
        carpeta <code>Drivesidian/</code> de tu vault.
      </td></tr>`;
    resumen.textContent = 'Las notas llegan solas desde el agente instalado en tu equipo.';
    paginacion.hidden = true;
    return;
  }

  pintarResumen(datos);
  pintarPaginacion(datos);

  for (const nota of notas) {
    const fila = document.createElement('tr');

    const ruta = document.createElement('td');
    const enlace = document.createElement('a');
    enlace.href = `/notes/${nota.id}`;
    // textContent y no innerHTML: vault_path lo controla el agente, o sea el
    // disco del usuario, y un nombre de archivo puede traer < o >.
    enlace.textContent = nota.vault_path;
    ruta.appendChild(enlace);

    const estado = document.createElement('td');
    const etiqueta = document.createElement('span');
    if (nota.in_conflict) {
      etiqueta.className = 'etiqueta conflicto';
      etiqueta.textContent = 'En conflicto';
    } else {
      const info = ESTADOS[nota.sync_status] || { texto: nota.sync_status, clase: '' };
      etiqueta.className = `etiqueta ${info.clase}`;
      etiqueta.textContent = info.texto;
    }
    estado.appendChild(etiqueta);

    const version = document.createElement('td');
    version.className = 'mono';
    version.textContent = `v${nota.version}`;

    const fecha = document.createElement('td');
    fecha.textContent = fechaLegible(nota.updated_at);

    fila.append(ruta, estado, version, fecha);
    tabla.appendChild(fila);
  }
};

const cargar = async () => {
  const res = await API.get(`/notes?page=${pagina}`);
  if (!res.ok) {
    tabla.innerHTML = '';
    mostrarAviso(aviso, res.message);
    return;
  }

  // Una página que ya no existe (un enlace viejo, ?pagina=99): se salta a la
  // última en vez de mostrar una tabla vacía con notas que sí existen.
  if (res.data.notes.length === 0 && res.data.total > 0 && pagina > res.data.pages) {
    irA(res.data.pages);
    return;
  }

  pintar(res.data);
};

const irA = (nueva) => {
  pagina = nueva;
  const url = new URL(window.location.href);
  if (pagina === 1) url.searchParams.delete('pagina');
  else url.searchParams.set('pagina', String(pagina));
  // replaceState y no pushState: pasar de página no debe llenar el historial,
  // así "atrás" sigue llevando a la pantalla anterior.
  window.history.replaceState(null, '', url);
  cargar();
};

btnAnterior.addEventListener('click', () => irA(pagina - 1));
btnSiguiente.addEventListener('click', () => irA(pagina + 1));

// --- Nueva nota ---
document.getElementById('btn-nueva').addEventListener('click', () => {
  limpiarAviso(avisoNueva);
  inputNombre.value = '';
  dialogo.showModal();
  inputNombre.focus();
});

document.getElementById('btn-cancelar-nueva').addEventListener('click', () => dialogo.close());

document.getElementById('form-nueva').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  limpiarAviso(avisoNueva);

  const boton = document.getElementById('btn-crear');
  boton.disabled = true;

  const res = await API.post('/notes', { vault_path: inputNombre.value.trim(), content: '' });
  boton.disabled = false;

  if (!res.ok) {
    const detalle = res.fields ? Object.values(res.fields)[0] : res.message;
    mostrarAviso(avisoNueva, detalle);
    return;
  }

  // Se abre en el editor: crear una nota vacía y quedarse mirando la lista no
  // le sirve a nadie.
  window.location.href = `/notes/${res.data.id}`;
});

cargar();
