'use strict';

const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');
const log = require('./log');
const config = require('./config');
const { detectarVaults } = require('./vaultDetect');

const INTERVALO_POLLING_MS = 2000;

// Abre el navegador del usuario sin pasar por la shell. En Windows se usa
// rundll32 y no `cmd /c start` a propósito: `start` interpreta caracteres como
// & en la URL, y meter una URL en una línea de comandos de cmd es justo el tipo
// de cosa que se rompe o se presta a inyección.
const abrirNavegador = (url) => {
  const [comando, args] =
    process.platform === 'win32'
      ? ['rundll32', ['url.dll,FileProtocolHandler', url]]
      : process.platform === 'darwin'
        ? ['open', [url]]
        : ['xdg-open', [url]];

  try {
    const hijo = spawn(comando, args, { detached: true, stdio: 'ignore' });
    hijo.on('error', () => log.warn('No se pudo abrir el navegador automáticamente.'));
    hijo.unref();
    return true;
  } catch {
    return false;
  }
};

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

// Flujo device-code: el agente no tiene token todavía, así que pide un código,
// manda al humano al navegador, y espera. El verifier se queda en esta máquina
// y es lo que impide que quien vea el código en pantalla canjee el token.
const vincular = async (apiUrl) => {
  const verifier = crypto.randomBytes(32).toString('hex');
  const verifierHash = crypto.createHash('sha256').update(verifier).digest('hex');
  const vaults = detectarVaults();

  log.info(
    vaults.length > 0
      ? `Vaults de Obsidian detectados: ${vaults.map((v) => v.name).join(', ')}`
      : 'No se detectó ningún vault de Obsidian en este equipo.',
  );

  const inicio = await fetch(`${apiUrl}/api/pairing/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      verifier_hash: verifierHash,
      device_name: os.hostname(),
      vaults,
    }),
  });

  if (!inicio.ok) {
    const cuerpo = await inicio.text();
    throw new Error(`El servidor rechazó la solicitud de vinculación (${inicio.status}): ${cuerpo}`);
  }

  const { data } = await inicio.json();
  const expira = new Date(data.expires_at);

  log.info('');
  log.info('  Este equipo necesita vincularse a tu cuenta de Drivesidian.');
  log.info(`  Abriendo el navegador en: ${data.pair_url}`);
  log.info(`  Código: ${data.code}  (válido hasta las ${expira.toLocaleTimeString('es-MX')})`);
  log.info('');

  abrirNavegador(data.pair_url);

  // Polling hasta que el humano apruebe o el código caduque. El servidor tolera
  // unas 400 peticiones por código, de sobra para este intervalo.
  while (Date.now() < expira.getTime()) {
    await dormir(INTERVALO_POLLING_MS);

    let respuesta;
    try {
      respuesta = await fetch(
        `${apiUrl}/api/pairing/status?code=${encodeURIComponent(data.code)}`,
        { headers: { 'X-Pair-Verifier': verifier } },
      );
    } catch {
      // Sin red: se sigue intentando hasta que el código caduque.
      continue;
    }

    const cuerpo = await respuesta.json().catch(() => null);

    if (respuesta.status === 429) {
      // Se está sondeando más rápido de lo que el servidor tolera.
      await dormir(INTERVALO_POLLING_MS * 4);
      continue;
    }

    if (respuesta.status === 410) {
      throw new Error(cuerpo?.error?.message || 'El código de vinculación caducó.');
    }

    if (!respuesta.ok) {
      throw new Error(cuerpo?.error?.message || `Error ${respuesta.status} al consultar la vinculación.`);
    }

    if (cuerpo.data.status === 'pending') continue;

    // Aprobado: llega el token, y el vault que el usuario eligió en la web.
    const vaultPath = cuerpo.data.vault_path || (vaults.length === 1 ? vaults[0].path : null);
    if (!vaultPath) {
      throw new Error(
        'La vinculación se aprobó pero no se eligió ningún vault. Borra el config.json y vuelve a intentarlo.',
      );
    }

    config.guardar({ apiUrl, agentToken: cuerpo.data.token, vaultPath });
    log.info(`Equipo vinculado. Vigilando el vault: ${vaultPath}`);
    return { agentToken: cuerpo.data.token, vaultPath };
  }

  throw new Error('El código de vinculación caducó sin que nadie lo aprobara. Reinicia el agente.');
};

module.exports = { vincular, abrirNavegador };
