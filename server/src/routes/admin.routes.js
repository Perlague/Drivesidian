'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const requireRole = require('../middleware/requireRole');
const {
  listUsers,
  listSecurityEvents,
  listEventTypes,
} = require('../controllers/admin.controller');

const router = express.Router();

// El orden importa: requireAuth pone req.auth, y requireRole lo lee.
router.use(requireAuth, requireRole('admin'));

router.get('/users', listUsers);
router.get('/security-events', listSecurityEvents);
router.get('/event-types', listEventTypes);

module.exports = router;
