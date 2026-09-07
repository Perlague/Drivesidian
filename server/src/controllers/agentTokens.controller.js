'use strict';

const crypto = require('crypto');
const agentTokensModel = require('../models/agentTokens.model');
const { sign } = require('../utils/jwt');
const { success, error } = require('../utils/response');

const AGENT_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 365; // 1 año

const hashJti = (jti) => crypto.createHash('sha256').update(jti).digest('hex');

// POST /api/agent-tokens — exclusivo de la sesión web.
const create = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }

  const jti = crypto.randomBytes(16).toString('hex');
  const tokenHash = hashJti(jti);

  const row = await agentTokensModel.create(req.auth.userId, tokenHash);
  const token = sign(
    { type: 'agent', userId: req.auth.userId, jti },
    process.env.JWT_SECRET,
    AGENT_TOKEN_TTL_SECONDS,
  );

  // El JWT completo se devuelve una sola vez: solo guardamos su hash, así
  // que no hay forma de volver a mostrarlo después de este response.
  success(res, { id: row.id, token, created_at: row.created_at }, 201);
};

// GET /api/agent-tokens — exclusivo de la sesión web.
const list = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }

  const tokens = await agentTokensModel.findAllByUser(req.auth.userId);
  success(res, tokens);
};

// DELETE /api/agent-tokens/:id — exclusivo de la sesión web.
const revoke = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }
  if (!/^\d+$/.test(req.params.id)) {
    return error(res, 'id inválido.', 400);
  }

  const revoked = await agentTokensModel.revoke(req.params.id, req.auth.userId);
  if (!revoked) {
    return error(res, 'Token no encontrado o ya estaba revocado.', 404);
  }
  success(res, revoked);
};

module.exports = { create, list, revoke };
