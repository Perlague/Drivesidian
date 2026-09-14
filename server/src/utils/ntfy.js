'use strict';

// Cliente mínimo de ntfy.sh — se dispara solo cuando un lote se sincronizó
// con éxito, nunca por cada guardado individual (ver worker de sync).
const notify = async (message) => {
  const topic = process.env.NTFY_TOPIC;
  const response = await fetch(`https://ntfy.sh/${topic}`, {
    method: 'POST',
    body: message,
  });

  if (!response.ok) {
    throw new Error(`ntfy.sh respondió ${response.status}`);
  }
};

module.exports = { notify };
