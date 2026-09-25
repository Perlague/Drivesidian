'use strict';

const crypto = require('crypto');

// El topic de ntfy de cada usuario se DERIVA, no se guarda: no hay columna
// para él, se recalcula cuando hace falta.
//
// Un topic no puede ser secreto para su propio dueño — suscribirse en la app de
// ntfy consiste precisamente en conocer su nombre, y el servidor lo necesita en
// claro para poder hacer POST https://ntfy.sh/<topic>. No se puede hashear y
// seguir usándolo. Pero como ntfy.sh no tiene autenticación de ningún tipo, el
// nombre del topic *es* la credencial: cualquiera que lo adivine lee las
// notificaciones. Por eso se deriva por HMAC en vez de dejarlo predecible.

const PREFIX = 'drivesidian-';
const TOPIC_HEX_LENGTH = 20; // 80 bits, de sobra contra fuerza bruta

const topicForUser = (userId) => {
  const secret = process.env.NTFY_SECRET;
  if (!secret) {
    throw new Error('Falta NTFY_SECRET: sin esa llave no se puede derivar el topic de ntfy.');
  }

  const digest = crypto.createHmac('sha256', secret).update(String(userId)).digest('hex');
  return `${PREFIX}${digest.slice(0, TOPIC_HEX_LENGTH)}`;
};

const topicUrl = (userId) => `https://ntfy.sh/${topicForUser(userId)}`;

module.exports = { topicForUser, topicUrl };
