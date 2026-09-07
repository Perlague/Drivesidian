'use strict';

require('dotenv').config();
const pool = require('../src/db/pool');
const { hashPassword } = require('../src/utils/password');

const run = async () => {
  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error('SEED_ADMIN_EMAIL y SEED_ADMIN_PASSWORD son requeridos (ver .env.example).');
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  // totp_secret queda NULL: la cuenta sembrada no tiene 2FA enrolado todavía,
  // igual que cualquier cuenta recién registrada antes de pasar por el flujo de enrolamiento.
  await pool.query(
    `INSERT INTO users (email, password_hash, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (email) DO NOTHING`,
    [email, passwordHash],
  );

  console.log(`Usuario admin de desarrollo listo: ${email}`);
};

run()
  .catch((err) => {
    console.error('Error al sembrar datos', err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
