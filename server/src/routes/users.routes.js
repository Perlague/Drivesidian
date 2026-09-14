'use strict';

const express = require('express');
const { register, login, me, enroll2fa, confirm2fa } = require('../controllers/users.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.post('/register', register);
router.post('/login', login);
router.get('/me', requireAuth, me);
router.post('/2fa/enroll', requireAuth, enroll2fa);
router.post('/2fa/confirm', requireAuth, confirm2fa);

module.exports = router;
