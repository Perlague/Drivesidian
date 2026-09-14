'use strict';

const qrcode = require('qrcode');
const { loginSchema } = require('../schemas/users/login');
const { registerSchema } = require('../schemas/users/register');
const { confirm2faSchema } = require('../schemas/users/confirm2fa');
const { findByEmail, findById, create, saveTotpSecret } = require('../models/users.model');
const { hashPassword, verifyPassword } = require('../utils/password');
const { generateSecret, buildOtpAuthUri, verifyTotp } = require('../utils/totp');
const { encryptSecret } = require('../utils/secretCrypto');
const { sign } = require('../utils/jwt');
const { success, error, validationError } = require('../utils/response');
const { SESSION_COOKIE_NAME, SESSION_TTL_SECONDS } = require('../config');

const register = async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const { email, password } = parsed.data;
  const existing = await findByEmail(email);
  if (existing) {
    return error(res, 'Ya existe una cuenta con ese correo.', 409);
  }

  const passwordHash = await hashPassword(password);
  try {
    const user = await create(email, passwordHash);
    success(res, user, 201);
  } catch (err) {
    // Colchón contra la carrera entre el findByEmail de arriba y este insert
    // (dos registros simultáneos con el mismo correo); el UNIQUE de la
    // migración es la garantía real.
    if (err.code === '23505') {
      return error(res, 'Ya existe una cuenta con ese correo.', 409);
    }
    throw err;
  }
};

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

// POST /api/users/2fa/enroll — genera el secreto pero NO lo guarda todavía.
// Se persiste solo si /2fa/confirm valida un código correcto (ver commit).
const enroll2fa = async (req, res) => {
  const user = await findById(req.auth.userId);
  const secret = generateSecret();
  const otpauthUri = buildOtpAuthUri(secret, user.email);
  const qrDataUrl = await qrcode.toDataURL(otpauthUri);

  success(res, { secret, otpauth_uri: otpauthUri, qr_data_url: qrDataUrl });
};

// POST /api/users/2fa/confirm — recibe de vuelta el secreto que dio /enroll
// junto con el primer código; si coincide, ahí sí se cifra y se guarda.
const confirm2fa = async (req, res) => {
  const parsed = confirm2faSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const { secret, code } = parsed.data;
  if (!verifyTotp(secret, code)) {
    return error(res, 'Código incorrecto.', 401);
  }

  const encrypted = encryptSecret(secret);
  await saveTotpSecret(req.auth.userId, encrypted);
  success(res, { message: '2FA habilitado correctamente.' });
};

module.exports = { register, login, me, enroll2fa, confirm2fa };
