// Mide con una red limitada: el servicio corre en un contenedor Docker y se le aplica retardo y ancho de banda
// con `tc netem` a lo que sale del contenedor (las respuestas). Es la condicion donde, en teoria, importan los
// bytes y las conexiones. Escribe results/NETWORK.md.
// Uso: node scripts/network-bench.mjs
// Variables: NET_DELAY_MS (20), NET_RATE (20mbit), ROUNDS (3). Requiere Docker; usa las imagenes
// node:22-alpine y nicolaka/netshoot (esta ultima solo trae `tc`).
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClients } from './lib/clients.mjs';
import { openLoop, saturate } from './lib/load.mjs';
import { applyNetem, removeContainer, startContainer } from './lib/netem-container.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'm8demo-net';
const HTTP_PORT = process.env.HTTP_PORT ?? '18710';
const GRPC_PORT = process.env.GRPC_PORT ?? '18711';
const DELAY = process.env.NET_DELAY_MS ?? '20';
const RATE = process.env.NET_RATE ?? '20mbit';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const LOAD_FRACTION = 0.4;

// Solo se borra el contenedor si lo creamos nosotros (startContainer falla si el nombre ya existe).
let created = false;
process.on('exit', () => created && removeContainer(NAME));

const lines = [];
const out = (s = '') => {
  console.log(s);
  lines.push(s);
};
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');
const range = (xs) => (Math.min(...xs) === Math.max(...xs) ? f1(xs[0]) : `${f1(Math.min(...xs))}–${f1(Math.max(...xs))}`);

try {
  await startContainer({ root, name: NAME, httpPort: HTTP_PORT, grpcPort: GRPC_PORT });
  created = true;
  applyNetem(NAME, { delayMs: DELAY, rate: RATE });

  const base = { root, httpPort: HTTP_PORT, grpcPort: GRPC_PORT };
  const open = createClients(base); // conexiones HTTP/1.1 sin tope
  const six = createClients({ ...base, maxSockets: 6 }); // como un navegador
  // Ventana de control de flujo de HTTP/2 de 8 MB en el cliente gRPC (por defecto son 64 KB).
  const wideOptions = { 'grpc-node.flow_control_window': 8 * 1024 * 1024 };
  const wide = createClients({ ...base, grpcOptions: wideOptions });
  const groups = [
    {
      title: `N1. Lista de 2000 estudiantes (una llamada grande)`,
      variants: [
        ['REST (JSON sin comprimir)', () => open.rest('/students?limit=2000')],
        ['REST con gzip', () => open.restGzip('/students?limit=2000')],
        ['gRPC (sin comprimir)', () => open.grpc('ListStudents', { limit: 2000 })],
        ['gRPC (sin comprimir) con ventana HTTP/2 ampliada', () => wide.grpc('ListStudents', { limit: 2000 })],
      ],
    },
    {
      title: 'N2. 20 estudiantes pedidos de uno en uno, en paralelo (muchas llamadas pequeñas)',
      variants: [
        ['REST, hasta 6 conexiones (como un navegador)', () => Promise.all(Array.from({ length: 20 }, (_, i) => six.rest(`/students/${i + 1}`)))],
        ['REST, conexiones sin tope', () => Promise.all(Array.from({ length: 20 }, (_, i) => open.rest(`/students/${i + 1}`)))],
        ['gRPC, un solo canal', () => Promise.all(Array.from({ length: 20 }, (_, i) => open.grpc('GetStudent', { id: i + 1 })))],
      ],
    },
  ];

  out('# Con red limitada (Docker + tc netem)');
  out();
  out(
    `El servicio corre en un contenedor Linux (node:22-alpine) y a lo que sale de él se le aplica **${DELAY} ms de retardo y ${RATE}** con \`tc netem\`. ` +
      `El cliente corre en el host de Windows y entra por puertos publicados de Docker. Cada cifra es la mediana de ${ROUNDS} rondas (entre paréntesis, el rango). ` +
      `Latencia a ritmo fijo común (${LOAD_FRACTION * 100} % de lo que aguanta la variante más lenta), 2 s de calentamiento y 8 s medidos.`,
  );
  out();

  for (const group of groups) {
    const calibration = [];
    for (const [, call] of group.variants) calibration.push((await saturate(call, { warmupS: 1, seconds: 3 })).rps);
    const rate = Math.max(2, Math.floor(Math.min(...calibration) * LOAD_FRACTION));
    const results = group.variants.map(() => ({ rps: [], p50: [], p95: [], p99: [], errors: 0 }));
    for (let round = 0; round < ROUNDS; round++) {
      const order = group.variants.map((_, i) => i);
      for (let k = 0; k < round; k++) order.push(order.shift());
      for (const i of order) {
        const call = group.variants[i][1];
        const sat = await saturate(call, { seconds: 5 });
        const lat = await openLoop(call, { rate, seconds: 10 });
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
      out(`| ${name} | ${f1(median(r.rps))} (${range(r.rps)}) | ${f1(median(r.p50))} (${range(r.p50)}) | ${f1(median(r.p95))} (${range(r.p95)}) | ${f1(median(r.p99))} (${range(r.p99)}) | ${r.errors} |`);
    });
    out();
  }
  open.close();
  six.close();
  wide.close();

  mkdirSync(join(root, 'results'), { recursive: true });
  writeFileSync(join(root, 'results/NETWORK.md'), lines.join('\n') + '\n');
} finally {
  if (created) removeContainer(NAME);
}
