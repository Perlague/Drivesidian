'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { create, list, revoke } = require('../controllers/agentTokens.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/', create);
router.get('/', list);
router.delete('/:id', revoke);

module.exports = router;
