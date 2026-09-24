'use strict';

const { error } = require('../utils/response');
const { logSecurityEvent, SEVERITY, EVENTS } = require('../utils/securityLog');

// Limitador en memoria, sin Redis: hay una sola instancia de Express en la EC2
// (ver CLAUDE.md). No sobrevive a un reinicio del proceso ni escalaría a varias
// instancias, y es una limitación aceptada para el tamaño del proyecto.
//
// Dos cosas que importan más que el límite en sí:
//
// 1. **Un evento por ventana, no por petición rechazada.** Guardian es un
//    agente de IA que lee este feed, así que cada línea le cuesta tokens. Un
//    atacante que manda 10.000 peticiones de más debe producir UNA línea con el
//    conteo, no diez mil líneas idénticas. Si el abuso se sostiene, se vuelve a
//    avisar como máximo una vez por ventana.
//
// 2. **Las entradas caducadas se barren.** Un Map indexado por IP que nunca se
//    limpia crece sin tope: cada IP que pasó una vez por el login se queda ahí
//    para siempre.

const PRUNE_INTERVAL_MS = 10 * 60 * 1000; // cada 10 minutos

const rateLimit = ({ windowMs, max, keyBy, eventType = EVENTS.RATELIMIT_EXCEEDED, details = () => ({}) }) => {
  // key -> { hits: number[], lastNotifiedAt: number }
  const buckets = new Map();

  const prune = () => {
    const cutoff = Date.now() - windowMs;
    for (const [key, bucket] of buckets) {
      if (bucket.hits.every((t) => t <= cutoff)) buckets.delete(key);
    }
  };
  // unref para que este temporizador no mantenga vivo el proceso.
  setInterval(prune, PRUNE_INTERVAL_MS).unref();

  return (req, res, next) => {
    const key = keyBy(req);
    // Sin clave no hay a quién limitar (p. ej. una ruta de agente a la que
    // todavía no llegó requireAuth). Se deja pasar en vez de bloquear a ciegas.
    if (!key) return next();

    const now = Date.now();
    const bucket = buckets.get(key) || { hits: [], lastNotifiedAt: 0 };
    bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
    bucket.hits.push(now);
    buckets.set(key, bucket);

    if (bucket.hits.length <= max) return next();

    if (now - bucket.lastNotifiedAt >= windowMs) {
      bucket.lastNotifiedAt = now;
      logSecurityEvent({
        type: eventType,
        severity: SEVERITY.WARN,
        userId: req.auth?.userId ?? null,
        req,
        details: {
          hits: bucket.hits.length,
          max,
          window_ms: windowMs,
          path: req.originalUrl,
          ...details(req),
        },
      });
    }

    const retryAfter = Math.ceil(windowMs / 1000);
    res.set('Retry-After', String(retryAfter));
    return error(res, `Demasiadas peticiones. Intenta de nuevo en ${retryAfter} segundos.`, 429);
  };
};

module.exports = rateLimit;
