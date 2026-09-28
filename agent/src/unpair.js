'use strict';

// Lo invoca el desinstalador antes de borrar los archivos de la aplicación.
// Revoca el acceso del lado del servidor y borra la configuración local, para
// que no quede una credencial viva ni en la base ni en el disco.
//
// Falla en silencio hacia el éxito: si el equipo está sin red o el servidor no
// responde, la desinstalación debe continuar igualmente. El usuario siempre
// puede revocar el acceso a mano desde el panel web.

const log = require('./log');
const config = require('./config');

// El desinstalador espera a que este proceso termine: sin tope, un servidor
// que acepta la conexión y nunca responde dejaría la desinstalación colgada.
const TIEMPO_MAXIMO_MS = 10_000;

const desvincular = async () => {
  const { apiUrl, agentToken } = config.cargar();

  if (!agentToken) {
    log.info('Este equipo no estaba vinculado.');
  } else {
    try {
      const respuesta = await fetch(`${apiUrl}/api/agent-tokens/self`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` },
        signal: AbortSignal.timeout(TIEMPO_MAXIMO_MS),
      });

      if (respuesta.ok) log.info('Acceso revocado en el servidor.');
      else log.warn(`El servidor respondió ${respuesta.status} al revocar el acceso.`);
    } catch (err) {
      log.warn(`No se pudo contactar al servidor para revocar el acceso: ${err.message}`);
      log.warn('Revócalo a mano desde el panel web si te preocupa.');
    }
  }

  config.borrar();
  log.info('Configuración local borrada.');
};

// Nunca se sale con error: un fallo aquí no debe abortar la desinstalación.
//
// Sin process.exit(): el proceso termina solo cuando no le queda trabajo. En
// Windows, con Node 24, forzar la salida mientras la conexión del fetch se está
// cerrando tumba el proceso con 0xC0000409 (una aserción de libuv en
// src\win\async.c), después de haber revocado y borrado todo.
desvincular().catch((err) => log.warn(`Desvinculación incompleta: ${err.message}`));
