// K4. Secretos en la imagen: ARG y COPY .env (visibles para cualquiera que
// tenga la imagen) frente a RUN --mount=type=secret (no queda rastro).
// Los "secretos" son valores falsos generados para la demo.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { RAIZ, cabecera, contextoLimpio, docker, dockerOk, guardar, join, maquina, TMP } from './lib/util.mjs';
import { comoTar, entradas } from './lib/tar.mjs';

const m = maquina();
const ctx = contextoLimpio('k4');
const TOKEN = 'npm_K4tokenFALSOdeDemo0123456789';
const CLAVE_ENV = 'PGPASSWORD=clave-falsa-K4-en-.env';
writeFileSync(join(ctx, '.env'), `# archivo de configuracion local (falso, demo K4)\n${CLAVE_ENV}\n`);

const VARIANTES = [
  {
    id: 'mal', nombre: 'ARG NPM_TOKEN + COPY .env (y luego rm)', dockerfile: 'antes/Dockerfile.secreto',
    args: ['--build-arg', `NPM_TOKEN=${TOKEN}`], env: {},
  },
  {
    id: 'bien', nombre: 'RUN --mount=type=secret (sin .env en el contexto)', dockerfile: 'despues/Dockerfile.secreto',
    args: ['--secret', 'id=npm_token,env=NPM_TOKEN'], env: { NPM_TOKEN: TOKEN },
  },
];

// Busca el token y la clave del .env en todo lo que contiene "docker save":
// la configuracion de la imagen (historial) y cada capa (archivos).
function buscarEnImagen(img) {
  const tarPath = join(TMP, `k4-${img.replace(/\W/g, '_')}.tar`);
  dockerOk(['save', '-o', tarPath, img]);
  const hallazgos = [];
  for (const e of entradas(readFileSync(tarPath))) {
    if (e.tipo !== '0' && e.tipo !== '\0') continue;
    const capa = comoTar(e.datos);
    if (capa) {
      for (const f of entradas(capa)) {
        const txt = f.datos.toString('latin1');
        const base = f.nombre.split('/').pop();
        if (base === '.wh..env') hallazgos.push({ donde: `capa ${e.nombre.slice(-19)}`, archivo: f.nombre, contenido: '(marca de borrado: "rm .env" solo lo oculta en las capas de arriba)' });
        else if (base === '.env') hallazgos.push({ donde: `capa ${e.nombre.slice(-19)}`, archivo: f.nombre, contenido: f.datos.toString('utf8').trim() });
        else if (txt.includes(TOKEN) || txt.includes(CLAVE_ENV)) hallazgos.push({ donde: `capa ${e.nombre.slice(-19)}`, archivo: f.nombre, contenido: '(contiene el secreto)' });
      }
    } else {
      const txt = e.datos.toString('utf8');
      if (txt.includes(TOKEN)) hallazgos.push({ donde: `metadatos ${e.nombre.slice(-19)}`, archivo: '(configuración/historial de la imagen)', contenido: 'contiene el token' });
    }
  }
  rmSync(tarPath, { force: true });
  return hallazgos;
}

const filas = [];
for (const v of VARIANTES) {
  const img = `s08-docker/k4-${v.id}`;
  const b = docker(['build', '--progress=plain', ...v.args, '-f', join(RAIZ, v.dockerfile), '-t', img, ctx], { env: v.env });
  if (b.code !== 0) { console.error(b.err); throw new Error('build fallido'); }
  // Avisos de las comprobaciones de BuildKit (p. ej. SecretsUsedInArgOrEnv)
  const avisos = [...new Set((b.err.match(/^ - [^\n]+$/gm) ?? []).concat(b.err.match(/WARN: [^\n]+/g) ?? []))];
  const check = docker(['build', '--check', ...v.args, '-f', join(RAIZ, v.dockerfile), ctx], { env: v.env });
  const checkTxt = (check.out + check.err).split('\n').filter((l) => /WARN|Check complete|warning/i.test(l)).map((l) => l.trim()).filter(Boolean);
  const hist = dockerOk(['history', '--no-trunc', '--format', '{{.CreatedBy}}', img]).out;
  const lineaHist = hist.split('\n').find((l) => l.includes(TOKEN)) ?? null;
  const envImg = dockerOk(['image', 'inspect', img, '--format', '{{json .Config.Env}}']).out.trim();
  const enContenedor = docker(['run', '--rm', '--entrypoint', 'sh', img, '-c', 'ls /app/.env /app/.npmrc 2>&1; echo; printenv NPM_TOKEN || echo "(NPM_TOKEN no definido)"']).out.trim();
  const hallazgos = buscarEnImagen(img);
  filas.push({ ...v, img, avisos, checkTxt, lineaHist, envImg, enContenedor, hallazgos });
  console.log(v.id, 'historial:', !!lineaHist, 'hallazgos:', hallazgos.length);
}

// Lo mismo pasa en tiempo de ejecucion con variables de entorno: docker inspect las muestra.
docker(['rm', '-f', 's08-docker-k4']);
dockerOk(['run', '-d', '--name', 's08-docker-k4', '-e', 'PGPASSWORD=clave-falsa-K4-en-runtime', 's08-docker/k4-bien', 'node', '-e', 'setTimeout(()=>{}, 60000)']);
const inspectEnv = dockerOk(['inspect', 's08-docker-k4', '--format', '{{json .Config.Env}}']).out.trim();
docker(['rm', '-f', 's08-docker-k4']);

