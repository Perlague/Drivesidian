'use strict';

const qrcode = require('qrcode');
const { loginSchema } = require('../schemas/users/login');
const { registerSchema } = require('../schemas/users/register');
const { confirm2faSchema } = require('../schemas/users/confirm2fa');
const { notificationsSchema } = require('../schemas/users/notifications');
const {
  findByEmail,
  findById,
  create,
  updateNotifyPreference,
  saveTotpSecret,
  incrementFailedAttempts,
  resetFailedAttempts,
} = require('../models/users.model');
const { hashPassword, verifyPassword } = require('../utils/password');
const { generateSecret, buildOtpAuthUri, verifyTotp } = require('../utils/totp');
const { encryptSecret, decryptSecret } = require('../utils/secretCrypto');
const { sign } = require('../utils/jwt');
const { success, error, validationError } = require('../utils/response');
const { logSecurityEvent, SEVERITY, EVENTS } = require('../utils/securityLog');
const { topicForUser, topicUrl } = require('../utils/ntfyTopic');
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
    logSecurityEvent({ type: EVENTS.AUTH_REGISTER, userId: user.id, req, details: { email } });
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

  const { email, password, totp_code: totpCode } = parsed.data;
  const user = await findByEmail(email);
  if (!user) {
    // Sin usuario no hay a quién atribuirlo, pero el evento importa: una
    // ráfaga de estos desde una IP es enumeración de correos.
    logSecurityEvent({
      type: EVENTS.AUTH_LOGIN_FAILED_PASSWORD,
      severity: SEVERITY.WARN,
      req,
      details: { email, reason: 'unknown_email' },
    });
    return error(res, 'Correo o contraseña incorrectos.', 401);
  }

  const passwordOk = await verifyPassword(password, user.password_hash);
  if (!passwordOk) {
    logSecurityEvent({
      type: EVENTS.AUTH_LOGIN_FAILED_PASSWORD,
      severity: SEVERITY.WARN,
      userId: user.id,
      req,
      details: { email, reason: 'bad_password' },
    });
    return error(res, 'Correo o contraseña incorrectos.', 401);
  }

  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    logSecurityEvent({
      type: EVENTS.AUTH_LOGIN_BLOCKED,
      severity: SEVERITY.WARN,
      userId: user.id,
      req,
      details: { locked_until: user.locked_until },
    });
    return error(
      res,
      'Cuenta bloqueada temporalmente por múltiples intentos fallidos de 2FA. Intenta de nuevo más tarde.',
      403,
    );
  }

  if (user.totp_secret) {
    if (!totpCode) {
      return error(res, 'Se requiere el código de autenticación de dos factores.', 400);
    }

    const decryptedSecret = decryptSecret(user.totp_secret);
    if (!verifyTotp(decryptedSecret, totpCode)) {
      const attempts = await incrementFailedAttempts(user.id);
      logSecurityEvent({
        type: EVENTS.AUTH_LOGIN_FAILED_TOTP,
        severity: SEVERITY.WARN,
        userId: user.id,
        req,
        details: { failed_attempts: attempts.failed_2fa_attempts },
      });
      // El bloqueo lo aplica el propio UPDATE de incrementFailedAttempts; acá
      // solo se reporta el cruce del umbral, que es lo que Guardian querrá ver.
      if (attempts.locked_until && new Date(attempts.locked_until) > new Date()) {
        logSecurityEvent({
          type: EVENTS.AUTH_LOCKOUT,
          severity: SEVERITY.CRITICAL,
          userId: user.id,
          req,
          details: {
            failed_attempts: attempts.failed_2fa_attempts,
            locked_until: attempts.locked_until,
          },
        });
      }
      return error(res, 'Código de autenticación incorrecto.', 401);
    }

    await resetFailedAttempts(user.id);
  }

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

  logSecurityEvent({
    type: EVENTS.AUTH_LOGIN_SUCCESS,
    userId: user.id,
    req,
    details: { email: user.email, twofa: Boolean(user.totp_secret) },
  });
  success(res, { id: user.id, email: user.email, role: user.role });
};

const logout = async (req, res) => {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });
  logSecurityEvent({ type: EVENTS.AUTH_LOGOUT, userId: req.auth.userId, req });
  success(res, { message: 'Sesión cerrada.' });
};

const me = async (req, res) => {
  const user = await findById(req.auth.userId);
  if (!user) {
    return error(res, 'Usuario no encontrado.', 404);
  }
  // El topic no está en la base: se deriva del id. El panel lo necesita para
  // dibujar el QR de suscripción.
  success(res, { ...user, ntfy_topic: topicForUser(user.id), ntfy_url: topicUrl(user.id) });
};

// PATCH /api/users/me/notifications — el interruptor vive en el panel web; el
// agente no participa de esta decisión.
const updateNotifications = async (req, res) => {
  const parsed = notificationsSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const updated = await updateNotifyPreference(req.auth.userId, parsed.data.notify_enabled);
  if (!updated) {
    return error(res, 'Usuario no encontrado.', 404);
  }
  success(res, updated);
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
  logSecurityEvent({ type: EVENTS.TWOFA_ENROLLED, userId: req.auth.userId, req });
  success(res, { message: '2FA habilitado correctamente.' });
};

module.exports = { register, login, logout, me, updateNotifications, enroll2fa, confirm2fa };
