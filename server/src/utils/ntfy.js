'use strict';

// Cliente mínimo de ntfy.sh — se dispara solo cuando un lote se sincronizó
// con éxito, nunca por cada guardado individual (ver worker de sync).
//
// El topic va como parámetro y no se lee de una variable de entorno: cada
// usuario tiene el suyo, derivado en src/utils/ntfyTopic.js. Un topic global
// haría que todos recibieran las notificaciones de todos.
const notify = async (topic, message) => {
  const response = await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, {
    method: 'POST',
    body: message,
  });

  if (!response.ok) {
    throw new Error(`ntfy.sh respondió ${response.status}`);
  }
};

module.exports = { notify };
