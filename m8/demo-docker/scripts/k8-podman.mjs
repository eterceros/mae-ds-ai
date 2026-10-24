// K8. El mismo stack de despues/ con Podman (rootless): build, "podman compose"
// con los dos proveedores (docker-compose y podman-compose), orden de arranque,
// migracion rota, usuario dentro y fuera del contenedor y tiempo hasta /salud.
//
// Requisitos: Podman con su maquina encendida (Windows/macOS: "podman machine start").
// Variables opcionales:
//   PODMAN          ruta del ejecutable (por defecto "podman", o la ruta de instalacion en Windows)
//   PODMAN_COMPOSE  ejecutable de podman-compose; si no esta, se intenta con "uvx" (uv)
//   RONDAS          corridas de arranque por proveedor (por defecto 3)
//   K8_DOCKER=0     no medir la referencia con Docker
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join } from 'node:path';
import { comoTar, entradas } from './lib/tar.mjs';
import { RAIZ, TMP, docker, esperarHttp, espera, guardar, maquina, mediana, rango, sh } from './lib/util.mjs';

const N = Number(process.env.RONDAS ?? 3);
const WIN = process.platform === 'win32';
const PODMAN = process.env.PODMAN
  ?? (WIN && existsSync('C:\\Program Files\\RedHat\\Podman\\podman.exe') ? 'C:\\Program Files\\RedHat\\Podman\\podman.exe' : 'podman');
const PROYECTO = 's08-podman';
const IMAGEN = 's08-podman/api:local';
// Puertos propios (18150-18199) para no chocar con el stack de Docker (18100/18132).
const P_API = 18150, P_PG = 18151;
const SALUD = `http://127.0.0.1:${P_API}/salud`;
const DIR = join(TMP, 'k8');
mkdirSync(DIR, { recursive: true });

const podman = (args, opts) => sh(PODMAN, args, opts);
const podmanOk = (args, opts) => {
  const r = podman(args, opts);
  if (r.code !== 0) { console.error(r.out, r.err); throw new Error(`fallo: podman ${args.join(' ')}`); }
  return r;
};

// 1) Copia de despues/compose.yaml con SOLO cuatro cambios, todos para convivir
// con la demo de Docker en la misma maquina (ninguno lo pide Podman): nombre del
// proyecto, puertos, etiqueta de la imagen y la ruta del contexto (la copia vive
// en .tmp/k8/). Se imprime el diff en el resultado.
const original = readFileSync(join(RAIZ, 'despues', 'compose.yaml'), 'utf8');
const cambios = [
  ['name: s08-docker', `name: ${PROYECTO}`],
  ['"127.0.0.1:18132:5432"', `"127.0.0.1:${P_PG}:5432"`],
  ['"127.0.0.1:18100:3000"', `"127.0.0.1:${P_API}:3000"`],
  ['image: s08-docker/api:local', `image: ${IMAGEN}`],
  ['context: ../api', 'context: ../../api'],
];
let copia = original;
for (const [a, b] of cambios) {
  if (!copia.includes(a)) throw new Error(`no se encontro "${a}" en despues/compose.yaml`);
  copia = copia.replaceAll(a, b);
}
const COMPOSE = join(DIR, 'compose.yaml');
writeFileSync(COMPOSE, copia);
// El override de la migracion rota (K6) monta una carpeta: se ajusta la ruta relativa.
const FALLA = join(DIR, 'compose.migracion-con-error.yaml');
writeFileSync(FALLA, readFileSync(join(RAIZ, 'despues', 'compose.migracion-con-error.yaml'), 'utf8')
  .replace('./migraciones-con-error', '../../despues/migraciones-con-error'));

