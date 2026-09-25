'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const rateLimit = require('../middleware/rateLimit');
const requireScope = require('../middleware/requireScope');
const { AGENT_RATE_LIMIT, SYNC_NOW_RATE_LIMIT, AGENT_SCOPES } = require('../config');
const {
  sync,
  syncNow,
  changes,
  resolve,
  list,
  getOne,
  update,
} = require('../controllers/notes.controller');

const router = express.Router();

router.use(requireAuth);

// Va después de requireAuth porque la clave es el jti del agent token, que el
// middleware de auth es el que pone en req.auth.
const agentRateLimit = rateLimit({
  ...AGENT_RATE_LIMIT,
  keyBy: (req) => (req.auth?.type === 'agent' ? req.auth.jti : null),
});

const syncNowRateLimit = rateLimit({
  ...SYNC_NOW_RATE_LIMIT,
  keyBy: (req) => (req.auth?.type === 'user' ? `user:${req.auth.userId}` : null),
});

router.put('/sync', agentRateLimit, requireScope(AGENT_SCOPES.WRITE), sync);
// Antes de /:id para que "changes" no se interprete como el id de una nota.
router.get('/changes', agentRateLimit, requireScope(AGENT_SCOPES.READ), changes);
router.post('/sync-now', syncNowRateLimit, syncNow);
router.get('/', list);
router.get('/:id', getOne);
router.put('/:id', update);
router.post('/:id/resolve', resolve);

module.exports = router;
