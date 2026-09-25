'use strict';

const { sanitizeVaultPath } = require('./repoPath');
const { SYNCED_FOLDER } = require('../config');

// Normaliza la ruta que escribe un humano en el panel. El agente manda rutas
// que ya existen en su disco; desde la web las inventa alguien tecleando, así
// que hay que encauzarlas: si no, una nota llamada "ideas" acabaría fuera de la
// carpeta sincronizada y el agente nunca la vería.
//
// Pasa primero por sanitizeVaultPath, que descarta los segmentos `..` y
// normaliza las barras invertidas. Sin eso, "../../otro/nota" saldría de la
// carpeta del usuario en el repo compartido.
const normalizarRutaDeNota = (entrada) => {
  let ruta = sanitizeVaultPath(String(entrada || '').trim());
  if (!ruta) return '';

  if (!ruta.toLowerCase().endsWith('.md')) ruta = `${ruta}.md`;
  if (!ruta.startsWith(`${SYNCED_FOLDER}/`)) ruta = `${SYNCED_FOLDER}/${ruta}`;

  // Solo la extensión no es un nombre: "Drivesidian/.md" no vale.
  const nombre = ruta.slice(ruta.lastIndexOf('/') + 1);
  if (nombre === '.md') return '';

  return ruta;
};

module.exports = { normalizarRutaDeNota };