// 2) Proveedores de "podman compose". Sin PODMAN_COMPOSE_PROVIDER, podman usa
// docker-compose si lo encuentra (p. ej. el de Docker Desktop) y si no podman-compose.
function proveedorPodmanCompose() {
  if (process.env.PODMAN_COMPOSE) return { ruta: process.env.PODMAN_COMPOSE, via: 'PODMAN_COMPOSE' };
  if (sh('uvx', ['--version']).code !== 0) return null;
  // Envoltorio que corre podman-compose 1.6.0 con uvx (entorno efimero, sin instalar nada global).
  const dirPodman = PODMAN.includes('\\') ? PODMAN.slice(0, PODMAN.lastIndexOf('\\')) : null;
  if (WIN) {
    const ruta = join(DIR, 'podman-compose.cmd');
    writeFileSync(ruta, ['@echo off', dirPodman ? `set "PATH=${dirPodman};%PATH%"` : '',
      'uvx --quiet --from podman-compose==1.6.0 podman-compose %*', ''].join('\r\n'));
    return { ruta, via: 'uvx --from podman-compose==1.6.0' };
  }
  const ruta = join(DIR, 'podman-compose.sh');
  writeFileSync(ruta, '#!/bin/sh\nexec uvx --quiet --from podman-compose==1.6.0 podman-compose "$@"\n');
  chmodSync(ruta, 0o755);
  return { ruta, via: 'uvx --from podman-compose==1.6.0' };
}

const PROVEEDORES = [{ id: 'docker-compose', env: {} }];
const pc = proveedorPodmanCompose();
if (pc) PROVEEDORES.push({ id: 'podman-compose', env: { PODMAN_COMPOSE_PROVIDER: pc.ruta }, via: pc.via });

// Ejecuta un comando sin bloquear (para medir /salud mientras "up" sigue corriendo).
function lanzar(cmd, args, env) {
  return new Promise((res) => {
    const t0 = Date.now();
    const p = spawn(cmd, args, { cwd: RAIZ, env: { ...process.env, ...env } });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (out += d));
    p.on('close', (code) => res({ code, out, ms: Date.now() - t0 }));
  });
}

// Corre "<compose> <args>" con el comando base dc = [ejecutable, [args base]].
const dcRun = (dc, args, env) => lanzar(dc[0], [...dc[1], ...args], env);

// Eventos de Podman de los contenedores del proyecto desde un instante (ms).
function eventos(desdeMs) {
  const r = podman(['events', '--since', String(Math.floor(desdeMs / 1000) - 1), '--until', '0s', '--format', 'json']);
  return r.out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    .filter((e) => e.Type === 'container' && /^s08-podman[-_]/.test(e.Name ?? '') && e.timeNano / 1e6 >= desdeMs - 50)
    .map((e) => ({ t: e.timeNano / 1e6, servicio: e.Name.replace(/^s08-podman[-_]/, '').replace(/[-_]1$/, ''), estado: e.Status, salud: e.health_status ?? e.HealthStatus }));
}
const contenedor = (servicio) => {
  const r = podman(['ps', '-a', '--filter', `name=^s08-podman[-_]${servicio}[-_]1$`, '--format', '{{.Names}}']);
  return r.out.trim().split('\n')[0] || null;
};
function estado(servicio) {
  const n = contenedor(servicio);
  if (!n) return { existe: false };
  const j = JSON.parse(podmanOk(['inspect', n]).out)[0];
  return { existe: true, nombre: n, estado: j.State.Status, codigo: j.State.ExitCode, inicio: j.State.StartedAt?.startsWith('0001') ? null : j.State.StartedAt };
}

// Corrida de arranque: down -v, "up -d" y espera a /salud. Devuelve tiempos y orden.
async function arranque(dc, env) {
  await dcRun(dc, ['down', '-v'], env);
  const t0 = Date.now();
  const up = dcRun(dc, ['up', '-d'], env);
  const salud = await esperarHttp(SALUD, 120000);
  const fin = await up;
  let items = null;
  try { items = (await (await fetch(`http://127.0.0.1:${P_API}/items`)).json()).length; } catch {}
  await espera(1500); // que lleguen los eventos
  const ev = eventos(t0);
  const primero = (s, st, salud) => ev.find((e) => e.servicio === s && e.estado === st && (!salud || e.salud === salud))?.t;
  const pgSano = primero('postgres', 'health_status', 'healthy');
  const migInicios = ev.filter((e) => e.servicio === 'migrate' && e.estado === 'start').map((e) => e.t);
  const migFin = ev.find((e) => e.servicio === 'migrate' && e.estado === 'died')?.t;
  const apiInicio = primero('api', 'start');
  const rel = (t) => (t ? (t - t0) / 1000 : null);
  return {
    up: fin.code, upMs: fin.ms, saludMs: salud === null ? null : salud, items,
    pgInicio: rel(primero('postgres', 'start')), pgSano: rel(pgSano), migInicio: rel(migInicios[0]), migFin: rel(migFin), apiInicio: rel(apiInicio),
    migArranques: migInicios.length,
    orden: !!(pgSano && migInicios[0] && apiInicio && migInicios[0] >= pgSano && apiInicio >= migFin),
    salidaUp: fin.out,
  };
}

