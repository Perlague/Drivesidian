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
  PAIRING_REQUESTED: 'pairing.requested',
  PAIRING_APPROVED: 'pairing.approved',
  PAIRING_CONSUMED: 'pairing.consumed',
  PAIRING_EXPIRED: 'pairing.expired',
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

module.exports = { logSecurityEvent, SEVERITY, EVENTS, LOG_CHANNEL };
