'use strict';

const crypto = require('crypto');

const KEY_LENGTH = 64;

const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);
      resolve(`${salt}:${derivedKey.toString('hex')}`);
    });
  });
};

const verifyPassword = (password, stored) => {
  const [salt, hashHex] = stored.split(':');
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, KEY_LENGTH, (err, derivedKey) => {
      if (err) return reject(err);
      const storedKey = Buffer.from(hashHex, 'hex');
      resolve(storedKey.length === derivedKey.length && crypto.timingSafeEqual(storedKey, derivedKey));
    });
  });
};

module.exports = { hashPassword, verifyPassword };