async function migracionRota(dc, env) {
  const dcf = [dc[0], ['compose', '-f', COMPOSE, '-f', FALLA, '-p', PROYECTO]];
  await dcRun(dc, ['down', '-v'], env);
  const up = await dcRun(dcf, ['up', '-d'], env);
  await espera(8000); // margen: que nada arranque la API tarde
  const r = {
    up: up.code, salida: up.out.trim().split('\n').filter((l) => /migrate|error|exit|depend/i.test(l)).slice(-4).join('\n'),
    migrate: estado('migrate'), api: estado('api'),
    salud: (await esperarHttp(SALUD, 2000)) !== null,
    logMigrate: podman(['logs', contenedor('migrate') ?? 'x']).out.trim() + podman(['logs', contenedor('migrate') ?? 'x']).err.trim(),
  };
  await dcRun(dcf, ['down', '-v'], env);
  return r;
}

// ---------------------------------------------------------------- medicion
const m = maquina();
const ver = podmanOk(['version', '--format', '{{.Client.Version}}|{{.Server.Version}}']).out.trim().split('|');
const info = JSON.parse(podmanOk(['info', '--format', 'json']).out);
const maq = podman(['machine', 'inspect']);
const maquinaPodman = maq.code === 0 ? JSON.parse(maq.out)[0] : null;
// Libre = nadie escuchando (las conexiones en TIME_WAIT de una corrida anterior no cuentan).
const libre = (p) => !new RegExp(`(127\\.0\\.0\\.1|0\\.0\\.0\\.0|\\*|\\[::\\]):${p}\\s.*(LISTEN|ESCUCHANDO)`)
  .test(sh(WIN ? 'netstat' : 'sh', WIN ? ['-ano', '-p', 'TCP'] : ['-c', 'ss -ltn || netstat -ltn']).out);
for (const p of [P_API, P_PG]) if (!libre(p)) throw new Error(`puerto ${p} ocupado`);

// (a) Build: podman build del mismo Dockerfile, en frio (--no-cache, bases ya bajadas) N veces.
podmanOk(['pull', '-q', 'docker.io/library/node:24.22.1-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205']);
const builds = [];
for (let i = 0; i < N; i++) {
  const r = podmanOk(['build', '--no-cache', '-q', '-f', join(RAIZ, 'despues', 'Dockerfile'), '-t', IMAGEN, join(RAIZ, 'api')]);
  builds.push(r.ms);
  console.log(`podman build --no-cache #${i + 1}: ${(r.ms / 1000).toFixed(1)} s`);
}
// Buildah corre las etapas de una en una salvo que se le pida (--jobs); BuildKit las paraleliza solo.
const buildsJobs = [];
for (let i = 0; i < N; i++) {
  const r = podmanOk(['build', '--no-cache', '-q', '--jobs', '3', '-f', join(RAIZ, 'despues', 'Dockerfile'), '-t', IMAGEN, join(RAIZ, 'api')]);
  buildsJobs.push(r.ms);
  console.log(`podman build --no-cache --jobs 3 #${i + 1}: ${(r.ms / 1000).toFixed(1)} s`);
}
const img = JSON.parse(podmanOk(['image', 'inspect', IMAGEN]).out)[0];
const imagen = {
  bytes: img.Size, capas: img.RootFS.Layers.length, usuario: img.Config.User, cmd: img.Config.Cmd,
  manifiesto: img.ManifestType, healthcheck: img.Config.Healthcheck ?? null, capasBase: img.RootFS.Layers.slice(0, 5),
};
// Tamaño comprimido aproximado: docker-dir con gzip (lo que pesaria al subirla).
const dd = join(DIR, 'imagen-docker-dir');
sh(WIN ? 'cmd' : 'rm', WIN ? ['/c', 'rmdir', '/s', '/q', dd] : ['-rf', dd]);
podmanOk(['save', '--format', 'docker-dir', '--compress', '-o', dd, IMAGEN]);
const { readdirSync, statSync } = await import('node:fs');
imagen.comprimidoBytes = readdirSync(dd).reduce((a, f) => a + statSync(join(dd, f)).size, 0);

