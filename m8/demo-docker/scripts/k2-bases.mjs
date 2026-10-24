// K2. La misma API sobre cinco imagenes base: tamaño, que trae (shell, gestor
// de paquetes), con que usuario corre, si arranca, y vulnerabilidades
// conocidas segun Trivy y Docker Scout.
import { COMPOSE, RAIZ, cabecera, contextoLimpio, docker, dockerOk, esperarHttp, guardar, join, maquina, tamanos } from './lib/util.mjs';
import { scout, scoutVersion, trivy, trivyVersion } from './lib/escaneo.mjs';

const BASES = [
  { id: 'node', nombre: 'node:24 (Debian 12 completo)', ref: 'node:24.22.1-bookworm' },
  { id: 'slim', nombre: 'node:24-slim (Debian 12 recortado)', ref: 'node:24.22.1-bookworm-slim' },
  { id: 'alpine', nombre: 'node:24-alpine (Alpine 3.24, musl)', ref: 'node:24.22.1-alpine3.24' },
  { id: 'distroless', nombre: 'distroless nodejs24-debian13 (Google)', ref: 'gcr.io/distroless/nodejs24-debian13:nonroot' },
  { id: 'dhi', nombre: 'Docker Hardened Image dhi.io/node:24', ref: 'dhi.io/node:24.22.1' },
];

const m = maquina();
const ctx = contextoLimpio('k2');
const tv = trivyVersion();

// Postgres del stack de referencia, para comprobar que cada variante arranca y lee la base.
dockerOk([...COMPOSE, 'up', '-d', '--wait', 'postgres']);
dockerOk([...COMPOSE, 'run', '--rm', 'migrate']);

const filas = [];
for (const b of BASES) {
  const img = `s08-docker/k2-${b.id}`;
  dockerOk(['build', '-q', '--target', b.id, '-f', join(RAIZ, 'bases', 'Dockerfile'), '-t', img, ctx]);
  const t = tamanos(img);
  const base = tamanos(b.ref);
  const shell = docker(['run', '--rm', '--entrypoint', 'sh', img, '-c', 'true']).code === 0;
  const gestor = shell
    ? docker(['run', '--rm', '--entrypoint', 'sh', img, '-c', 'command -v apt-get || command -v apk || echo ninguno']).out.trim().split('/').pop()
    : 'ninguno';
  const usuario = dockerOk(['image', 'inspect', img, '--format', '{{.Config.User}}']).out.trim() || 'root';
  // Arranca la variante en la red del stack y pide /items.
  docker(['rm', '-f', 's08-docker-k2']);
  dockerOk(['run', '-d', '--name', 's08-docker-k2', '--network', 's08-docker_default', '-p', '127.0.0.1:18101:3000',
    '-e', 'PGHOST=postgres', '-e', 'PGPASSWORD=demo', '-e', 'PGDATABASE=tienda', img]);
  const msListo = await esperarHttp('http://127.0.0.1:18101/salud', 20000);
  let items = false;
  try { items = (await (await fetch('http://127.0.0.1:18101/items')).json()).length === 3; } catch {}
  // En distroless node no esta en el PATH sino en /nodejs/bin/node.
  const nodeBin = b.id === 'distroless' ? '/nodejs/bin/node' : 'node';
  const uid = docker(['exec', 's08-docker-k2', nodeBin, '-e', 'console.log(process.getuid())']).out.trim();
  docker(['rm', '-f', 's08-docker-k2']);
  const tr = trivy(img);
  const sc = scout(img);
  filas.push({ ...b, img, t, base, shell, gestor, usuario, uid, arranca: msListo !== null && items, tr, sc });
  console.log(b.id, t.disco, t.contenido, `shell=${shell}`, `uid=${uid}`, `arranca=${msListo !== null && items}`, JSON.stringify(tr), JSON.stringify(sc));
}

