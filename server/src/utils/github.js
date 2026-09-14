'use strict';

// Cliente mínimo de la Contents API de GitHub con fetch nativo — sin
// librerías de git, por decisión del proyecto. El repo es compartido para
// todos los usuarios (rutas por usuario dentro del mismo repo).

const GITHUB_API = 'https://api.github.com';

const githubHeaders = () => ({
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  // GitHub rechaza requests sin User-Agent con 403.
  'User-Agent': 'drivesidian-server',
});

// Cada segmento de la ruta se codifica por separado para no romper los "/"
// de una ruta anidada (ej. "Drivesidian/idea.md").
const encodePath = (path) => path.split('/').map(encodeURIComponent).join('/');

const contentsUrl = (path) => {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  return `${GITHUB_API}/repos/${owner}/${repo}/contents/${encodePath(path)}`;
};

// GitHub exige el sha del archivo actual para poder actualizarlo (si no
// existe, no se manda sha y la API lo crea).
const getFileSha = async (path) => {
  const response = await fetch(contentsUrl(path), { headers: githubHeaders() });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`GitHub GET contents falló (${response.status}): ${await response.text()}`);
  }
  const data = await response.json();
  return data.sha;
};

// Crea o actualiza un archivo en un solo commit.
const putFile = async (path, content, message) => {
  const sha = await getFileSha(path);

  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    ...(sha ? { sha } : {}),
  };

  const response = await fetch(contentsUrl(path), {
    method: 'PUT',
    headers: { ...githubHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`GitHub PUT contents falló (${response.status}): ${await response.text()}`);
  }

  return response.json();
};

module.exports = { putFile, encodePath };
