'use strict';

// El repo de GitHub es compartido por todos los usuarios, así que cada uno
// escribe dentro de su propia carpeta: user-<id>-<slug>/. El id garantiza la
// unicidad (dos personas pueden llamarse igual) y el slug la hace legible al
// navegar el repo. Este prefijo NO se guarda en notes.vault_path: se arma
// aquí, justo al momento de subir a GitHub.

const MAX_SLUG_LENGTH = 30;

// Del correo solo se usa la parte local, sin acentos y sin el dominio.
const slugFromEmail = (email) => {
  const localPart = String(email || '').split('@')[0];
  return localPart
    .normalize('NFD')                 // separa cada letra de su acento
    .replace(/[̀-ͯ]/g, '')  // y descarta los acentos sueltos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/, '');              // por si el corte dejó un guion colgando
};

// vault_path lo controla el agente, que corre en Windows, así que llega con
// separadores mezclados y podría traer ".." para salirse de la carpeta del
// usuario y escribir sobre las notas de otro.
const sanitizeVaultPath = (vaultPath) =>
  String(vaultPath || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((segment) => segment && segment !== '.' && segment !== '..')
    .join('/');

const buildRepoPath = (userId, email, vaultPath) => {
  const slug = slugFromEmail(email);
  const folder = slug ? `user-${userId}-${slug}` : `user-${userId}`;
  return `${folder}/${sanitizeVaultPath(vaultPath)}`;
};

module.exports = { slugFromEmail, sanitizeVaultPath, buildRepoPath };