// Referencia: la misma imagen construida con Docker (BuildKit), tamaño sin comprimir y capas.
let ref = null;
if (process.env.K8_DOCKER !== '0' && docker(['version']).code === 0) {
  const tiempos = [], ids = [];
  for (let i = 0; i < N; i++) {
    const r = docker(['build', '--no-cache', '-q', '-f', join(RAIZ, 'despues', 'Dockerfile'), '-t', 's08-podman/api:docker-ref', join(RAIZ, 'api')]);
    // cada --no-cache deja la imagen anterior sin etiqueta: se guardan los id para borrarlas al final
    if (r.code === 0) { tiempos.push(r.ms); ids.push(r.out.trim()); }
  }
  // Tamaño sin comprimir: suma de las capas de "docker save" descomprimidas
  // (con el almacen containerd, "docker image ls" suma tambien los blobs comprimidos).
  const tarRef = join(DIR, 'docker-ref.tar');
  docker(['save', '-o', tarRef, 's08-podman/api:docker-ref']);
  const blobs = new Map([...entradas(readFileSync(tarRef))].map((e) => [e.nombre, e.datos]));
  const capasTar = JSON.parse(blobs.get('manifest.json').toString())[0].Layers;
  const bytesRef = capasTar.reduce((a, n) => a + (comoTar(blobs.get(n))?.length ?? blobs.get(n).length), 0);
  const capas = JSON.parse(docker(['image', 'inspect', 's08-podman/api:docker-ref', '--format', '{{json .RootFS.Layers}}']).out || '[]');
  ref = { tiempos, ids, bytes: bytesRef, capas: capas.length, mismasBase: JSON.stringify(capas.slice(0, 5)) === JSON.stringify(imagen.capasBase) };
}

