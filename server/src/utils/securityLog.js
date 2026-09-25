'use strict';

const securityEventsModel = require('../models/securityEvents.model');

// Módulo único por el que pasa todo lo relevante para seguridad.
//
// El reparto de responsabilidades es deliberado: **la app emite, Guardian
// ejecuta.** Aquí no se bloquea ninguna IP ni se toca el firewall. La
// aplicación solo aplica lo que necesita contexto de aplicación (el bloqueo
// por intentos de TOTP, los límites por token); cortar una IP o un rango es de
// Guardian vía ufw. Un bug en Express no debe poder dejar a nadie fuera del
// servidor.
//
// Cada evento se escribe a dos destinos:
//   1. stdout, una línea de JSON — Docker la recoge y Guardian la sigue en
//      vivo con `docker logs`. El campo `log` es el marcador para grepear sin
//      romper el parseo, porque la línea completa sigue siendo JSON válido.
//   2. la tabla security_events, para consultarla desde el panel de admin.

const LOG_CHANNEL = 'drivesidian.security';

const SEVERITY = {
  INFO: 'info',
  WARN: 'warn',
  CRITICAL: 'critical',
};

// Catálogo cerrado: evita que el mismo evento se escriba de tres formas
// distintas y que Guardian tenga que adivinar variantes.
const EVENTS = {
  AUTH_REGISTER: 'auth.register',
  AUTH_LOGIN_SUCCESS: 'auth.login.success',
  AUTH_LOGIN_FAILED_PASSWORD: 'auth.login.failed_password',
  AUTH_LOGIN_FAILED_TOTP: 'auth.login.failed_totp',
  AUTH_LOGIN_BLOCKED: 'auth.login.blocked',
  AUTH_LOCKOUT: 'auth.lockout',
  AUTH_LOGOUT: 'auth.logout',
  TWOFA_ENROLLED: '2fa.enrolled',
  TOKEN_CREATED: 'token.created',
  TOKEN_REVOKED: 'token.revoked',
  TOKEN_USED_AFTER_REVOKE: 'token.used_after_revoke',
  RATELIMIT_EXCEEDED: 'ratelimit.exceeded',
  QUOTA_EXCEEDED: 'quota.exceeded',
  // Alguien pidió una tanda grande de notas de golpe. Un agente al día pide
  // unas pocas; esto es el patrón de quien se lleva todo.
  NOTES_BULK_READ: 'notes.bulk_read',
  PAIRING_REQUESTED: 'pairing.requested',
  PAIRING_APPROVED: 'pairing.approved',
  PAIRING_CONSUMED: 'pairing.consumed',
  PAIRING_EXPIRED: 'pairing.expired',
  // Intento de canjear un código con el verifier equivocado: alguien vio el
  // código pero no tiene el secreto del agente. Tipo propio y no un
  // pairing.consumed con un flag, para que el feed no diga "canjeado" cuando
  // en realidad se rechazó.
  PAIRING_REJECTED: 'pairing.rejected',
  // Una sesión sin el rol necesario tocando algo de admin. No consigue nada
  // —el middleware corta antes del controller— pero es de las señales más
  // limpias que da el feed: una cuenta normal no llega ahí sola.
  AUTHZ_DENIED: 'authz.denied',
};

// req.ip solo es la IP real del cliente si Express confía en el proxy que
// tiene delante (ver TRUST_PROXY en index.js). Detrás de Caddy sin esa
// configuración, todos los eventos llegarían con la IP del contenedor, que es
// exactamente el dato que Guardian necesita y no tendría.
const contextFromRequest = (req) => ({
  ip: req?.ip || null,
  userAgent: req?.headers?.['user-agent'] || null,
});

// Nunca lanza y nunca hace esperar a quien la llama: auditar un fallo no debe
// poder tumbar la petición que se está auditando. Devuelve la promesa solo
// para que las pruebas puedan esperarla; los call sites la ignoran.
const logSecurityEvent = ({
  type,
  severity = SEVERITY.INFO,
  userId = null,
  req = null,
  details = {},
}) => {
  const { ip, userAgent } = contextFromRequest(req);
  const event = {
    log: LOG_CHANNEL,
    occurred_at: new Date().toISOString(),
    type,
    severity,
    user_id: userId === undefined ? null : userId,
    ip,
    user_agent: userAgent,
    details,
  };

  try {
    console.log(JSON.stringify(event));
  } catch (err) {
    console.error('[securityLog] no se pudo serializar el evento:', err.message);
  }

  return securityEventsModel
    .create({ type, severity, userId: event.user_id, ip, userAgent, details })
    .catch((err) => {
      console.error(`[securityLog] no se pudo persistir "${type}":`, err.message);
      return null;
    });
};

// Variante que emite como mucho un evento por ventana y por clave.
//
// Es la misma regla que aplica el rate limiting y la razón es la misma:
// Guardian lee este feed y cada línea le cuesta tokens. Un abuso sostenido
// tiene que producir una línea con el conteo dentro, no una por petición.
//
// Se expone aquí en vez de repetir un Map en cada sitio que lo necesite.
const VENTANAS_PRUNE_MS = 10 * 60 * 1000;
const ultimaEmision = new Map();

setInterval(() => {
  const ahora = Date.now();
  for (const [clave, cuando] of ultimaEmision) {
    // Una hora de gracia sobre la ventana más larga que se use.
    if (ahora - cuando > 2 * 60 * 60 * 1000) ultimaEmision.delete(clave);
  }
}, VENTANAS_PRUNE_MS).unref();

const logSecurityEventOncePerWindow = ({ key, windowMs, ...evento }) => {
  const ahora = Date.now();
  const anterior = ultimaEmision.get(key) || 0;
  if (ahora - anterior < windowMs) return null;

  ultimaEmision.set(key, ahora);
  return logSecurityEvent(evento);
};

module.exports = {
  logSecurityEvent,
  logSecurityEventOncePerWindow,
  SEVERITY,
  EVENTS,
  LOG_CHANNEL,
};
