'use strict';

const express = require('express');
const requireAuth = require('../middleware/requireAuth');
const { sync, list, getOne, update } = require('../controllers/notes.controller');

const router = express.Router();

router.use(requireAuth);

router.put('/sync', sync);
router.get('/', list);
router.get('/:id', getOne);
router.put('/:id', update);

module.exports = router;
