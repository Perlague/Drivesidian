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

const desvincular = async () => {
  const { apiUrl, agentToken } = config.cargar();

  if (!agentToken) {
    log.info('Este equipo no estaba vinculado.');
  } else {
    try {
      const respuesta = await fetch(`${apiUrl}/api/agent-tokens/self`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${agentToken}` },
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

desvincular()
  // Nunca se sale con error: un fallo aquí no debe abortar la desinstalación.
  .catch((err) => log.warn(`Desvinculación incompleta: ${err.message}`))
  .finally(() => process.exit(0));
