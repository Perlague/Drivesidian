'use strict';

// Genera installer/icono.ico sin dependencias, escribiendo el formato a mano.
//
// El icono se genera y no se commitea como binario opaco: así se puede revisar
// qué dibuja, y cambiarlo es editar código en vez de abrir un editor gráfico.
//
// Formato ICO: cabecera + una entrada por tamaño + un BMP (sin comprimir,
// 32 bits con alfa) por cada una. El alto del BITMAPINFOHEADER va al doble
// porque históricamente el BMP incluía una máscara AND debajo del bitmap XOR.

const fs = require('fs');
const path = require('path');

const TAMANOS = [16, 32, 48, 64];

// Azul del acento de la interfaz web (--acento en app.css).
const FONDO = { r: 0x4c, g: 0x6e, b: 0xf5 };
const TRAZO = { r: 0xff, g: 0xff, b: 0xff };

// Dibuja un anillo con una muesca: evoca la flecha circular de "sincronizar"
// sin necesitar curvas de Bézier ni una fuente.
const pixel = (x, y, n) => {
  const c = (n - 1) / 2;
  const dx = x - c;
  const dy = y - c;

  // Esquinas redondeadas del fondo.
  const margen = n * 0.06;
  const radio = n * 0.22;
  const ix = Math.min(Math.max(x, margen + radio), n - 1 - margen - radio);
  const iy = Math.min(Math.max(y, margen + radio), n - 1 - margen - radio);
  const dentroFondo = Math.hypot(x - ix, y - iy) <= radio;
  if (!dentroFondo) return { ...FONDO, a: 0 };

  const dist = Math.hypot(dx, dy);
  const rExterior = n * 0.30;
  const rInterior = n * 0.19;
  const enAnillo = dist <= rExterior && dist >= rInterior;

  // La muesca abre el anillo por arriba a la derecha.
  const angulo = Math.atan2(dy, dx);
  const enMuesca = angulo > -1.15 && angulo < -0.15;

  if (enAnillo && !enMuesca) return { ...TRAZO, a: 255 };
  return { ...FONDO, a: 255 };
};

const bmpDeTamano = (n) => {
  const cabecera = Buffer.alloc(40);
  cabecera.writeUInt32LE(40, 0);       // tamaño de la cabecera
  cabecera.writeInt32LE(n, 4);         // ancho
  cabecera.writeInt32LE(n * 2, 8);     // alto: XOR + máscara AND
  cabecera.writeUInt16LE(1, 12);       // planos
  cabecera.writeUInt16LE(32, 14);      // bits por píxel
  cabecera.writeUInt32LE(0, 16);       // sin compresión

  // El bitmap va de abajo hacia arriba, en BGRA.
  const pixeles = Buffer.alloc(n * n * 4);
  for (let fila = 0; fila < n; fila += 1) {
    const y = n - 1 - fila;
    for (let x = 0; x < n; x += 1) {
      const c = pixel(x, y, n);
      const off = (fila * n + x) * 4;
      pixeles[off] = c.b;
      pixeles[off + 1] = c.g;
      pixeles[off + 2] = c.r;
      pixeles[off + 3] = c.a;
    }
  }

  // Máscara AND: irrelevante con alfa de 32 bits, pero el formato la exige.
  // Las filas se alinean a 4 bytes.
  const bytesPorFila = Math.ceil(n / 32) * 4;
  const mascara = Buffer.alloc(bytesPorFila * n);

  return Buffer.concat([cabecera, pixeles, mascara]);
};

const construir = () => {
  const imagenes = TAMANOS.map((n) => ({ n, datos: bmpDeTamano(n) }));

  const cabecera = Buffer.alloc(6);
  cabecera.writeUInt16LE(0, 0); // reservado
  cabecera.writeUInt16LE(1, 2); // 1 = icono
  cabecera.writeUInt16LE(imagenes.length, 4);

  const entradas = Buffer.alloc(16 * imagenes.length);
  let offset = 6 + entradas.length;

  imagenes.forEach(({ n, datos }, i) => {
    const e = i * 16;
    entradas[e] = n === 256 ? 0 : n;      // 0 significa 256
    entradas[e + 1] = n === 256 ? 0 : n;
    entradas[e + 2] = 0;                  // colores de la paleta
    entradas[e + 3] = 0;                  // reservado
    entradas.writeUInt16LE(1, e + 4);     // planos
    entradas.writeUInt16LE(32, e + 6);    // bits por píxel
    entradas.writeUInt32LE(datos.length, e + 8);
    entradas.writeUInt32LE(offset, e + 12);
    offset += datos.length;
  });

  return Buffer.concat([cabecera, entradas, ...imagenes.map((i) => i.datos)]);
};

const destino = path.join(__dirname, 'icono.ico');
fs.writeFileSync(destino, construir());
console.log(`icono generado: ${destino} (${TAMANOS.join(', ')} px)`);
