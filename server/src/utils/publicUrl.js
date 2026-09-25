'use strict';

// De dónde sale la URL pública del servidor.
//
// Importa por una sola cosa: el agente abre la página de vinculación en el
// navegador del usuario, y esa URL tiene que ser alcanzable desde su máquina.
// Lo que Express ve por dentro (`req.get('host')`) es el contenedor, no el
// dominio.
//
// Orden de resolución, de más explícito a más adivinado:
//
//   1. PUBLIC_URL — el despliegue con dominio propio. Manda siempre.
//   2. La API local del agente de ngrok. Es lo que permite levantar todo sin
//      dominio ni certificado: ngrok asigna una URL al azar en cada arranque y
//      el servidor la descubre en vez de que alguien la copie a mano.
//   3. https://DOMAIN, si hay dominio pero nadie puso PUBLIC_URL.
//   4. http://127.0.0.1:PORT — desarrollo local a secas.
//
// La URL de ngrok cambia cada vez que el túnel se reinicia, así que no se
// resuelve una vez y se olvida: se refresca en segundo plano.

const NGROK_API = process.env.NGROK_API || 'http://127.0.0.1:4040/api/tunnels';
const REFRESCO_MS = 60 * 1000;

// Cuánto se espera al arranque a que ngrok levante. El contenedor de ngrok y el
// del servidor arrancan a la vez y el túnel tarda un par de segundos en estar
// listo, así que el primer intento casi siempre falla.
const INTENTOS_INICIALES = 10;
const ESPERA_ENTRE_INTENTOS_MS = 1500;

const limpiar = (url) => String(url).replace(/\/+$/, '');

const desdeEnv = () => (process.env.PUBLIC_URL ? limpiar(process.env.PUBLIC_URL) : null);

const desdeDominio = () => {
  const dominio = process.env.DOMAIN;
  // `localhost` es el valor que usa el despliegue local con la CA interna de
  // Caddy; como URL pública no sirve de nada, así que no cuenta.
  if (!dominio || dominio === 'localhost') return null;
  return `https://${dominio}`;
};

const porDefecto = () => `http://127.0.0.1:${process.env.PORT || 3000}`;

// Pregunta al agente de ngrok qué URL le asignaron. Devuelve null si no hay
// agente escuchando, que es el caso normal cuando no se está usando ngrok.
const desdeNgrok = async () => {
  try {
    const res = await fetch(NGROK_API, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;

    const { tunnels } = await res.json();
    if (!Array.isArray(tunnels)) return null;

    // Se toma el túnel https: ngrok publica también uno http en algunas
    // configuraciones, y mandar al usuario por el plano sería tirar el TLS.
    const tunel = tunnels.find((t) => t.proto === 'https') || tunnels[0];
    return tunel?.public_url ? limpiar(tunel.public_url) : null;
  } catch {
    // Sin agente de ngrok, con la API apagada, o tardó demasiado. No es un
    // error: es el camino normal del despliegue con dominio.
    return null;
  }
};

let cache = null;
let fuente = null;

const resolver = async () => {
  const explicita = desdeEnv();
  if (explicita) {
    cache = explicita;
    fuente = 'PUBLIC_URL';
    return { url: cache, fuente };
  }

  const ngrok = await desdeNgrok();
  if (ngrok) {
    cache = ngrok;
    fuente = 'ngrok';
    return { url: cache, fuente };
  }

  const dominio = desdeDominio();
  if (dominio) {
    cache = dominio;
    fuente = 'DOMAIN';
    return { url: cache, fuente };
  }

  cache = porDefecto();
  fuente = 'local';
  return { url: cache, fuente };
};

// Lo que usan los controllers. Nunca es async: una petición no puede quedarse
// esperando a que ngrok conteste. Devuelve lo último que se resolvió.
const getPublicUrl = () => cache || desdeEnv() || desdeDominio() || porDefecto();

const getFuente = () => fuente;

// ¿Se está desplegando detrás de ngrok? Hace falta saberlo para no esperar a un
// túnel que nadie va a levantar: sin esto, un `pnpm dev` normal tardaría quince
// segundos en arrancar sondeando un puerto vacío.
const esperandoNgrok = () => Boolean(process.env.USE_NGROK || process.env.NGROK_API);

// Se llama una vez al arrancar. Cuando se espera un túnel insiste, porque el
// contenedor de ngrok y el del servidor arrancan a la vez y el túnel tarda un
// par de segundos; después deja un temporizador que vuelve a preguntar, porque
// si ngrok se reinicia su URL cambia y las páginas de vinculación que abra el
// agente apuntarían a un túnel muerto.
const iniciarResolucion = async () => {
  const intentos = esperandoNgrok() ? INTENTOS_INICIALES : 1;

  for (let intento = 1; intento <= intentos; intento += 1) {
    const { fuente: encontrada } = await resolver();

    // Con PUBLIC_URL no hay nada que esperar ni que refrescar.
    if (encontrada === 'PUBLIC_URL') return { url: cache, fuente };
    if (encontrada === 'ngrok') break;
    if (intento === intentos) break;

    await new Promise((r) => setTimeout(r, ESPERA_ENTRE_INTENTOS_MS));
  }

  if (esperandoNgrok()) {
    const refresco = setInterval(async () => {
      const anterior = cache;
      await resolver();
      if (cache !== anterior) {
        console.log(`[publicUrl] la URL pública cambió: ${anterior} → ${cache}`);
        console.log(`[publicUrl] el agente necesita DRIVESIDIAN_API_URL=${cache}`);
      }
    }, REFRESCO_MS);
    // Un temporizador sin unref() mantiene el proceso vivo al apagarlo.
    refresco.unref();
  }

  return { url: cache, fuente };
};

module.exports = { getPublicUrl, getFuente, iniciarResolucion, resolver };
