'use strict';

const express = require('express');
const requireAuthPage = require('../middleware/requireAuthPage');
const { safeNext } = require('../middleware/requireAuthPage');
const { readPayload } = require('../utils/session');

const router = express.Router();

// Páginas de entrada: si ya hay sesión no tiene sentido mostrarlas.
const redirectIfLoggedIn = (req, res, next) => {
  const payload = readPayload(req);
  if (payload && payload.type === 'user') return res.redirect('/notes');
  return next();
};

router.get('/', (req, res) => {
  const payload = readPayload(req);
  res.redirect(payload && payload.type === 'user' ? '/notes' : '/login');
});

router.get('/login', redirectIfLoggedIn, (req, res) => {
  res.render('login', { title: 'Entrar', next: safeNext(req.query.next) || '' });
});

router.get('/register', redirectIfLoggedIn, (req, res) => {
  res.render('register', { title: 'Crear cuenta', next: safeNext(req.query.next) || '' });
});

router.get('/2fa', requireAuthPage, (req, res) => {
  res.render('enroll-2fa', { title: 'Autenticación en dos pasos', next: safeNext(req.query.next) || '' });
});

// El agente abre esta página en el navegador con su código en la URL.
router.get('/pair', requireAuthPage, (req, res) => {
  res.render('pair', { title: 'Vincular equipo', code: String(req.query.code || '') });
});

router.get('/dashboard', requireAuthPage, (req, res) => {
  res.render('dashboard', { title: 'Configuración' });
});

router.get('/notes', requireAuthPage, (req, res) => {
  res.render('notes', { title: 'Mis notas' });
});

router.get('/notes/:id', requireAuthPage, (req, res) => {
  res.render('editor', { title: 'Editor', noteId: req.params.id });
});

module.exports = router;