const md = `# K4. Secretos en la imagen

${cabecera(m)}

Dos Dockerfiles que necesitan un token para instalar dependencias desde un registro npm privado (ficticio: \`npm.ejemplo.invalid\`; npm lee \`\${NPM_TOKEN}\` del entorno en [\`api/npmrc.k4\`](../api/npmrc.k4)), y un \`.env\` local con una clave. Los valores son falsos: token \`${TOKEN}\`, clave \`${CLAVE_ENV}\`.

- **Mal** ([\`antes/Dockerfile.secreto\`](../antes/Dockerfile.secreto)): \`docker build --build-arg NPM_TOKEN=...\`, y \`COPY .env\` seguido de \`RUN rm .env\`; sin \`.dockerignore\`.
- **Bien** ([\`despues/Dockerfile.secreto\`](../despues/Dockerfile.secreto)): \`NPM_TOKEN=... docker build --secret id=npm_token,env=NPM_TOKEN\` y \`RUN --mount=type=secret,id=npm_token,env=NPM_TOKEN npm ci ...\`; el \`.dockerignore\` excluye \`.env\`.

Para buscar el secreto se exportó cada imagen con \`docker save\` (lo que recibe cualquiera que haga \`docker pull\`) y se recorrieron sus metadatos y todas sus capas.

| | ${filas.map((f) => f.nombre).join(' | ')} |
|---|---|---|
| ¿El token aparece en \`docker history --no-trunc\`? | ${filas.map((f) => (f.lineaHist ? '**sí**' : 'no')).join(' | ')} |
| ¿Aparece en \`Config.Env\` de la imagen? | ${filas.map((f) => (f.envImg.includes(TOKEN) ? 'sí' : 'no')).join(' | ')} |
| ¿\`/app/.env\` existe en un contenedor nuevo? | ${filas.map((f) => (/No such file|cannot access/.test(f.enContenedor.split('\n')[0]) ? 'no' : 'sí')).join(' | ')} |
| Hallazgos al recorrer \`docker save\` | ${filas.map((f) => f.hallazgos.length).join(' | ')} |
| Avisos de BuildKit (\`docker build --check\`) | ${filas.map((f) => (f.checkTxt.filter((l) => /WARN/i.test(l)).join('<br>') || 'ninguno')).join(' | ')} |

Línea del historial de la imagen «mal» (es lo que ve cualquiera con \`docker history --no-trunc\`):

\`\`\`
${(filas[0].lineaHist ?? '(no apareció)').trim()}
\`\`\`

Lo encontrado dentro de la imagen «mal» al recorrer sus capas:

${filas[0].hallazgos.map((h) => `- ${h.donde}, \`${h.archivo}\`: ${h.contenido.includes('\n') || h.contenido.length > 80 ? '\n\n  ```\n  ' + h.contenido.replace(/\n/g, '\n  ') + '\n  ```' : h.contenido.startsWith('(') || h.contenido.startsWith('contiene') ? h.contenido : '`' + h.contenido + '`'}`).join('\n')}

Imagen «bien»: ${filas[1].hallazgos.length === 0 ? 'ningún rastro del token ni de la clave en metadatos ni capas.' : filas[1].hallazgos.map((h) => `${h.donde} ${h.archivo}`).join('; ')}

En tiempo de ejecución pasa algo parecido con las variables de entorno: \`docker run -e PGPASSWORD=...\` deja la clave en la configuración del contenedor, y \`docker inspect\` la muestra a quien tenga acceso al demonio:

\`\`\`
${inspectEnv}
\`\`\`

## Por qué

- **\`ARG\` no es secreto.** BuildKit guarda en el historial de la imagen cada \`RUN\` con los valores de los \`ARG\` que usa (\`|1 NPM_TOKEN=...\`), para que el build sea reproducible. El historial viaja con la imagen.
- **Borrar en otra capa no borra.** Cada instrucción agrega una capa encima de las anteriores; \`RUN rm .env\` agrega una marca de borrado (un archivo \`.wh..env\`) que oculta el archivo en el sistema de archivos del contenedor, pero la capa del \`COPY\` sigue dentro de la imagen con el archivo completo.
- **\`--mount=type=secret\`** monta el secreto solo mientras corre ese \`RUN\` (como archivo en \`/run/secrets/\` o, con \`env=\`, como variable de entorno del comando). No forma parte de ninguna capa ni del historial, y la caché no depende de su valor.
- **El \`.dockerignore\`** es la primera barrera: lo que no entra al contexto de build no puede terminar en la imagen.
- **En ejecución**, las claves llegan al contenedor desde fuera (Compose, el orquestador o un gestor de secretos), nunca dentro de la imagen; montarlas como archivo (\`secrets:\` de Compose, \`POSTGRES_PASSWORD_FILE\`) evita que aparezcan en \`docker inspect\`.
`;
guardar('K4_SECRETOS', md, { maquina: m, filas, inspectEnv });
