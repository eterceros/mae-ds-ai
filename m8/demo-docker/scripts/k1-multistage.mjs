// K1. Imagen ingenua frente a multi-stage: tamaño, capas y tiempo de build
// en frio (--no-cache) y con cache (sin cambios, y con un cambio en src/).
import { appendFileSync } from 'node:fs';
import {
  COMPOSE, RAIZ,
  RONDAS, cabecera, contextoLimpio, docker, dockerOk, guardar, join, maquina, mediana, rango, seg, tamanos,
} from './lib/util.mjs';

const VARIANTES = [
  { id: 'ingenuo', nombre: 'Ingenua (node:24, una etapa, COPY . . antes de npm install)', dockerfile: 'antes/Dockerfile' },
  { id: 'multistage', nombre: 'Multi-stage de referencia (slim, package*.json primero)', dockerfile: 'despues/Dockerfile' },
];

const ctx = contextoLimpio('k1');
const m = maquina();

function build(v, extra = []) {
  const r = docker(['build', '--progress=plain', ...extra, '-f', join(RAIZ, v.dockerfile), '-t', `s08-docker/k1-${v.id}`, ctx]);
  if (r.code !== 0) { console.error(r.err); throw new Error('build fallido'); }
  // ¿Se reinstalaron dependencias? Busca los pasos "npm install"/"npm ci" y si quedaron CACHED.
  const log = r.err;
  const pasos = [...log.matchAll(/^#(\d+) \[[^\]]+\] RUN (.*npm (?:install|ci).*)$/gm)];
  const reinstalo = pasos.some(([, id]) => !new RegExp(`^#${id} CACHED`, 'm').test(log));
  const cacheados = (log.match(/^#\d+ CACHED$/gm) ?? []).length;
  return { ms: r.ms, reinstalo, cacheados };
}

const res = Object.fromEntries(VARIANTES.map((v) => [v.id, { frio: [], igual: [], cambio: [], reinstaloCambio: [] }]));
let n = 0;
for (let ronda = 1; ronda <= RONDAS; ronda++) {
  for (const v of VARIANTES) {
    const f = build(v, ['--no-cache']);
    const i = build(v);
    appendFileSync(join(ctx, 'src', 'main.ts'), `\n// cambio de prueba ${++n}\n`);
    const c = build(v);
    res[v.id].frio.push(f.ms); res[v.id].igual.push(i.ms); res[v.id].cambio.push(c.ms);
    res[v.id].reinstaloCambio.push(c.reinstalo);
    console.log(`ronda ${ronda} ${v.id}: frio ${seg(f.ms)} s, sin cambios ${seg(i.ms)} s, cambio en src ${seg(c.ms)} s (reinstalo deps: ${c.reinstalo})`);
  }
}

// Que hay dentro de cada imagen (se inspecciona como root solo para poder leer todo).
function contenido(img) {
  const script = [
    'echo "deps=$(ls node_modules | wc -l)"',
    'echo "nm_mb=$(du -sm node_modules | cut -f1)"',
    'echo "ts=$(test -d node_modules/typescript && echo si || echo no)"',
    'echo "cli=$(test -d node_modules/@nestjs/cli && echo si || echo no)"',
    'echo "src=$(test -d src && echo si || echo no)"',
    'echo "npmcache_mb=$( (du -sm /root/.npm 2>/dev/null || echo 0) | cut -f1)"',
    'echo "user=$(id -un)"',
  ].join('; ');
  const r = dockerOk(['run', '--rm', '--user', 'root', '--entrypoint', 'sh', img, '-c', script]);
  return Object.fromEntries(r.out.trim().split('\n').map((l) => l.split('=')).map(([k, x]) => [k, x === 'si' ? 'sí' : x]));
}
function usuarioConfigurado(img) {
  return dockerOk(['image', 'inspect', img, '--format', '{{.Config.User}}']).out.trim() || 'root (sin USER)';
}

const filas = VARIANTES.map((v) => {
  const img = `s08-docker/k1-${v.id}`;
  return { ...v, t: tamanos(img), c: contenido(img), user: usuarioConfigurado(img), r: res[v.id] };
});

const hist = dockerOk(['history', '--format', '{{.Size}}\t{{.CreatedBy}}', 's08-docker/k1-ingenuo']).out
  .trim().split('\n').slice(0, 6).map((l) => `${l.split('\t')[0].padStart(8)}  ${l.split('\t')[1].slice(0, 110)}`).join('\n');
const histRef = dockerOk(['history', '--format', '{{.Size}}\t{{.CreatedBy}}', 's08-docker/k1-multistage']).out
  .trim().split('\n').slice(0, 7).map((l) => `${l.split('\t')[0].padStart(8)}  ${l.split('\t')[1].slice(0, 110)}`).join('\n');

const md = `# K1. Imagen ingenua frente a multi-stage

${cabecera(m)}

La misma API NestJS (\`api/\`) con dos Dockerfiles: [\`antes/Dockerfile\`](../antes/Dockerfile) y [\`despues/Dockerfile\`](../despues/Dockerfile).
Contexto de build: una copia limpia de \`api/\` sin \`node_modules\` ni \`dist\`. ${RONDAS} rondas; cada cifra es la mediana y, entre paréntesis, el rango.

- **Frío:** \`docker build --no-cache\` (no usa ninguna capa guardada; las imágenes base ya estaban descargadas, así que no cuenta la descarga de la base; sí cuenta bajar los paquetes de npm desde internet).
- **Sin cambios:** el mismo build otra vez (todas las capas salen de la caché).
- **Cambio en src/:** se agrega una línea de comentario a \`src/main.ts\` y se vuelve a construir.

| Variante | Tamaño en disco | Contenido (comprimido) | Capas | Frío (s) | Sin cambios (s) | Cambio en src/ (s) | ¿Reinstala dependencias al cambiar src/? |
|---|---:|---:|---:|---:|---:|---:|---|
${filas.map((f) => `| ${f.nombre} | ${f.t.disco} | ${f.t.contenido} | ${f.t.capas} | ${seg(mediana(f.r.frio))} (${rango(f.r.frio.map((x) => x / 1000))}) | ${seg(mediana(f.r.igual))} (${rango(f.r.igual.map((x) => x / 1000))}) | ${seg(mediana(f.r.cambio))} (${rango(f.r.cambio.map((x) => x / 1000))}) | ${f.r.reinstaloCambio.every(Boolean) ? 'sí, en las ' + RONDAS + ' rondas' : f.r.reinstaloCambio.some(Boolean) ? 'a veces' : 'no'} |`).join('\n')}

Qué hay dentro de cada imagen final:

| Variante | Paquetes en node_modules | node_modules (MB) | typescript | @nestjs/cli | src/ (TypeScript) | caché de npm en /root/.npm (MB) | Usuario configurado |
|---|---:|---:|---|---|---|---:|---|
${filas.map((f) => `| ${f.id} | ${f.c.deps} | ${f.c.nm_mb} | ${f.c.ts} | ${f.c.cli} | ${f.c.src} | ${f.c.npmcache_mb} | ${f.user} |`).join('\n')}

Capas más recientes de la imagen ingenua (\`docker image history\`, tamaño y comando):

\`\`\`
${hist}
\`\`\`

Capas de la imagen multi-stage (todas estas son propias; debajo están las de la base slim):

\`\`\`
${histRef}
\`\`\`

## Por qué

- **Tamaño.** La ingenua parte de \`node:24\` (Debian completo con compiladores, Python, git: ${tamanos('node:24.22.1-bookworm').disco} en disco) y conserva todo lo que usó para compilar: dependencias de desarrollo, TypeScript, el código fuente y la caché de npm. La multi-stage compila en una etapa y copia a la final solo \`dist/\` y las dependencias de producción, sobre \`node:24-slim\` (${tamanos('node:24.22.1-bookworm-slim').disco}).
- **Caché.** Docker reutiliza una capa si la instrucción y los archivos que copia no cambiaron, y a partir de la primera capa que cambia reconstruye todo lo que sigue. En la ingenua \`COPY . .\` va antes de \`npm install\`: tocar una línea de \`src/\` invalida esa copia y obliga a reinstalar todo. En la multi-stage se copian primero \`package.json\` y \`package-lock.json\`, se instala, y después se copia \`src/\`: un cambio de código solo repite la compilación.
- **Frío.** Sin caché las dos variantes descargan paquetes de npm; la multi-stage ejecuta \`npm ci\` dos veces (todas las dependencias para compilar y solo las de producción para la imagen final), en etapas que BuildKit corre en paralelo.
`;
guardar('K1_MULTISTAGE', md, { maquina: m, filas });
