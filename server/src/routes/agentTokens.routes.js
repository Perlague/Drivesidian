'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { create, list, revoke, revokeSelf } = require('../controllers/agentTokens.controller');

const router = express.Router();

router.use(requireAuth);

router.post('/', create);
router.get('/', list);
// Va antes de /:id para que "self" no se interprete como un id.
router.delete('/self', revokeSelf);
router.delete('/:id', revoke);

module.exports = router;
