'use strict';

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';

// Cifra totp_secret antes de guardarlo en Postgres. La llave vive solo en
// TOTP_ENCRYPTION_KEY (env var), nunca en la base ni en el repo.
const encryptSecret = (plainText) => {
  const key = Buffer.from(process.env.TOTP_ENCRYPTION_KEY, 'hex');
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
};

const decryptSecret = (stored) => {
  const [ivHex, authTagHex, encryptedHex] = stored.split(':');
  const key = Buffer.from(process.env.TOTP_ENCRYPTION_KEY, 'hex');
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
};

module.exports = { encryptSecret, decryptSecret };
