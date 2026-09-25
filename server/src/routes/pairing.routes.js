'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const rateLimit = require('../middleware/rateLimit');
const { PAIRING_START_RATE_LIMIT, PAIRING_STATUS_RATE_LIMIT } = require('../config');
const { start, status, approve, describe } = require('../controllers/pairing.controller');

const router = express.Router();

// start y status NO llevan requireAuth: el agente todavía no tiene token, que
// es justo lo que viene a conseguir. Su protección es el verifier y el rate
// limit, no la sesión.
router.post(
  '/start',
  rateLimit({ ...PAIRING_START_RATE_LIMIT, keyBy: (req) => req.ip }),
  start,
);

router.get(
  '/status',
  rateLimit({ ...PAIRING_STATUS_RATE_LIMIT, keyBy: (req) => `code:${req.query.code || req.ip}` }),
  status,
);

// approve y describe sí exigen sesión web: los usa la página /pair.
router.post('/approve', requireAuth, approve);
router.get('/:code', requireAuth, describe);

module.exports = router;
