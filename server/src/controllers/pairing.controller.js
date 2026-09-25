'use strict';

const crypto = require('crypto');
const pairingModel = require('../models/pairingCodes.model');
const { issueAgentToken } = require('./agentTokens.controller');
const { startSchema } = require('../schemas/pairing/start');
const { approveSchema } = require('../schemas/pairing/approve');
const { success, error, validationError } = require('../utils/response');
const { logSecurityEvent, SEVERITY, EVENTS } = require('../utils/securityLog');
const { PAIRING_TTL_MS } = require('../config');

// Alfabeto sin caracteres que se confundan al leerlos en pantalla (0/O, 1/I/L).
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
const MAX_CODE_ATTEMPTS = 5;

const randomCode = () => {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += ALPHABET[crypto.randomInt(ALPHABET.length)];
    if (i === 3) out += '-'; // XXXX-XXXX, más fácil de leer en voz alta
  }
  return out;
};

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

const pairUrl = (req, code) => {
  const base = process.env.PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
  return `${base}/pair?code=${encodeURIComponent(code)}`;
};

// POST /api/pairing/start — SIN autenticación: el agente todavía no tiene
// token, que es justo lo que viene a conseguir.
const start = async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  // El código es corto y legible, así que puede chocar; se reintenta contra el
  // UNIQUE en vez de confiar en que no pase.
  let row = null;
  for (let attempt = 1; attempt <= MAX_CODE_ATTEMPTS && !row; attempt += 1) {
    try {
      row = await pairingModel.create({
        code: randomCode(),
        verifierHash: parsed.data.verifier_hash,
        vaults: parsed.data.vaults,
        deviceName: parsed.data.device_name || null,
        ttlMs: PAIRING_TTL_MS,
      });
    } catch (err) {
      if (err.code !== '23505') throw err; // 23505 = violación de UNIQUE
    }
  }
  if (!row) {
    return error(res, 'No se pudo generar un código de vinculación. Intenta de nuevo.', 503);
  }

  logSecurityEvent({
    type: EVENTS.PAIRING_REQUESTED,
    req,
    details: { device_name: row.device_name, vaults: parsed.data.vaults.length },
  });

  success(res, { code: row.code, pair_url: pairUrl(req, row.code), expires_at: row.expires_at }, 201);
};

// GET /api/pairing/status?code=XXXX-XXXX — SIN autenticación, pero exige el
// verifier en un header. Es lo que impide que quien vea el código en pantalla
// se lleve el token: sin el secreto que el agente guardó en su máquina, el
// canje no procede.
const status = async (req, res) => {
  const code = String(req.query.code || '');
  const verifier = req.headers['x-pair-verifier'];

  if (!code || !verifier) {
    return error(res, 'Faltan el código o el verifier.', 400);
  }

  const row = await pairingModel.findByCode(code);
  if (!row) {
    return error(res, 'Código de vinculación inválido.', 404);
  }

  // Comparación en tiempo constante: este endpoint es anónimo y el verifier es
  // el único secreto que lo protege.
  const expected = Buffer.from(row.verifier_hash);
  const provided = Buffer.from(sha256(String(verifier)));
  if (expected.length !== provided.length || !crypto.timingSafeEqual(expected, provided)) {
    logSecurityEvent({
      type: EVENTS.PAIRING_REJECTED,
      severity: SEVERITY.CRITICAL,
      userId: row.user_id,
      req,
      details: { code, reason: 'verifier_incorrecto', device_name: row.device_name },
    });
    return error(res, 'Verifier incorrecto.', 403);
  }

  if (row.consumed_at) {
    return error(res, 'Este código ya se usó.', 410);
  }

  if (new Date(row.expires_at) <= new Date()) {
    logSecurityEvent({ type: EVENTS.PAIRING_EXPIRED, req, details: { code } });
    return error(res, 'El código de vinculación expiró. Reinicia el agente.', 410);
  }

  if (!row.approved_at) {
    return success(res, { status: 'pending', expires_at: row.expires_at });
  }

  // Aprobado: se emite el token AHORA, no al aprobar. Así el JWT nunca se
  // guarda en la base ni siquiera de forma temporal — solo su hash, como
  // cualquier otro agent token.
  const issued = await issueAgentToken(row.user_id);
  const consumed = await pairingModel.consume(code, issued.id);
  if (!consumed) {
    // Otro polling se lo llevó entre el findByCode y el consume.
    return error(res, 'Este código ya se usó.', 410);
  }

  logSecurityEvent({
    type: EVENTS.PAIRING_CONSUMED,
    userId: row.user_id,
    req,
    details: { code, token_id: issued.id, device_name: row.device_name },
  });
  logSecurityEvent({
    type: EVENTS.TOKEN_CREATED,
    userId: row.user_id,
    req,
    details: { token_id: issued.id, source: 'vinculación' },
  });

  success(res, {
    status: 'approved',
    token: issued.token,
    vault_path: row.selected_vault,
  });
};