// (b) Arranque con cada proveedor.
const resultados = [];
for (const pr of PROVEEDORES) {
  const dc = [PODMAN, ['compose', '-f', COMPOSE, '-p', PROYECTO]];
  const v = await lanzar(PODMAN, ['compose', 'version'], pr.env);
  const lineaVer = v.out.split('\n').map((l) => l.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(Boolean);
  pr.version = lineaVer.filter((l) => /version/i.test(l)).join(' / ');
  pr.ejecutable = (v.out.match(/external compose provider "([^"]+)"/) ?? [])[1]?.replace(/\\\\/g, '\\') ?? '?';
  // build por compose (usa la cache de las capas de arriba)
  await dcRun(dc, ['build', 'migrate'], pr.env);
  const corridas = [];
  for (let i = 1; i <= N; i++) {
    const c = await arranque(dc, pr.env);
    corridas.push(c);
    console.log(`${pr.id} #${i}:`, JSON.stringify({ ...c, salidaUp: undefined }));
  }
  // (c) Usuario dentro y fuera del contenedor (con el stack arriba).
  let usuario = null;
  if (resultados.length === 0) {
    const api = contenedor('api'), pg = contenedor('postgres');
    const ex = (c, cmd) => podman(['exec', c, 'sh', '-c', cmd]);
    usuario = {
      idApi: ex(api, 'id').out.trim(),
      idPg: ex(pg, 'id').out.trim(),
      topApi: podman(['top', api, 'user', 'huser', 'args']).out.trim(),
      topPg: podman(['top', pg, 'user', 'huser', 'args']).out.trim().split('\n').slice(0, 2).join('\n'),
      capEff: ex(api, "grep CapEff /proc/1/status | awk '{print $2}'").out.trim(),
      escribeCodigo: ex(api, 'echo x >> /app/dist/main.js').code === 0,
      escribeEtc: ex(api, 'echo x >> /etc/passwd').code === 0,
      uidMap: podman(['inspect', api, '--format', '{{json .HostConfig.IDMappings}}']).out.trim(),
    };
    if (maquinaPodman) {
      const s = podman(['machine', 'ssh', 'id; echo; cat /etc/subuid; echo; echo "# procesos (cuantos, usuario, programa):"; ps -o user=,comm= -C conmon,podman,postgres,node | sort | uniq -c']);
      usuario.vm = s.out.trim();
    }
  }
  const falla = await migracionRota(dc, pr.env);
  console.log(`${pr.id} migracion rota:`, JSON.stringify({ ...falla, logMigrate: undefined }));
  await dcRun(dc, ['down', '-v'], pr.env);
  resultados.push({ proveedor: pr, corridas, usuario, falla });
}

// Referencia: Docker con la misma copia del compose (mismos puertos, después de bajar Podman).
let refArranque = null;
if (ref) {
  const dc = ['docker', ['compose', '-f', COMPOSE, '-p', `${PROYECTO}-ref`]];
  const tiempos = [];
  for (let i = 0; i < N; i++) {
    await dcRun(dc, ['down', '-v'], {});
    // la imagen ya existe con otra etiqueta: se le pone la del compose
    docker(['tag', 's08-podman/api:docker-ref', IMAGEN]);
    const t0 = Date.now();
    const up = dcRun(dc, ['up', '-d'], {});
    const s = await esperarHttp(SALUD, 120000);
    await up;
    tiempos.push(s);
    console.log(`docker (referencia) #${i + 1}: ${s} ms hasta /salud`);
  }
  await dcRun(dc, ['down', '-v'], {});
  docker(['image', 'rm', IMAGEN, 's08-podman/api:docker-ref', ...new Set(ref.ids)]);
  refArranque = tiempos;
}

// Limpieza de lo propio en Podman (el stack ya esta abajo). Las bases descargadas quedan.
podman(['image', 'rm', IMAGEN, 'docker.io/' + IMAGEN, 'localhost/' + IMAGEN]);
podman(['image', 'prune', '-f']);

// ---------------------------------------------------------------- informe
const s = (ms) => (ms / 1000).toFixed(1);
const MB = (b) => (b / 1e6).toFixed(1);
const med = (xs) => `${mediana(xs).toFixed(1)} (${rango(xs)})`;
const ram = Math.round(info.host.memTotal / 2 ** 30);
const banco = `Medido el ${m.fecha.slice(0, 10)}. Máquina: ${m.cpu}, ${m.hilos} hilos lógicos, ${m.ramGB} GB de RAM, ${m.so}, Node ${m.node}.
Podman ${ver[0]} (cliente Windows) contra el servidor ${ver[1]} de la máquina \`${maquinaPodman?.Name ?? '?'}\` (${info.host.distribution.distribution} ${info.host.distribution.version}, kernel ${info.host.kernel}, WSL2${maquinaPodman ? `; la máquina declara ${maquinaPodman.Resources.CPUs} CPU y ${maquinaPodman.Resources.Memory} MiB, pero WSL2 la deja ver ${info.host.cpus} CPU y ${ram} GB` : ''}), **rootless: ${info.host.security.rootless}**${maquinaPodman ? `, máquina con \`Rootful: ${maquinaPodman.Rootful}\`` : ''}, runtime ${info.host.ociRuntime.name}, red ${info.host.networkBackend} + ${info.host.pasta?.executable ? 'pasta' : 'slirp4netns'}, almacenamiento ${info.store.graphDriverName}.
Referencia con Docker: Engine ${m.docker}, Compose ${m.compose}, buildx ${m.buildx} (Docker Desktop corriendo a la vez, con otras demos).`;

const filasArranque = resultados.map(({ proveedor: p, corridas: c }) => {
  const ok = c.filter((x) => x.saludMs !== null);
  return `| \`podman compose\` → ${p.id} | ${ok.length} de ${c.length} | ${ok.length ? med(ok.map((x) => x.saludMs / 1000)) : '—'} | ${c.filter((x) => x.orden).length} de ${c.length} | ${[...new Set(c.map((x) => x.migArranques))].join(', ')} | ${[...new Set(c.map((x) => x.items))].join(', ')} | ${[...new Set(c.map((x) => x.up))].join(', ')} |`;
});
if (refArranque) filasArranque.push(`| \`docker compose\` (referencia) | ${refArranque.filter((x) => x !== null).length} de ${refArranque.length} | ${med(refArranque.filter((x) => x !== null).map((x) => x / 1000))} | — | — | — | — |`);

