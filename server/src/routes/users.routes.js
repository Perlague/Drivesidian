'use strict';

const express = require('express');
const { login, me } = require('../controllers/users.controller');
const requireAuth = require('../middleware/requireAuth');

const router = express.Router();

router.post('/login', login);
router.get('/me', requireAuth, me);

module.exports = router;
