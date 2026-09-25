'use strict';

const { execFileSync } = require('child_process');
const log = require('./log');

// Cifrado del agent token en disco, con DPAPI (la API de protección de datos
// de Windows). La llave la deriva el sistema de las credenciales de la cuenta:
// no hay nada que el agente tenga que guardar.
//
// Por qué no una llave o un salt propios: si el agente los guardara en otro
// archivo de la misma máquina, quien pudo leer el config.json leería también
// ese. Solo movería el problema un paso. La protección tiene que venir de que
// la llave la custodie el sistema operativo.
//
// Protege contra que el ARCHIVO viaje: copiado a otra máquina, arrastrado en
// un respaldo, sincronizado a la nube, o leído por otra cuenta del equipo. En
// todos esos casos el blob es inútil.
//
// NO protege contra malware corriendo como el usuario, que puede llamar a la
// misma API. Eso queda fuera del modelo de amenazas del proyecto.
//
// Se usa PowerShell y no un módulo nativo a propósito: un binario compilado
// chocaría con el instalador, que empaqueta node_modules resuelto para un ABI
// concreto.

const PROTEGER = `
Add-Type -AssemblyName System.Security
$claro = [Console]::In.ReadToEnd()
$bytes = [Text.Encoding]::UTF8.GetBytes($claro)
[Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser'))
`;

const DESPROTEGER = `
Add-Type -AssemblyName System.Security
$b64 = [Console]::In.ReadToEnd()
$bytes = [Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($b64), $null, 'CurrentUser')
[Text.Encoding]::UTF8.GetString($bytes)
`;

// El dato va por stdin y NUNCA como argumento: los argumentos de un proceso
// son visibles para cualquiera que liste procesos en la máquina, así que
// pasarlo por la línea de comandos filtraría justo lo que se intenta proteger.
const powershell = (script, entrada) =>
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    input: entrada,
    windowsHide: true,
    // stderr capturado y no heredado: un fallo de descifrado es esperable —un
    // blob de otra máquina— y aquí ya se traduce a un mensaje claro. Sin esto,
    // PowerShell vuelca su excepción completa al log del agente y entierra el
    // aviso útil bajo un stack trace de .NET.
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();

const disponible = () => process.platform === 'win32';

// Devuelve el blob en base64, o null si no se pudo cifrar. Que no se pueda no
// es motivo para dejar al usuario sin sincronización: se guarda en claro y se
// avisa fuerte, que es exactamente lo que hacía antes de existir esto.
const cifrar = (claro) => {
  if (!disponible()) return null;

  try {
    return powershell(PROTEGER, claro);
  } catch (err) {
    log.error(`No se pudo cifrar el acceso en disco (${err.message.split('\n')[0]}).`);
    log.error('Se guardará en texto plano. Cualquiera que copie el config.json podrá usarlo.');
    return null;
  }
};

// Devuelve el texto claro, o null si el blob no es de esta cuenta o esta
// máquina. Ese null hace que el agente lo trate como «sin token» y se vuelva a
// vincular: degradación limpia y sin intervención.
const descifrar = (blob) => {
  if (!disponible()) return null;

  try {
    return powershell(DESPROTEGER, blob);
  } catch {
    log.warn('El acceso guardado no se pudo descifrar: viene de otra cuenta o de otro equipo.');
    return null;
  }
};

module.exports = { cifrar, descifrar, disponible };
