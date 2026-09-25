'use strict';

const aviso = document.getElementById('aviso');
const tabla = document.getElementById('tabla-notas');
const resumen = document.getElementById('resumen');

const ESTADOS = {
  pending: { texto: 'Pendiente', clase: 'pendiente' },
  synced: { texto: 'Sincronizada', clase: 'sincronizada' },
};

const pintar = (notas) => {
  tabla.innerHTML = '';

  if (notas.length === 0) {
    tabla.innerHTML = `
      <tr><td colspan="4" class="vacio">
        Todavía no hay notas.<br />
        Instala el agente y guarda un archivo dentro de la carpeta
        <code>Drivesidian/</code> de tu vault.
      </td></tr>`;
    resumen.textContent = 'Las notas llegan solas desde el agente instalado en tu equipo.';
    return;
  }

  const pendientes = notas.filter((n) => n.sync_status === 'pending').length;
  resumen.textContent = pendientes > 0
    ? `${notas.length} nota(s), ${pendientes} pendiente(s) de subir a GitHub.`
    : `${notas.length} nota(s), todas sincronizadas.`;

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
    const info = ESTADOS[nota.sync_status] || { texto: nota.sync_status, clase: '' };
    const etiqueta = document.createElement('span');
    etiqueta.className = `etiqueta ${info.clase}`;
    etiqueta.textContent = info.texto;
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
  const res = await API.get('/notes');
  if (!res.ok) {
    tabla.innerHTML = '';
    mostrarAviso(aviso, res.message);
    return;
  }
  pintar(res.data);
};

cargar();
