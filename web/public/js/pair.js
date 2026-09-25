'use strict';

const aviso = document.getElementById('aviso');
const cargando = document.getElementById('cargando');
const detalle = document.getElementById('detalle');
const listo = document.getElementById('listo');
const campoVault = document.getElementById('campo-vault');
const selectVault = document.getElementById('vault');
const vaultUnico = document.getElementById('vault-unico');
const botonAprobar = document.getElementById('btn-aprobar');

const codigo = window.CODIGO;

const cargar = async () => {
  if (!codigo) {
    cargando.hidden = true;
    mostrarAviso(aviso, 'Falta el código de vinculación. Reinicia el agente para que abra esta página de nuevo.');
    return;
  }

  const res = await API.get(`/pairing/${encodeURIComponent(codigo)}`);
  cargando.hidden = true;

  if (!res.ok) {
    mostrarAviso(aviso, res.message);
    return;
  }

  const info = res.data;

  if (info.consumed) {
    mostrarAviso(aviso, 'Este código ya se usó. Si necesitas vincular otro equipo, reinicia su agente.', 'atencion');
    return;
  }
  if (info.approved) {
    mostrarAviso(aviso, 'Este código ya estaba aprobado.', 'atencion');
    return;
  }
  if (info.expired) {
    mostrarAviso(aviso, 'El código caducó. Reinicia el agente para que genere uno nuevo.', 'atencion');
    return;
  }

  document.getElementById('equipo').textContent = info.device_name || 'equipo sin nombre';
  document.getElementById('codigo').textContent = info.code;
  document.getElementById('caduca').textContent = fechaLegible(info.expires_at);

  const vaults = info.vaults || [];
  if (vaults.length > 1) {
    // El servidor rechaza una aprobación sin elegir cuando hay varios, así que
    // aquí no hay opción vacía a propósito.
    for (const vault of vaults) {
      const opcion = document.createElement('option');
      opcion.value = vault.path;
      opcion.textContent = `${vault.name} — ${vault.path}`;
      selectVault.appendChild(opcion);
    }
    campoVault.hidden = false;
  } else if (vaults.length === 1) {
    vaultUnico.textContent = `Vigilará: ${vaults[0].path}`;
    vaultUnico.hidden = false;
  } else {
    vaultUnico.textContent = 'El agente no detectó ningún vault de Obsidian; lo preguntará en el equipo.';
    vaultUnico.hidden = false;
  }

  detalle.hidden = false;
};

botonAprobar.addEventListener('click', async () => {
  limpiarAviso(aviso);
  botonAprobar.disabled = true;

  const cuerpo = { code: codigo };
  if (!campoVault.hidden) cuerpo.selected_vault = selectVault.value;

  const res = await API.post('/pairing/approve', cuerpo);
  botonAprobar.disabled = false;

  if (!res.ok) {
    mostrarAviso(aviso, res.message);
    return;
  }

  detalle.hidden = true;
  listo.hidden = false;
});

cargar();
