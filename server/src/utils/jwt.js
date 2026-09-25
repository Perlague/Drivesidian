'use strict';

const crypto = require('crypto');

const base64url = (input) => Buffer.from(input).toString('base64url');

// JWT propio (HS256) sin librerías externas, firmado/verificado con crypto nativo.
// Se usa tanto para la sesión web (corta duración) como para los agent tokens
// (larga duración) — ambos comparten este mismo mecanismo, diferenciados por
// el claim `type` en el payload.
// expiresInSeconds es opcional: sin él el token se emite SIN claim `exp`.
// Los agent tokens se emiten así a propósito — su única caducidad es la
// revocación desde el panel, que es lo que hace útil la tabla agent_tokens.
// Un token con vida fija obligaría al usuario final, que no es programador, a
// re-vincular su equipo cada cierto tiempo sin entender por qué.
const sign = (payload, secret, expiresInSeconds = null) => {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = { ...payload, iat: now };
  if (expiresInSeconds !== null) fullPayload.exp = now + expiresInSeconds;

  const headerPart = base64url(JSON.stringify(header));
  const payloadPart = base64url(JSON.stringify(fullPayload));
  const signature = crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');

  return `${headerPart}.${payloadPart}.${signature}`;
};

const verify = (token, secret) => {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signature] = parts;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest('base64url');

  const sigBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expectedSignature);
  if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
    return null;
  }

  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload.exp === 'number' && Math.floor(Date.now() / 1000) > payload.exp) {
    return null;
  }

  return payload;
};

module.exports = { sign, verify };
