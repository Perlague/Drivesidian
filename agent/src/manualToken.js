'use strict';

// Vinculación manual: para cuando el navegador no se puede abrir (servidor sin
// escritorio, sesión remota) o el flujo automático falla. Se genera el acceso en
// el panel web (Configuración → «Generar acceso manual») y se pega aquí.
//
//   pnpm run token
//
// El token se pide por entrada estándar y no como argumento: los argumentos de
// un proceso los ve cualquiera que liste procesos en la máquina.

const readline = require('readline');
const log = require('./log');
const config = require('./config');
const { detectarVaults } = require('./vaultDetect');

const preguntar = (texto) =>
  new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(texto, (r) => {
      rl.close();
      resolve(r.trim());
    });
  });

const main = async () => {
  const { apiUrl } = config.cargar();
  console.log(`Servidor: ${apiUrl}`);

  const token = await preguntar('Pega el acceso generado en el panel web: ');
  if (!token) throw new Error('No se recibió ningún acceso.');

  // Se comprueba antes de guardar: un token mal copiado dejaría al agente en un
  // bucle de 401.
  const respuesta = await fetch(`${apiUrl}/api/notes?limit=1`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!respuesta.ok) {
    throw new Error(`El servidor rechazó el acceso (${respuesta.status}). Revisa que esté completo y no revocado.`);
  }

  const vaults = detectarVaults();
  let vaultPath = vaults[0]?.path || null;
  if (vaults.length > 1) {
    vaults.forEach((v, i) => console.log(`  ${i + 1}. ${v.name}  (${v.path})`));
    const n = Number(await preguntar(`¿Qué vault vigilar? [1-${vaults.length}] (1): `)) || 1;
    vaultPath = vaults[Math.min(Math.max(n, 1), vaults.length) - 1].path;
  }
  if (!vaultPath) {
    vaultPath = await preguntar('No se detectó Obsidian. Ruta completa del vault: ');
  }

  config.guardar({ agentToken: token, vaultPath });
  log.info(`Equipo vinculado a mano. Vault: ${vaultPath}`);
  console.log('Listo. Inicia el agente (o cierra sesión y vuelve a entrar).');
};

main().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
