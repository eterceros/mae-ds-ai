// Como scripts/bench.mjs, pero contra el servidor Java (java-server/: Spring MVC + grpc-java), para ver si el
// resultado cambia cuando el servidor es compilado. Mismo cliente Node simetrico y mismo metodo:
//   1) maximo de llamadas por segundo (bucle cerrado, 10 trabajadores);
//   2) latencia a un ritmo fijo y comun a las variantes del escenario (40 % de la mas lenta), sin saturar.
// Escribe results/JAVA.md.
// Antes: cd java-server && mvn -q package -DskipTests   (genera java-server/target/students-java-server.jar)
// Uso: node scripts/java-bench.mjs
// Variables: ROUNDS (3), ONLY (p. ej. P; no sobrescribe el archivo de resultados), JVM_WARMUP_S (5), SMOKE (1 = solo
//            una llamada por variante, sin medir),
//            DB_LATENCY_MS, DB_POOL, HTTP_PORT (18800), GRPC_PORT (18801), JAVA_OPTS (opciones extra de la JVM).
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClients } from './lib/clients.mjs';
import { openLoop, saturate } from './lib/load.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const JAR = join(root, 'java-server/target/students-java-server.jar');
const HTTP_PORT = process.env.HTTP_PORT ?? '18800';
const GRPC_PORT = process.env.GRPC_PORT ?? '18801';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const JVM_WARMUP_S = Number(process.env.JVM_WARMUP_S ?? 5);
const LOAD_FRACTION = 0.4;
const only = process.env.ONLY;

if (!existsSync(JAR)) {
  console.error(`No existe ${JAR}. Compile antes: cd java-server && mvn -q package -DskipTests`);
  process.exit(1);
}

// Si ya hay algo en el puerto, mediriamos otro servidor sin saberlo.
try {
  await fetch(`http://127.0.0.1:${HTTP_PORT}/stats`);
  console.error(`El puerto ${HTTP_PORT} ya esta en uso; cambie HTTP_PORT o pare ese servidor.`);
  process.exit(1);
} catch {}

