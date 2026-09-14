'use strict';

const crypto = require('crypto');

// TOTP (RFC 6238) sobre HOTP (RFC 4226), implementado desde cero con crypto
// nativo — sin speakeasy/otplib, por decisión explícita del proyecto.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const STEP_SECONDS = 30;
const DIGITS = 6;

const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
};

const base32Decode = (base32) => {
  const clean = base32.toUpperCase().replace(/=+$/, '');
  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of clean) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
};

// Secreto de 160 bits (20 bytes), el tamaño estándar recomendado por RFC 4226.
const generateSecret = () => base32Encode(crypto.randomBytes(20));

const hotp = (secretBuffer, counter) => {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const hmac = crypto.createHmac('sha1', secretBuffer).update(counterBuffer).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  return (binCode % 10 ** DIGITS).toString().padStart(DIGITS, '0');
};

const generateTotp = (base32Secret, timeStepOffset = 0) => {
  const secretBuffer = base32Decode(base32Secret);
  const counter = Math.floor(Date.now() / 1000 / STEP_SECONDS) + timeStepOffset;
  return hotp(secretBuffer, counter);
};

// Tolerancia de ±1 paso (30s) para compensar pequeños desfases de reloj entre
// el celular del usuario y el servidor.
const verifyTotp = (base32Secret, code) => {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return false;
  return [0, -1, 1].some((offset) => generateTotp(base32Secret, offset) === code);
};

const buildOtpAuthUri = (base32Secret, email, issuer = 'Drivesidian') => {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret: base32Secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
};

module.exports = { generateSecret, generateTotp, verifyTotp, buildOtpAuthUri };