// POST /api/pairing/approve — el humano aprueba desde el navegador, con sesión
// iniciada. Aquí NO se emite el token todavía.
const approve = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }

  const parsed = approveSchema.safeParse(req.body);
  if (!parsed.success) {
    return validationError(res, parsed.error);
  }

  const row = await pairingModel.findByCode(parsed.data.code);
  if (!row) {
    return error(res, 'Código de vinculación inválido.', 404);
  }
  if (row.consumed_at || row.approved_at) {
    return error(res, 'Este código ya se aprobó.', 409);
  }
  if (new Date(row.expires_at) <= new Date()) {
    logSecurityEvent({
      type: EVENTS.PAIRING_EXPIRED,
      userId: req.auth.userId,
      req,
      details: { code: parsed.data.code },
    });
    return error(res, 'El código expiró. Reinicia el agente para obtener uno nuevo.', 410);
  }

  // Si el agente detectó varios vaults, el usuario elige; si solo había uno, se
  // toma ese sin preguntar.
  const vaults = Array.isArray(row.vaults) ? row.vaults : [];
  const selected =
    parsed.data.selected_vault || (vaults.length === 1 ? vaults[0].path : null);

  if (vaults.length > 1 && !selected) {
    return error(res, 'Hay varios vaults: elige cuál vigilará el agente.', 400);
  }
  if (selected && vaults.length > 0 && !vaults.some((v) => v.path === selected)) {
    return error(res, 'Ese vault no es uno de los que detectó el agente.', 400);
  }

  const approved = await pairingModel.approve(parsed.data.code, req.auth.userId, selected);
  if (!approved) {
    return error(res, 'El código ya no se puede aprobar.', 409);
  }

  logSecurityEvent({
    type: EVENTS.PAIRING_APPROVED,
    userId: req.auth.userId,
    req,
    details: { code: parsed.data.code, device_name: row.device_name, vault: selected },
  });

  success(res, {
    device_name: approved.device_name,
    selected_vault: approved.selected_vault,
    approved_at: approved.approved_at,
  });
};

// GET /api/pairing/:code — lo consulta la página /pair para mostrar qué equipo
// pide vincularse antes de que el usuario apruebe. Requiere sesión web.
const describe = async (req, res) => {
  const row = await pairingModel.findByCode(req.params.code);
  if (!row) {
    return error(res, 'Código de vinculación inválido.', 404);
  }

  // Nunca se devuelve el verifier_hash: es el secreto que protege el canje.
  success(res, {
    code: row.code,
    device_name: row.device_name,
    vaults: row.vaults,
    expires_at: row.expires_at,
    approved: Boolean(row.approved_at),
    consumed: Boolean(row.consumed_at),
    expired: new Date(row.expires_at) <= new Date(),
  });
};

module.exports = { start, status, approve, describe };
