'use strict';

const { loginSchema } = require('../schemas/users/login');
const { findByEmail, findById } = require('../models/users.model');
const { verifyPassword } = require('../utils/password');
const { sign } = require('../utils/jwt');
const { success, error, validationError } = require('../utils/response');
const { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } = require('../config');

const login = async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const { email, password } = parsed.data;
  const user = await findByEmail(email);
  if (!user) {
    return error(res, 'Correo o contraseña incorrectos.', 401);
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    return error(res, 'Correo o contraseña incorrectos.', 401);
  }

  // TODO: exigir código TOTP acá una vez implementado el enrolamiento de 2FA
  // (cuando user.totp_secret no sea null).

  const token = sign(
    { type: 'user', userId: user.id, role: user.role },
    process.env.JWT_SECRET,
    SESSION_TTL_SECONDS,
  );

  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: SESSION_TTL_SECONDS * 1000,
  });

  success(res, { id: user.id, email: user.email, role: user.role });
};

const me = async (req, res) => {
  const user = await findById(req.auth.userId);
  if (!user) {
    return error(res, 'Usuario no encontrado.', 404);
  }
  success(res, user);
};

module.exports = { login, me };
