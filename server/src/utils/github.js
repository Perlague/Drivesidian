'use strict';

// Cliente de la Git Data API de GitHub con fetch nativo — sin librerías de
// git, por decisión del proyecto.
//
// Se usa la Git Data API y NO la Contents API porque esta última crea un
// commit por archivo: no puede agrupar un lote, que es justo lo que el
// diseño pide. Con la Git Data API el costo es de 5 llamadas por lote sin
// importar si lleva 1 nota o 200, lo que además cuida el rate limit del PAT,
// que es compartido por todos los usuarios.

const GITHUB_API = 'https://api.github.com';
const FILE_MODE = '100644'; // archivo normal: ni ejecutable ni symlink
const MAX_REF_ATTEMPTS = 3;

class GitHubError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
  }
}

const branchName = () => process.env.GITHUB_BRANCH || 'main';

// Cada segmento se codifica por separado para no romper los "/" de una rama
// anidada como "feature/algo".
const encodeSegments = (path) => path.split('/').map(encodeURIComponent).join('/');

const githubHeaders = () => ({
  Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
  // GitHub rechaza requests sin User-Agent con 403.
  'User-Agent': 'drivesidian-server',
});

const ghFetch = (method, suffix, body) => {
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  return fetch(`${GITHUB_API}/repos/${owner}/${repo}${suffix}`, {
    method,
    headers: {
      ...githubHeaders(),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
};

const ghJson = async (method, suffix, body) => {
  const response = await ghFetch(method, suffix, body);
  if (!response.ok) {
    throw new GitHubError(
      `GitHub ${method} ${suffix} falló (${response.status}): ${await response.text()}`,
      response.status,
    );
  }
  return response.json();
};

// Devuelve el commit y el árbol en la punta de la rama, o null si el repo
// todavía no tiene ningún commit (repo recién creado, sin README).
const readBranchHead = async () => {
  const response = await ghFetch('GET', `/git/ref/heads/${encodeSegments(branchName())}`);
  // Los dos significan «no hay punta de rama», y GitHub los distingue:
  //   404 -> el repo tiene commits, pero no esta rama.
  //   409 -> el repo no tiene NINGÚN commit («Git Repository is empty»).
  // El 409 es justo el de un repo recién creado sin README, que es el caso
  // normal al desplegar por primera vez. Tratarlo como error dejaba el lote
  // fallando en cada ciclo del worker, con las notas atascadas en `pending`
  // para siempre. Verificado contra un repo vacío real.
  if (response.status === 404 || response.status === 409) return null;
  if (!response.ok) {
    throw new GitHubError(
      `GitHub GET ref falló (${response.status}): ${await response.text()}`,
      response.status,
    );
  }

  const ref = await response.json();
  const commit = await ghJson('GET', `/git/commits/${ref.object.sha}`);
  return { commitSha: ref.object.sha, treeSha: commit.tree.sha };
};

const README_INICIAL = [
  '# Notas de Drivesidian',
  '',
  'Este repositorio lo escribe el servidor de Drivesidian. Cada usuario tiene',
  'su propia carpeta `user-<id>-<slug>/`.',
  '',
  'No edites nada a mano: el servidor sube por lotes sobre la punta de la rama,',
  'y un commit directo aquí obliga a rearmar el lote que estuviera en curso.',
  '',
].join('\n');

// **En un repo sin NINGÚN commit la Git Data API entera no existe**: /git/refs,
// /git/trees y /git/commits responden 409 «Git Repository is empty». No hay base
// de datos de git que tocar hasta que exista un primer commit.
//
// La Contents API sí funciona ahí, y crea ese commit inicial. Se usa **una sola
// vez, para sembrar la rama**; a partir de ese momento todo vuelve a ir por la
// Git Data API. Esto no contradice la decisión de no usar la Contents API para
// los lotes —sigue siendo un commit por archivo y sigue sin poder agrupar—:
// aquí no se está subiendo un lote, se está inicializando el repositorio.
//
// Sin esto, un repo privado recién creado —que es justo lo que pide la guía de
// despliegue— deja al worker fallando en cada ciclo y a las notas atascadas en
// `pending` para siempre.
const sembrarRepoVacio = async () => {
  await ghJson('PUT', `/contents/${encodeSegments('README.md')}`, {
    message: 'Inicializa el repositorio de notas',
    content: Buffer.from(README_INICIAL, 'utf8').toString('base64'),
    branch: branchName(),
  });
};

// Sube un lote completo en UN SOLO commit.
// files: [{ path, content }] — el contenido va inline en el árbol, así que no
// hacen falta blobs aparte (la API solo acepta texto UTF-8 así, que es lo que
// son las notas; un adjunto binario necesitaría crear el blob en base64).
const putBatch = async (files, message) => {
  if (files.length === 0) return null;

  for (let attempt = 1; attempt <= MAX_REF_ATTEMPTS; attempt += 1) {
    let head = await readBranchHead();

    if (!head) {
      await sembrarRepoVacio();
      // Se relee en vez de dar por hecha la punta: el commit inicial lo hizo
      // otra API y queremos el sha y el árbol tal como quedaron.
      head = await readBranchHead();
    }

    const tree = await ghJson('POST', '/git/trees', {
      // base_tree hereda todo lo que ya existe en el repo: solo se
      // sobrescriben las rutas que van en este lote, no se borra nada.
      ...(head ? { base_tree: head.treeSha } : {}),
      tree: files.map(({ path, content }) => ({
        path,
        mode: FILE_MODE,
        type: 'blob',
        content,
      })),
    });

    const commit = await ghJson('POST', '/git/commits', {
      message,
      tree: tree.sha,
      parents: head ? [head.commitSha] : [],
    });

    // Si el repo estaba vacío no hay ref que mover: hay que crearlo.
    const updated = await (head
      ? ghFetch('PATCH', `/git/refs/heads/${encodeSegments(branchName())}`, { sha: commit.sha })
      : ghFetch('POST', '/git/refs', { ref: `refs/heads/${branchName()}`, sha: commit.sha }));

    if (updated.ok) {
      return { commitSha: commit.sha, files: files.length };
    }

    // 422 = la rama se movió mientras armábamos el commit (otro lote, o
    // alguien commiteando directo en el repo). El árbol que construimos
    // colgaba de un padre que ya no es la punta, así que hay que releer el
    // ref y rearmar todo desde cero.
    if (updated.status !== 422 || attempt === MAX_REF_ATTEMPTS) {
      throw new GitHubError(
        `GitHub actualización del ref falló (${updated.status}): ${await updated.text()}`,
        updated.status,
      );
    }
  }

  return null;
};

module.exports = { putBatch, readBranchHead, encodeSegments, GitHubError };