const lineaTiempo = resultados.map(({ proveedor: p, corridas: c }) => {
  const k = (n) => { const xs = c.map((x) => x[n]).filter((x) => x !== null); return xs.length ? med(xs) : '—'; };
  return `| ${p.id} | ${k('pgInicio')} | ${k('pgSano')} | ${k('migInicio')} | ${k('migFin')} | ${k('apiInicio')} | ${med(c.filter((x) => x.saludMs).map((x) => x.saludMs / 1000))} |`;
}).join('\n');

const filasFalla = resultados.map(({ proveedor: p, falla: f }) =>
  `| ${p.id} | ${f.up} | ${f.migrate.estado ?? '—'} (código ${f.migrate.codigo ?? '—'}) | ${f.api.existe ? `${f.api.estado}${f.api.inicio ? ', **arrancó**' : ', nunca arrancó'}` : 'no se creó'} | ${f.salud ? '**sí**' : 'no'} |`).join('\n');

const u = resultados[0].usuario;
const diff = cambios.map(([a, b]) => `- \`${a}\` → \`${b}\``).join('\n');

const md = `# K8. El mismo stack con Podman (rootless)

${banco}

Qué se probó: el [\`despues/Dockerfile\`](../despues/Dockerfile) y el [\`despues/compose.yaml\`](../despues/compose.yaml) **tal cual**, con Podman en modo *rootless* (los contenedores los lanza un usuario común de la máquina de Podman; no hay un demonio con privilegios). \`podman compose\` no es un Compose propio: es un envoltorio que llama a un **proveedor** externo. Se midieron los dos: ${PROVEEDORES.map((p) => `**${p.id}** (${p.version}${p.via ? `; corrido con \`${p.via}\`` : ''}; ejecutable \`${p.ejecutable}\`)`).join(' y ')}.${pc ? '' : ' podman-compose no estaba disponible (ni `PODMAN_COMPOSE` ni `uvx`): solo se midió docker-compose.'}

