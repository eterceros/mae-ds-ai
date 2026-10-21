// Levanta el servicio y el gateway, y mide cada escenario de dos maneras separadas:
//   1) maximo de llamadas por segundo (bucle cerrado, 10 trabajadores);
//   2) latencia a un ritmo fijo y comun a todas las variantes del escenario (40 % de la mas lenta), sin saturar.
// Los clientes son simetricos (ver scripts/lib/clients.mjs). Escribe results/LATENCY.md.
// Uso: node scripts/bench.mjs
// Variables: ROUNDS (3), ONLY (p. ej. D para repetir solo D1 y D2; no sobrescribe el archivo de resultados),
//            DB_LATENCY_MS, DB_POOL, APOLLO_CACHE_CONTROL, HTTP_PORT, GRPC_PORT, GATEWAY_PORT.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClients, scenarios } from './lib/clients.mjs';
import { openLoop, saturate } from './lib/load.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const HTTP_PORT = process.env.HTTP_PORT ?? '18300';
const GRPC_PORT = process.env.GRPC_PORT ?? '18301';
const GATEWAY_PORT = process.env.GATEWAY_PORT ?? '18310';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const LOAD_FRACTION = 0.4;
const only = process.env.ONLY;

// Si ya hay algo en el puerto, mediriamos otro servidor sin saberlo.
try {
  await fetch(`http://127.0.0.1:${HTTP_PORT}/stats`);
  console.error(`El puerto ${HTTP_PORT} ya esta en uso; cambie HTTP_PORT o pare ese servidor.`);
  process.exit(1);
} catch {}

const env = { ...process.env, HTTP_PORT, GRPC_PORT, GATEWAY_PORT };
const server = spawn('node', ['dist/main.js'], { cwd: root, env, stdio: 'ignore' });
const gateway = spawn('node', ['dist/gateway.js'], { cwd: root, env, stdio: 'ignore' });
const stop = () => {
  server.kill();
  gateway.kill();
};
process.on('exit', stop);

async function waitUp() {
  for (const url of [`http://127.0.0.1:${HTTP_PORT}/stats`, `http://127.0.0.1:${GATEWAY_PORT}/bulk/rest?n=1`]) {
    let up = false;
    for (let i = 0; i < 50 && !up; i++) {
      try {
        up = (await fetch(url)).ok;
      } catch {}
      if (!up) await new Promise((r) => setTimeout(r, 200));
    }
    if (!up) throw new Error(`no arranco: ${url}`);
  }
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

try {
  await waitUp();
  const clients = createClients({ root, httpPort: HTTP_PORT, grpcPort: GRPC_PORT, gatewayPort: GATEWAY_PORT });
  const groups = scenarios(clients).filter((g) => !only || g.id.startsWith(only));

  out('# Rendimiento y latencia (cliente Node simétrico)');
  out();
  out(
    `Servidores y cliente en la misma máquina (loopback). Base simulada: ${process.env.DB_LATENCY_MS ?? 1} ms por consulta, máximo ${process.env.DB_POOL ?? 10} a la vez. ` +
      `Cada cifra es la mediana de ${ROUNDS} rondas; entre paréntesis, el rango entre rondas. Las variantes se recorren en orden distinto en cada ronda.`,
  );
  out();
  out('- **Máx. llamadas/s:** bucle cerrado con 10 trabajadores (rendimiento máximo; puede estar limitado por el propio cliente, que es un solo proceso Node).');
  out(`- **Latencia:** llegadas a ritmo fijo, común a las variantes del escenario (${LOAD_FRACTION * 100} % de lo que aguanta la más lenta), con 2 s de calentamiento descartados y 8 s medidos. El tiempo cuenta desde que la llamada debió salir.`);
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
    writeFileSync(join(root, 'results/LATENCY.md'), lines.join('\n') + '\n');
  }
  clients.close();
} finally {
  stop();
}
