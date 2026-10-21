// Streaming frente a respuesta completa: cuanto tarda el cliente en tener el PRIMER estudiante y en tener TODOS.
// Un JSON de arreglo o una respuesta unaria obligan a esperar la respuesta entera antes de poder usar el primer
// elemento; NDJSON (REST) y el streaming de servidor (gRPC) lo entregan en cuanto llega. Llamadas de una en una
// (sin concurrencia): se mide la latencia, no la capacidad. Se mide primero con la red del contenedor sin limitar y
// despues con retardo y ancho de banda limitados. Escribe results/STREAM.md.
// Uso: node scripts/stream-bench.mjs   (Docker; mismas variables de red que network-bench: NET_DELAY_MS, NET_RATE)
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClients } from './lib/clients.mjs';
import { pct } from './lib/load.mjs';
import { applyNetem, removeContainer, startContainer } from './lib/netem-container.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const NAME = 'm8demo-stream';
const HTTP_PORT = process.env.HTTP_PORT ?? '18720';
const GRPC_PORT = process.env.GRPC_PORT ?? '18721';
const DELAY = process.env.NET_DELAY_MS ?? '20';
const RATE = process.env.NET_RATE ?? '20mbit';
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const CALLS_PER_ROUND = 25;
const LIMIT = 2000;

let created = false;
process.on('exit', () => created && removeContainer(NAME));

const lines = [];
const out = (s = '') => {
  console.log(s);
  lines.push(s);
};
const f1 = (n) => (Number.isFinite(n) ? n.toFixed(1) : '-');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

try {
  await startContainer({ root, name: NAME, httpPort: HTTP_PORT, grpcPort: GRPC_PORT });
  created = true;

  const c = createClients({ root, httpPort: HTTP_PORT, grpcPort: GRPC_PORT, grpcOptions: { 'grpc-node.flow_control_window': 8 * 1024 * 1024 } });
  // Cada variante recibe markFirst(): se llama cuando el cliente ya tiene el primer elemento utilizable.
  const variants = [
    ['REST, arreglo JSON (hay que esperar todo)', async (markFirst) => { await c.rest(`/students?limit=${LIMIT}`); markFirst(); }],
    ['REST, NDJSON en flujo', async (markFirst) => { let first = true; await c.restStream(`/stream/students?limit=${LIMIT}`, () => { if (first) { first = false; markFirst(); } }); }],
    ['gRPC unario (hay que esperar todo)', async (markFirst) => { await c.grpc('ListStudents', { limit: LIMIT }); markFirst(); }],
    ['gRPC, streaming de servidor', async (markFirst) => { let first = true; await c.grpcStream('StreamStudents', { limit: LIMIT }, () => { if (first) { first = false; markFirst(); } }); }],
  ];

  async function measure(fn) {
    const began = performance.now();
    let firstAt = NaN;
    await fn(() => { if (Number.isNaN(firstAt)) firstAt = performance.now(); });
    const total = performance.now() - began;
    return { first: firstAt - began, total };
  }

  async function runCondition(label) {
    const results = variants.map(() => ({ first: [], total: [], roundMedians: [] }));
    for (const [, fn] of variants) for (let i = 0; i < 5; i++) await measure(fn); // calentamiento
    for (let round = 0; round < ROUNDS; round++) {
      const order = variants.map((_, i) => i);
      for (let k = 0; k < round; k++) order.push(order.shift());
      for (const i of order) {
        const firsts = [];
        const totals = [];
        for (let n = 0; n < CALLS_PER_ROUND; n++) {
          const m = await measure(variants[i][1]);
          firsts.push(m.first);
          totals.push(m.total);
        }
        results[i].first.push(median(firsts));
        results[i].total.push(median(totals));
      }
    }
    out(`## ${label}`);
    out();
    out(`Lista de ${LIMIT} estudiantes, llamadas de una en una. Mediana de ${ROUNDS} rondas de ${CALLS_PER_ROUND} llamadas (entre paréntesis, el rango entre rondas).`);
    out();
    out('| Variante | Primer estudiante disponible (ms) | Todos los estudiantes (ms) |');
    out('|---|---:|---:|');
    const fmt = (xs) => `${f1(median(xs))} (${f1(Math.min(...xs))}–${f1(Math.max(...xs))})`;
    variants.forEach(([name], i) => out(`| ${name} | ${fmt(results[i].first)} | ${fmt(results[i].total)} |`));
    out();
  }

  out('# Streaming frente a respuesta completa');
  out();
  await runCondition('Sin red limitada (contenedor Docker, red por defecto)');
  applyNetem(NAME, { delayMs: DELAY, rate: RATE });
  await runCondition(`Con red limitada (${DELAY} ms de retardo, ${RATE})`);

  c.close();
  mkdirSync(join(root, 'results'), { recursive: true });
  writeFileSync(join(root, 'results/STREAM.md'), lines.join('\n') + '\n');
} finally {
  if (created) removeContainer(NAME);
}