Para que conviva con la demo de Docker en la misma máquina, el script usa una copia del compose en \`.tmp/k8/\` con estos cambios (ninguno lo pide Podman):

${diff}

Comando: \`npm run k8\` (≈ 5 min).

## 1. Build: ¿la misma imagen?

| | Podman (\`podman build\`, Buildah) | Docker (BuildKit) |
|---|---|---|
| Construye sin cambios en el Dockerfile | sí | sí |
| Tamaño sin comprimir | ${MB(imagen.bytes)} MB | ${ref ? `${MB(ref.bytes)} MB (capas de \`docker save\` descomprimidas)` : '—'} |
| Tamaño comprimido (gzip) | ≈ ${MB(imagen.comprimidoBytes)} MB (\`podman save --format docker-dir --compress\`) | 83,4 MB (K1, \`docker image ls\`) |
| Capas | ${imagen.capas} | ${ref?.capas ?? '—'} |
| Las 5 capas de la base, idénticas (mismo digest) | ${ref ? (ref.mismasBase ? 'sí' : 'no') : '—'} | |
| Usuario / comando | \`${imagen.usuario}\` / \`${JSON.stringify(imagen.cmd)}\` | \`node\` / el mismo |
| Formato del manifiesto | \`${imagen.manifiesto}\` | OCI |
| Build en frío (\`--no-cache\`, bases ya descargadas), mediana de ${N} | ${med(builds.map((x) => x / 1000))} s; con \`--jobs 3\`: ${med(buildsJobs.map((x) => x / 1000))} s | ${ref?.tiempos.length ? `${med(ref.tiempos.map((x) => x / 1000))} s` : '—'} |

Nota sobre el tamaño: con el almacén containerd, \`docker image ls\` informa 357 MB «en disco» (K1), que suma las capas descomprimidas **y** los blobs comprimidos. La fila «sin comprimir» compara lo mismo en los dos motores. Las capas de la base son idénticas; las de la aplicación tienen otro digest en cada motor (fechas de los archivos, y BuildKit guarda el \`WORKDIR\` como una capa propia de 1,5 KB). No se comparó el contenido archivo por archivo.

## 2. \`podman compose up\`: ${N} corridas por proveedor, volumen vacío

Tiempo desde que se lanza \`podman compose up -d\` (o \`docker compose up -d\`) hasta el primer \`200\` de \`GET /salud\`, en segundos (mediana y rango). Imagen ya construida y bases ya descargadas.

| Comando → proveedor | \`/salud\` respondió | s hasta \`/salud\` | Orden postgres sano → migrate → api | Veces que arrancó \`migrate\` | Filas en \`/items\` | Código de \`up\` |
|---|---|---:|---|---|---|---|
${filasArranque.join('\n')}

Línea de tiempo (s desde que se lanzó \`up\`, según \`podman events\`; mediana y rango):

| Proveedor | Postgres arranca | Postgres sano | \`migrate\` arranca | \`migrate\` termina | \`api\` arranca | \`/salud\` responde |
|---|---:|---:|---:|---:|---:|---:|
${lineaTiempo}

## 3. Migración rota (el caso de falla de K6)

Con [\`compose.migracion-con-error.yaml\`](../despues/compose.migracion-con-error.yaml) encima (una segunda migración que falla).

| Proveedor | Código de \`up -d\` | \`migrate\` | \`api\` | \`/salud\` responde |
|---|---|---|---|---|
${filasFalla}

${resultados.map(({ proveedor: p, falla: f }) => `Salida de \`up\` con ${p.id}:\n\n\`\`\`\n${f.salida || '(sin líneas sobre migrate o errores)'}\n\`\`\``).join('\n\n')}

## 4. Usuario: dentro del contenedor y en la máquina

