'use strict';

const crypto = require('crypto');
const agentTokensModel = require('../models/agentTokens.model');
const { sign } = require('../utils/jwt');
const { success, error } = require('../utils/response');
const { logSecurityEvent, SEVERITY, EVENTS } = require('../utils/securityLog');
const { AGENT_SCOPES } = require('../config');

const hashJti = (jti) => crypto.createHash('sha256').update(jti).digest('hex');

// Crea el agent token y su fila en agent_tokens. Se comparte entre este
// controller y el flujo de vinculación, que también emite tokens.
const issueAgentToken = async (userId) => {
  const jti = crypto.randomBytes(16).toString('hex');
  const row = await agentTokensModel.create(userId, hashJti(jti));
  // El agente necesita los dos alcances: sube notas y baja cambios. El claim se
  // declara igual, para que un consumidor futuro que solo lea pueda pedir uno
  // más estrecho sin cambiar nada del mecanismo.
  //
  // Sin expiración: solo se caduca revocándolo (ver utils/jwt.js).
  const token = sign(
    {
      type: 'agent',
      userId,
      jti,
      scope: [AGENT_SCOPES.READ, AGENT_SCOPES.WRITE],
    },
    process.env.JWT_SECRET,
  );
  return { id: row.id, token, created_at: row.created_at };
};

// POST /api/agent-tokens — exclusivo de la sesión web.
const create = async (req, res) => {
  if (req.auth.type !== 'user') {
    return error(res, 'Este endpoint es exclusivo de la sesión web.', 403);
  }

  const issued = await issueAgentToken(req.auth.userId);

  logSecurityEvent({
    type: EVENTS.TOKEN_CREATED,
    userId: req.auth.userId,
    req,
    details: { token_id: issued.id, source: 'panel' },
  });

  // El JWT completo se devuelve una sola vez: solo guardamos su hash, así
  // que no hay forma de volver a mostrarlo después de este response.
  success(res, issued, 201);
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
  logSecurityEvent({
    type: EVENTS.TOKEN_REVOKED,
    userId: req.auth.userId,
    req,
    details: { token_id: revoked.id },
  });
  success(res, revoked);
};

// DELETE /api/agent-tokens/self — exclusivo del agente, que revoca SU PROPIO
// token. Lo usa el desinstalador para no dejar una credencial viva en la base
// después de que el usuario desinstala. No puede tocar ningún otro token: el
// jti sale del JWT con el que viene autenticado, no del body ni de la URL.
const revokeSelf = async (req, res) => {
  if (req.auth.type !== 'agent') {
    return error(res, 'Este endpoint es exclusivo del agente.', 403);
  }

  const activeToken = await agentTokensModel.findActiveByHash(hashJti(req.auth.jti));
  if (!activeToken) {
    return error(res, 'El token ya estaba revocado.', 404);
  }

  const revoked = await agentTokensModel.revoke(activeToken.id, req.auth.userId);
  logSecurityEvent({
    type: EVENTS.TOKEN_REVOKED,
    userId: req.auth.userId,
    req,
    details: { token_id: activeToken.id, source: 'agente (autorrevocación)' },
  });
  success(res, revoked);
};

module.exports = { create, list, revoke, revokeSelf, issueAgentToken };
