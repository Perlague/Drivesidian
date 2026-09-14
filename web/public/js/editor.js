'use strict';

const input = document.getElementById('markdown-input');
const preview = document.getElementById('preview');

// Nota: preview sin sanitizar todavía (no hay sanitize-html/DOMPurify en este
// borrador). No hay riesgo real de XSS aún porque nada persiste ni se
// comparte con otros usuarios — se agrega al conectar el editor de verdad.
const render = () => {
  preview.innerHTML = marked.parse(input.value);
};

input.addEventListener('input', render);

input.value = [
  '# Hola Drivesidian',
  '',
  'Esto es un **editor de markdown** muy simple.',
  '',
  '- Sin conectar al backend todavía',
  '- Solo prueba el preview en vivo',
].join('\n');

render();