\`\`\`
$ podman exec <api> id
${u.idApi}
$ podman exec <postgres> id
${u.idPg}
$ podman top <api> user huser args
${u.topApi}
$ podman top <postgres> user huser args
${u.topPg}
\`\`\`

- Capacidades efectivas del proceso de la API: \`${u.capEff}\`; ¿puede reescribir \`/app/dist/main.js\`? ${u.escribeCodigo ? '**sí**' : 'no'}; ¿y \`/etc/passwd\`? ${u.escribeEtc ? '**sí**' : 'no'} (lo mismo que K3 con Docker).
- \`HUSER\` es el usuario **en la máquina de Podman**: el uid 1000 del contenedor es otro uid alto en la VM, y el root de dentro del contenedor de Postgres (el \`id\` de \`exec\`) es el usuario común que lanzó Podman, no el root de la VM.

En la máquina de Podman (\`podman machine ssh\`):

\`\`\`
${u.vm ?? '(sin máquina de Podman: Linux nativo)'}
\`\`\`

## Por qué

- **Misma imagen**: Podman construye con Buildah y lee el mismo Dockerfile; como \`despues/Dockerfile\` nombra las bases con el registro completo (\`docker.io/library/...\`), no hay que configurar registros de búsqueda para nombres cortos. El resultado es una imagen OCI que cualquiera de los dos motores puede correr.
- **Rootless de verdad**: no hay un demonio con privilegios. Cada contenedor lo arranca \`conmon\` con el usuario común de la VM, y los uid del contenedor se traducen con \`/etc/subuid\` (*user namespace*): el root de dentro no es root fuera. Con Docker Desktop, el demonio corre como root en su VM; el \`USER node\` de K3 protege dentro del contenedor, rootless protege también fuera.
- **\`podman compose\` es un envoltorio**: con Docker Desktop instalado, \`podman compose\` encuentra el \`docker-compose\` de Docker Desktop y lo apunta al socket de Podman (la API compatible con Docker). Es el mismo programa que \`docker compose\`, por eso respeta \`depends_on: condition\` igual. **podman-compose** es otro programa (Python) que traduce el YAML a comandos \`podman\`, y ahí aparecen dos diferencias:
  - **\`service_completed_successfully\` no mira el código de salida.** podman-compose 1.6.0 lo traduce a \`podman wait --condition=stopped\` (en su código: \`"service_completed_successfully": ServiceDependencyCondition.STOPPED\`): espera a que \`migrate\` **termine**, sin importar si terminó bien. Con la migración rota, la API arrancó y respondió \`/salud\` sobre un esquema que no es el que espera (la \`002\` falló y se deshizo), y \`up -d\` salió con 0. Se pierde justo la protección que K6 mostró con Docker. \`service_healthy\` sí se respeta (\`podman wait --condition=healthy\`).
  - **\`migrate\` corre dos veces.** podman-compose crea la API con \`--requires=postgres,migrate\`, y al arrancar la API Podman vuelve a arrancar sus dependencias que no están corriendo: \`migrate\` ya había terminado, así que corre otra vez. Aquí no rompe nada porque el aplicador es idempotente (K6); un *job* que no lo sea se ejecutaría dos veces.
- **Build más lento con Podman**: Buildah corre las etapas del multi-stage **una tras otra** salvo que se le pase \`--jobs\`; BuildKit corre a la vez las que no dependen entre sí (\`deps\` y \`prod-deps\` instalan dependencias en paralelo, K1). Con \`--jobs 3\` la diferencia baja a la mitad; el resto no se perfiló \`[por verificar]\` (por ejemplo, el contexto viaja a la VM por la conexión de \`podman machine\`).
- **Arranque más lento con podman-compose**: Postgres recién arranca a los ~6 s porque podman-compose crea la red, el volumen y cada contenedor con un \`podman\` aparte, uno tras otro, y cada llamada cruza la conexión con la máquina (más ~0,9 s de \`uvx\` en esta prueba). Con docker-compose, Postgres arranca a ~1 s, como con Docker.
- **Healthchecks en el compose, no en la imagen**: Podman construye en formato OCI, que no guarda \`HEALTHCHECK\`; como están en \`compose.yaml\`, funcionan igual con los dos proveedores (dentro de la máquina, Podman los programa con temporizadores de systemd \`[por verificar]\`).

## Qué no se midió

- **Podman nativo en Linux** ni **Podman Desktop**: solo Podman 5.8.3 en Windows con su máquina WSL2. En Linux no hay VM y los tiempos cambian. Tampoco Podman 6.x (\`Podman.CLI\` 6.1.4), que en esta máquina no se instaló.
- **Modo rootful** de la máquina (\`podman machine set --rootful\`): no se comparó.
- **podman-compose instalado de otra forma** (pip, paquete del sistema): se corrió con \`uvx\`, que agrega ~0,9 s a cada comando; el problema de \`service_completed_successfully\` está en el código de podman-compose 1.6.0, no en cómo se instala. Otras versiones \`[por verificar]\`.
- **Descarga de las bases** con Podman: las imágenes base ya estaban en la máquina; no se midió el primer \`pull\`.
- **\`podman kube play\`** y Quadlet (las formas «nativas» de Podman de levantar varios contenedores): fuera del alcance.
- **Si los healthchecks usan temporizadores de systemd** dentro de la máquina: no se inspeccionó \`[por verificar]\`.
- **Escape del contenedor**: no se probó. Que el uid de fuera sea un usuario común se vio con \`podman top\` y \`ps\`; el usuario de la VM (\`user\`) está en el grupo \`wheel\` y usa \`sudo\` sin clave en la VM (comprobado con \`sudo -n true\`), así que rootless protege del root del contenedor, no de quien ya entró a la VM.
- **Ciclo de desarrollo** (\`develop.watch\` de \`compose.dev.yaml\`) con Podman: no se probó.
`;
guardar('K8_PODMAN', md, { maquina: m, podman: { version: ver, rootless: info.host.security.rootless }, builds, buildsJobs, imagen, ref, resultados: resultados.map((r) => ({ ...r, corridas: r.corridas.map((c) => ({ ...c, salidaUp: c.salidaUp.slice(-2000) })) })), refArranque });