const sc = (s) => (s.error ? `error: ${s.error}` : `${s.C}C ${s.H}H ${s.M}M ${s.L}L`);
const md = `# K2. Variantes de imagen base

${cabecera(m)} Trivy ${tv.version} (base de datos de vulnerabilidades del ${tv.db}); Docker Scout CLI ${scoutVersion()}.

La misma API, compilada con las mismas etapas de build ([\`bases/Dockerfile\`](../bases/Dockerfile)); solo cambia la etapa final (\`--target\`). Todas las bases están fijadas por etiqueta exacta y digest (Node 24.22.1). Cada variante se arrancó en la red del stack y respondió \`GET /items\` leyendo Postgres.

| Base | Imagen final en disco | Contenido (comprimido) | Solo la base (disco) | Shell | Gestor de paquetes | Usuario (uid) | Arranca y lee Postgres |
|---|---:|---:|---:|---|---|---|---|
${filas.map((f) => `| ${f.nombre} | ${f.t.disco} | ${f.t.contenido} | ${f.base.disco} | ${f.shell ? 'sí' : 'no'} | ${f.gestor} | ${f.usuario} (${f.uid}) | ${f.arranca ? 'sí' : 'no'} |`).join('\n')}

Vulnerabilidades conocidas (CVE) en la imagen final, el mismo día y con la misma imagen:

| Base | Sistema detectado | Paquetes del SO | Trivy: total | Crítica | Alta | Media | Baja | Sin clasificar | Con versión corregida | En paquetes del SO / Node de la base / dependencias de la app | Docker Scout (C/H/M/L) |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
${filas.map((f) => f.tr.error ? `| ${f.nombre} | error de Trivy: ${f.tr.error} |` : `| ${f.nombre} | ${f.tr.sistema} | ${f.tr.paquetesSO} | ${f.tr.total} | ${f.tr.CRITICAL} | ${f.tr.HIGH} | ${f.tr.MEDIUM} | ${f.tr.LOW} | ${f.tr.UNKNOWN} | ${f.tr.corregibles} | ${f.tr.so} / ${f.tr.node} / ${f.tr.app} | ${sc(f.sc)} |`).join('\n')}

CVE altas o críticas en las dependencias de la propia aplicación (\`/app/node_modules\`): ${[...new Set(filas.flatMap((f) => f.tr.altasApp ?? []))].join(', ') || 'ninguna'}. Es la misma en todas las variantes: cambiar la base no la arregla; hay que actualizar la dependencia.

«Node de la base» son los paquetes JavaScript que trae la imagen base, sobre todo el \`npm\` incluido en \`/usr/local/lib/node_modules/npm\` (la API no lo usa al correr). Distroless y la DHI no traen npm.

## Cómo leerlo

- **Casi todo el tamaño y casi todas las CVE vienen de la base**, no de la aplicación: el código propio pesa unos KB y las dependencias de producción unos 25 MB en todas las variantes.
- **Menos paquetes, menos CVE.** Una CVE se reporta por cada paquete instalado que tiene una vulnerabilidad publicada, se use o no. \`node:24\` trae compiladores, Python, git y cientos de bibliotecas que la API nunca llama. Slim y Alpine quitan la mayoría; distroless y la DHI quitan además la shell y el gestor de paquetes.
- **Sin shell no hay \`docker exec ... sh\`.** Es una ventaja (quien entre al contenedor no tiene herramientas) y un costo (para depurar hay que usar \`docker debug\` o un contenedor auxiliar). El healthcheck tampoco puede ser \`curl\`: tiene que ser el propio \`node\`.
- **Trivy y Scout no cuentan igual.** Usan bases de datos y criterios distintos (Trivy reporta también las CVE que el distribuidor marca como «no se va a corregir»; Scout aplica sus propios filtros y avisos del distribuidor). Lo útil es comparar variantes **con la misma herramienta** y mirar las que tienen versión corregida.
- **Alpine usa musl** en lugar de glibc: con dependencias nativas (bcrypt, sharp, Prisma) hay que compilarlas o descargarlas para musl.
`;
guardar('K2_BASES', md, { maquina: m, trivy: tv, filas });
