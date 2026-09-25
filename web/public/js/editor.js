'use strict';

const entrada = document.getElementById('markdown-input');
const preview = document.getElementById('preview');
const aviso = document.getElementById('aviso');
const botonGuardar = document.getElementById('btn-guardar');
const dialogo = document.getElementById('dialogo-conflicto');

// La version con la que se abrió la nota. Se manda en cada guardado para que el
// servidor detecte si alguien más la tocó mientras tanto (compare-and-swap).
let version = null;
let guardado = '';
let conflicto = null;

// --- Preview ---
// Falla CERRADO: si DOMPurify no cargó (cdnjs caído, bloqueador, sin red), no
// se renderiza nada en vez de meter HTML sin limpiar al innerHTML. El contenido
// de una nota es texto que el usuario controla por completo y puede traer
// <script> o un onerror en una imagen.
const sanitizadorListo = () =>
  typeof window.DOMPurify !== 'undefined' && typeof window.marked !== 'undefined';

const render = () => {
  if (!sanitizadorListo()) {
    preview.textContent =
      'No se pudo cargar el sanitizador de HTML, así que la vista previa está desactivada. Tu nota se puede editar y guardar igual.';
    preview.classList.add('preview-degradado');
    return;
  }
  preview.classList.remove('preview-degradado');
  preview.innerHTML = window.DOMPurify.sanitize(window.marked.parse(entrada.value));
};

// --- Carga ---
const cargar = async () => {
  const res = await API.get(`/notes/${window.NOTE_ID}`);

  if (!res.ok) {
    document.getElementById('ruta').textContent = 'Nota no encontrada';
    mostrarAviso(aviso, res.message);
    return;
  }

  const nota = res.data;
  document.getElementById('ruta').textContent = nota.vault_path;
  actualizarMeta(nota);

  version = nota.version;
  guardado = nota.content;
  entrada.value = nota.content;
  entrada.disabled = false;
  botonGuardar.disabled = false;
  render();
};

const actualizarMeta = (nota) => {
  const estado = nota.sync_status === 'synced' ? 'sincronizada' : 'pendiente de subir';
  document.getElementById('meta').textContent =
    `Versión ${nota.version} · ${estado} · ${fechaLegible(nota.updated_at)}`;
};

// --- Guardado ---
const guardar = async (contenido, versionEsperada) => {
  limpiarAviso(aviso);
  botonGuardar.disabled = true;

  const res = await API.put(`/notes/${window.NOTE_ID}`, {
    content: contenido,
    version: versionEsperada,
  });

  botonGuardar.disabled = false;

  if (res.ok) {
    version = res.data.version;
    guardado = res.data.content;
    actualizarMeta(res.data);
    mostrarAviso(aviso, 'Guardada. Se subirá a GitHub en la siguiente sincronización.', 'exito');
    return true;
  }

  if (res.status === 409 && res.conflict) {
    conflicto = res.conflict;
    abrirConflicto();
    return false;
  }

  mostrarAviso(aviso, res.message);
  return false;
};

botonGuardar.addEventListener('click', () => guardar(entrada.value, version));

// --- Conflicto ---
const abrirConflicto = () => {
  document.getElementById('comparacion').hidden = true;
  // textContent, no innerHTML: es contenido de nota sin sanitizar.
  document.getElementById('version-mia').textContent = conflicto.yours.content;
  document.getElementById('version-servidor').textContent = conflicto.server.content;
  dialogo.showModal();
};

document.getElementById('btn-ver-ambas').addEventListener('click', () => {
  document.getElementById('comparacion').hidden = false;
});

// Sobrescribe con lo de esta pestaña, partiendo de la version que hay ahora en
// el servidor para que el compare-and-swap pase.
document.getElementById('btn-quedarme-mia').addEventListener('click', async () => {
  const mio = conflicto.yours.content;
  const versionActual = conflicto.server.version;
  dialogo.close();
  await guardar(mio, versionActual);
});

// Descarta lo local y se queda con lo que ya está guardado.
document.getElementById('btn-quedarme-servidor').addEventListener('click', () => {
  entrada.value = conflicto.server.content;
  version = conflicto.server.version;
  guardado = conflicto.server.content;
  render();
  dialogo.close();
  mostrarAviso(aviso, 'Se cargó la versión del servidor. Tus cambios locales se descartaron.', 'atencion');
});

document.getElementById('btn-cerrar-conflicto').addEventListener('click', () => dialogo.close());

// --- Salvaguardas ---
entrada.addEventListener('input', render);

// Ctrl+S / Cmd+S guarda en vez de abrir el diálogo del navegador.
document.addEventListener('keydown', (evento) => {
  if ((evento.ctrlKey || evento.metaKey) && evento.key === 's') {
    evento.preventDefault();
    if (!botonGuardar.disabled) guardar(entrada.value, version);
  }
});

// La edición desde la web no baja al vault local, así que perder cambios sin
// guardar aquí es perderlos del todo.
window.addEventListener('beforeunload', (evento) => {
  if (entrada.value !== guardado) evento.preventDefault();
});

cargar();
