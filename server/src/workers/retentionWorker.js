'use strict';

const securityEventsModel = require('../models/securityEvents.model');
const pairingModel = require('../models/pairingCodes.model');

const DEFAULT_RETENTION_DAYS = 90;
const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000; // una vez al día

// Las dos tablas que crecen solas: security_events con cada petición
// interesante, y pairing_codes con cada intento de vinculación. Sin poda llenan
// el disco de la EC2 con el tiempo.
const runRetentionCycle = async () => {
  const days = Number(process.env.SECURITY_EVENT_RETENTION_DAYS) || DEFAULT_RETENTION_DAYS;

  const deleted = await securityEventsModel.deleteOlderThan(days);
  if (deleted > 0) {
    console.log(`[retentionWorker] ${deleted} evento(s) de seguridad con más de ${days} días eliminados`);
  }

  // Los códigos caducados no sirven para nada, pero se dejan un día para poder
  // investigar un intento de vinculación fallido.
  const codes = await pairingModel.deleteExpired();
  if (codes > 0) {
    console.log(`[retentionWorker] ${codes} código(s) de vinculación caducados eliminados`);
  }

  return { events: deleted, pairingCodes: codes };
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