// En Windows, el java.exe de "Common Files\Oracle\Java\javapath" es un lanzador que arranca la JVM real como
// proceso hijo: al pararlo, la JVM quedaria viva con los puertos abiertos. Por eso se ejecuta el java del JDK.
function javaBinary() {
  const exe = process.platform === 'win32' ? 'java.exe' : 'java';
  if (process.env.JAVA_HOME && existsSync(join(process.env.JAVA_HOME, 'bin', exe))) return join(process.env.JAVA_HOME, 'bin', exe);
  const props = spawnSync('java', ['-XshowSettings:properties', '-version'], { encoding: 'utf8' }).stderr ?? '';
  const home = props.match(/^\s*java\.home = (.+)$/m)?.[1]?.trim();
  return home && existsSync(join(home, 'bin', exe)) ? join(home, 'bin', exe) : 'java';
}
const JAVA = javaBinary();
const javaVersion = (spawnSync(JAVA, ['-version'], { encoding: 'utf8' }).stderr ?? '').split('\n')[0].trim();
const javaOpts = (process.env.JAVA_OPTS ?? '').split(/\s+/).filter(Boolean);
const env = { ...process.env, HTTP_PORT, GRPC_PORT };
const server = spawn(JAVA, [...javaOpts, '-jar', JAR], { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'] });
let serverErr = '';
let serverExited = false;
server.stderr.on('data', (d) => (serverErr = (serverErr + d).slice(-4000)));
server.on('exit', () => (serverExited = true));
const stop = () => {
  if (serverExited) return;
  // Por si acaso, en Windows se para el arbol completo.
  if (process.platform === 'win32') spawnSync('taskkill', ['/T', '/F', '/PID', String(server.pid)], { stdio: 'ignore' });
  else server.kill();
};
process.on('exit', stop);

// Primero HTTP; el cliente gRPC se crea despues (si se crea antes, grpc-js espaciaria los reintentos).
async function waitUp() {
  for (let i = 0; i < 100; i++) {
    if (serverExited) throw new Error(`el servidor Java termino al arrancar:\n${serverErr}`);
    try {
      if ((await fetch(`http://127.0.0.1:${HTTP_PORT}/stats`)).ok) {
        const c = createClients({ root, httpPort: HTTP_PORT, grpcPort: GRPC_PORT });
        await c.grpc('GetStudent', { id: 1 });
        return c;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`no arranco: http://127.0.0.1:${HTTP_PORT} / gRPC ${GRPC_PORT}\n${serverErr}`);
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');
const range = (xs) => (Math.min(...xs) === Math.max(...xs) ? f1(xs[0]) : `${f1(Math.min(...xs))}–${f1(Math.max(...xs))}`);

const lines = [];
const out = (s = '') => {
  console.log(s);
  lines.push(s);
};

// Escenarios A y B de bench.mjs (solo REST y gRPC) y una variante de 20 llamadas pequenas en paralelo,
// como la que hace el gateway en D1 pero desde el cliente directo al servicio.
const IDS = Array.from({ length: 20 }, (_, i) => i + 1);
const javaScenarios = (c) => [
  {
    id: 'A',
    title: 'A. Un estudiante',
    variants: [
      ['REST', () => c.rest('/students/7')],
      ['gRPC', () => c.grpc('GetStudent', { id: 7 })],
    ],
  },
  {
    id: 'B',
    title: 'B. Lista de 2000 estudiantes',
    variants: [
      ['REST', () => c.rest('/students?limit=2000')],
      ['gRPC', () => c.grpc('ListStudents', { limit: 2000 })],
    ],
  },
  {
    id: 'P',
    title: 'P. 20 llamadas pequeñas en paralelo (estudiantes 1 a 20, uno por llamada)',
    variants: [
      ['REST (20 × GET /students/{id})', () => Promise.all(IDS.map((id) => c.rest(`/students/${id}`)))],
      ['gRPC (20 × GetStudent)', () => Promise.all(IDS.map((id) => c.grpc('GetStudent', { id })))],
    ],
  },
];

let clients;
try {
  clients = await waitUp();
  const groups = javaScenarios(clients).filter((g) => !only || g.id.startsWith(only));

  // SMOKE=1: una llamada por variante para comprobar que todo responde; no mide ni escribe resultados.
  if (process.env.SMOKE) {
    for (const group of groups) {
      for (const [name, call] of group.variants) {
        const reply = await call();
        const n = Array.isArray(reply) ? reply.length : reply?.students ? reply.students.length : 1;
        console.log(`ok  ${group.id}  ${name}  (${n} elemento${n === 1 ? '' : 's'})`);
      }
    }
    process.exit(0);
  }

  // La JVM compila el codigo caliente (JIT) tras miles de llamadas; sin esto, la primera variante medida
  // pagaria la compilacion. Se descarta.
  if (JVM_WARMUP_S > 0) {
    console.error(`Calentando la JVM (${JVM_WARMUP_S} s por variante, descartado)...`);
    for (const group of groups) for (const [, call] of group.variants) await saturate(call, { warmupS: 0, seconds: JVM_WARMUP_S });
  }

  out('# Rendimiento y latencia: servidor Java (cliente Node simétrico)');
  out();
  out(
    `Servidor Java (Spring Boot 4.1.1 con Spring MVC y Tomcat para REST, grpc-java 1.83.1 sobre Netty para gRPC; ${javaVersion || 'java'}${javaOpts.length ? `; JAVA_OPTS: ${javaOpts.join(' ')}` : ''}) ` +
      `y cliente Node en la misma máquina (loopback). Mismos datos y mismo JSON que el servidor Node (ver java-server/README.md). ` +
      `Base simulada: ${process.env.DB_LATENCY_MS ?? 1} ms por consulta, máximo ${process.env.DB_POOL ?? 10} a la vez. ` +
      `Cada cifra es la mediana de ${ROUNDS} rondas; entre paréntesis, el rango entre rondas. Las variantes se recorren en orden distinto en cada ronda.` +
      (JVM_WARMUP_S > 0 ? ` Antes de medir, cada variante corre ${JVM_WARMUP_S} s a carga máxima para que la JVM compile el código (descartado).` : ''),
  );
  out();
  out('- **Máx. llamadas/s:** bucle cerrado con 10 trabajadores (rendimiento máximo; puede estar limitado por el propio cliente, que es un solo proceso Node).');
  out(`- **Latencia:** llegadas a ritmo fijo, común a las variantes del escenario (${LOAD_FRACTION * 100} % de lo que aguanta la más lenta), con 2 s de calentamiento descartados y 8 s medidos. El tiempo cuenta desde que la llamada debió salir.`);
  out('- En **P** cada "llamada" del cliente son 20 peticiones en paralelo; las llamadas/s y la latencia son de ese grupo de 20.');
  out();

  for (const group of groups) {
    // Ritmo comun: una pasada de calibracion con todas las variantes.
    const calibration = [];
    for (const [, call] of group.variants) calibration.push((await saturate(call, { warmupS: 1, seconds: 2 })).rps);
    const rate = Math.max(5, Math.floor(Math.min(...calibration) * LOAD_FRACTION));

    const results = group.variants.map(() => ({ rps: [], p50: [], p95: [], p99: [], errors: 0 }));
    for (let round = 0; round < ROUNDS; round++) {
      // Orden distinto por ronda: el calentamiento del JIT y del GC no favorece siempre a la misma variante.
      const order = group.variants.map((_, i) => i);
      for (let k = 0; k < round; k++) order.push(order.shift());
      for (const i of order) {
        const call = group.variants[i][1];
        const sat = await saturate(call);
        const lat = await openLoop(call, { rate });
        const r = results[i];
        r.rps.push(sat.rps);
        r.p50.push(lat.p50);
        r.p95.push(lat.p95);
        r.p99.push(lat.p99);
        r.errors += sat.errors + lat.errors + lat.dropped;
      }
    }

    out(`## ${group.title}`);
    out();
    out(`Ritmo común de la prueba de latencia: ${rate} llamadas/s.`);
    out();
    out('| Estilo | Máx. llamadas/s | p50 (ms) | p95 (ms) | p99 (ms) | Errores |');
    out('|---|---:|---:|---:|---:|---:|');
    group.variants.forEach(([name], i) => {
      const r = results[i];
      out(
        `| ${name} | ${f1(median(r.rps))} (${range(r.rps)}) | ${f1(median(r.p50))} (${range(r.p50)}) | ${f1(median(r.p95))} (${range(r.p95)}) | ${f1(median(r.p99))} (${range(r.p99)}) | ${r.errors} |`,
      );
    });
    out();
  }

  if (!only) {
    mkdirSync(join(root, 'results'), { recursive: true });
    writeFileSync(join(root, 'results/JAVA.md'), lines.join('\n') + '\n');
  }
} finally {
  clients?.close();
  stop();
}
