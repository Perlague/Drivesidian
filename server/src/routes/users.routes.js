'use strict';

const express = require('express');
const { register, login, me, enroll2fa, confirm2fa } = require('../controllers/users.controller');
const requireAuth = require('../middleware/requireAuth');
const rateLimit2fa = require('../middleware/rateLimit2fa');

const router = express.Router();

router.post('/register', register);
router.post('/login', rateLimit2fa, login);
router.get('/me', requireAuth, me);
router.post('/2fa/enroll', requireAuth, enroll2fa);
router.post('/2fa/confirm', requireAuth, confirm2fa);

module.exports = router;
