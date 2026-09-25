'use strict';

const express = require('express');
const {
  register,
  login,
  logout,
  me,
  updateNotifications,
  enroll2fa,
  confirm2fa,
} = require('../controllers/users.controller');
const requireAuth = require('../middleware/requireAuth');
const rateLimit2fa = require('../middleware/rateLimit2fa');

const router = express.Router();

router.post('/register', register);
router.post('/login', rateLimit2fa, login);
router.post('/logout', requireAuth, logout);
router.get('/me', requireAuth, me);
router.patch('/me/notifications', requireAuth, updateNotifications);
router.post('/2fa/enroll', requireAuth, enroll2fa);
router.post('/2fa/confirm', requireAuth, confirm2fa);

module.exports = router;
