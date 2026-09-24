'use strict';

const securityEventsModel = require('../models/securityEvents.model');

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // una vez al día

// security_events crece con cada petición interesante, así que sin poda llena
// el disco de la EC2 con el tiempo.
const runRetentionCycle = async () => {
  const days = Number(process.env.SECURITY_EVENT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;
  const deleted = await securityEventsModel.deleteOlderThan(days);
  if (deleted > 0) {
    console.log(`[retentionWorker] ${deleted} evento(s) de seguridad con más de ${days} días eliminados`);
  }
  return deleted;
};

const startRetentionWorker = () => {
  const intervalMs = Number(process.env.RETENTION_INTERVAL_MS) || DEFAULT_INTERVAL_MS;

  // Se corre también al arrancar: un servidor que se reinicia más seguido que
  // el intervalo nunca llegaría a podar si solo dependiera del setInterval.
  const cycle = () =>
    runRetentionCycle().catch((err) =>
      console.error('[retentionWorker] error en el ciclo:', err.message),
    );

  cycle();
  setInterval(cycle, intervalMs);
  console.log(`[retentionWorker] poda de eventos de seguridad iniciada (cada ${intervalMs}ms)`);
};

module.exports = { startRetentionWorker, runRetentionCycle };
