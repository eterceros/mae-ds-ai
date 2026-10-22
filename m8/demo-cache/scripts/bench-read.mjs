// C1-C5: lecturas del resumen de un producto (consulta costosa) con distintas estrategias.
//   Grupo 1, sin índice: C1 sin caché, C3a ETag sobre el cuerpo, C3b ETag por versión, C4 Redis, C5 Valkey.
//   Grupo 2, con índice (C2): solo índice, e índice + Redis.
// Metodología igual a la demo de S05: (1) máximo de peticiones/s en bucle cerrado con 10 trabajadores;
// (2) latencia a ritmo fijo común al grupo (40 % de lo que aguanta la variante más lenta). Mediana de ROUNDS rondas.
// Los productos se eligen con una distribución Zipf (s = 1) sobre 5000 productos.
// Antes de cada variante se vacían las cachés (arranque en frío) y la caché de ETags del cliente.
// Uso: node scripts/bench-read.mjs  (unos 6 min). Variables: ROUNDS (3).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PG_URL, PRODUCTS, REDIS_URL, VALKEY_URL } from './lib/env.mjs';
import { f0, f1, machine, median, range, request, resetStats, root, startApis, sumStats, writer, zipf } from './lib/harness.mjs';
import { openLoop, saturate } from './lib/load.mjs';

const ROUNDS = Number(process.env.ROUNDS ?? 3);
const LOAD_FRACTION = 0.4;
const TTL = 30_000;

const db = new pg.Client(PG_URL);
await db.connect();
const redis = new Redis(REDIS_URL);
const valkey = new Redis(VALKEY_URL);
const { ports, stop } = await startApis(1);
const port = ports[0];
const { out, text } = writer();

let pick = zipf(PRODUCTS, 1, 7);
const etags = new Map();
const counters = { requests: 0, bytes: 0, notModified: 0 };

const plain = (prefix, suffix = '') => async () => {
  const r = await request(port, `${prefix}/${pick()}/summary${suffix}`);
  counters.requests += 1;
  counters.bytes += r.bytes;
};
const withEtag = (prefix) => async () => {
  const id = pick();
  const known = etags.get(id);
  const r = await request(port, `${prefix}/${id}/summary`, { headers: known ? { 'if-none-match': known } : {} });
  counters.requests += 1;
  counters.bytes += r.bytes;
  if (r.status === 304) counters.notModified += 1;
  else etags.set(id, r.etag);
};

const groups = [
  {
    title: 'Sin índice en orders.product_id (C1, C3, C4, C5)',
    index: false,
    variants: [
      ['C1 sin caché (siempre a Postgres)', plain('/db/products'), 'none'],
      ['C3a ETag sobre el cuerpo (304 si no cambió)', withEtag('/etag-body/products'), 'etag'],
      ['C3b ETag por versión del producto', withEtag('/etag-version/products'), 'etag'],
      [`C4 Redis cache-aside, TTL ${TTL / 1000} s`, plain('/cache/redis/products', `?ttl=${TTL}`), 'cache'],
      [`C5 Valkey cache-aside, TTL ${TTL / 1000} s`, plain('/cache/valkey/products', `?ttl=${TTL}`), 'cache'],
    ],
  },
  {
    title: 'Con índice (C2): CREATE INDEX ... ON orders (product_id) INCLUDE (created_at, amount)',
    index: true,
    variants: [
      ['C2 solo índice (siempre a Postgres)', plain('/db/products'), 'none'],
      [`C2 + Redis cache-aside, TTL ${TTL / 1000} s`, plain('/cache/redis/products', `?ttl=${TTL}`), 'cache'],
    ],
  },
];

async function fresh() {
  await redis.flushall();
  await valkey.flushall();
  etags.clear();
  pick = zipf(PRODUCTS, 1, 7);
  await resetStats(ports);
  Object.assign(counters, { requests: 0, bytes: 0, notModified: 0 });
}

let apiSummaryQueries = 0;
try {
  await db.query('DROP INDEX IF EXISTS orders_product_idx');
  await db.query('SELECT pg_stat_statements_reset()');

  out('# C1-C5. Lecturas: sin caché, índice, ETag, Redis y Valkey');
  out();
  out(`Medido el ${new Date().toISOString().slice(0, 10)}. Máquina: ${machine()}.`);
  out();
  out('Una instancia de la API (Fastify, pool de 10 conexiones a Postgres), cliente Node en la misma máquina, servidores en Docker.');
  out(`Tabla \`orders\` con 3 millones de filas; productos elegidos con Zipf (s = 1) sobre ${PRODUCTS}. Cada cifra es la mediana de ${ROUNDS} rondas; entre paréntesis, el rango.`);
  out();
  out('- **Máx. pet/s:** bucle cerrado, 10 trabajadores, 2 s de calentamiento y 4 s medidos. Antes de cada variante se vacían las cachés (arranca en frío).');
  out(`- **Latencia:** llegadas a ritmo fijo, común al grupo (${LOAD_FRACTION * 100} % de lo que aguanta la variante más lenta), 8 s medidos; justo después de la prueba anterior (caché ya caliente).`);
  out('- **Consultas a PG por 1000 pet.:** consultas del resumen (la costosa) + lecturas de versión (C3b), contadas por la API durante la prueba de máximo.');
  out('- **Aciertos:** proporción de peticiones servidas desde la caché (C4/C5) o respondidas con 304 (C3), en la prueba de máximo (arranca en frío) y en la de latencia (ya caliente).');
  out('- **Bytes/pet.:** bytes del cuerpo de la respuesta, en promedio (un 304 no lleva cuerpo).');
  out();

  for (const group of groups) {
    if (group.index) {
      const t0 = performance.now();
      await db.query('CREATE INDEX orders_product_idx ON orders (product_id) INCLUDE (created_at, amount)');
      await db.query('VACUUM ANALYZE orders');
      out(`Índice creado en ${f0(performance.now() - t0)} ms (con VACUUM ANALYZE para que el plan use *index-only scan*).`);
      out();
    }
    const { rows: plan } = await db.query(
      `EXPLAIN (ANALYZE, BUFFERS) SELECT date_trunc('month', created_at), count(*), sum(amount) FROM orders WHERE product_id = 1 GROUP BY 1 ORDER BY 1`,
    );
    const planText = plan.map((r) => r['QUERY PLAN']);

    const calibration = [];
    for (const [, call] of group.variants) {
      await fresh();
      calibration.push((await saturate(call, { warmupS: 1, seconds: 2 })).rps);
      apiSummaryQueries += (await sumStats(ports)).summaryQueries;
    }
    const rate = Math.max(5, Math.floor(Math.min(...calibration) * LOAD_FRACTION));

    const res = group.variants.map(() => ({ rps: [], p50: [], p95: [], p99: [], q: [], hit: [], hitLat: [], bytes: [], errors: 0 }));
    for (let round = 0; round < ROUNDS; round++) {
      const order = group.variants.map((_, i) => i);
      for (let k = 0; k < round; k++) order.push(order.shift());
      for (const i of order) {
        const [, call, kind] = group.variants[i];
        await fresh();
        const sat = await saturate(call);
        const s = await sumStats(ports);
        apiSummaryQueries += s.summaryQueries;
        const r = res[i];
        r.rps.push(sat.rps);
        r.q.push(((s.summaryQueries + s.versionQueries) / counters.requests) * 1000);
        r.bytes.push(counters.bytes / counters.requests);
        if (kind === 'cache') r.hit.push((100 * s.hits) / (s.hits + s.misses));
        if (kind === 'etag') r.hit.push((100 * counters.notModified) / counters.requests);
        await resetStats(ports);
        const before = { ...counters };
        const lat = await openLoop(call, { rate });
        const s2 = await sumStats(ports);
        apiSummaryQueries += s2.summaryQueries;
        if (kind === 'cache') r.hitLat.push((100 * s2.hits) / (s2.hits + s2.misses));
        if (kind === 'etag') r.hitLat.push((100 * (counters.notModified - before.notModified)) / (counters.requests - before.requests));
        r.p50.push(lat.p50);
        r.p95.push(lat.p95);
        r.p99.push(lat.p99);
        r.errors += sat.errors + lat.errors + lat.dropped;
      }
    }

    out(`## ${group.title}`);
    out();
    out(`Ritmo común de la prueba de latencia: ${rate} pet/s.`);
    out();
    out('| Variante | Máx. pet/s | p50 (ms) | p95 (ms) | p99 (ms) | Consultas a PG por 1000 pet. | Aciertos (máx. / latencia) | Bytes/pet. | Errores |');
    out('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
    group.variants.forEach(([name], i) => {
      const r = res[i];
      out(
        `| ${name} | ${f1(median(r.rps))} (${range(r.rps)}) | ${f1(median(r.p50))} (${range(r.p50)}) | ${f1(median(r.p95))} (${range(r.p95)}) | ${f1(median(r.p99))} (${range(r.p99)}) | ${f0(median(r.q))} | ${r.hit.length ? f0(median(r.hit)) + ' % / ' + f0(median(r.hitLat)) + ' %' : '-'} | ${f0(median(r.bytes))} | ${r.errors} |`,
      );
    });
    out();
    out('Plan de la consulta para un producto (`EXPLAIN (ANALYZE, BUFFERS)`, extracto):');
    out();
    out('```');
    for (const l of planText.filter((l) => /Scan|Execution Time|Heap Fetches|Rows Removed/.test(l))) out(l.trim());
    out('```');
    out();
  }

  // Cómo se calienta la caché: 60 s a ritmo fijo con Redis y TTL de 20 s, aciertos por tramos de 5 s.
  await db.query('DROP INDEX IF EXISTS orders_product_idx');
  await fresh();
  const WARM_RATE = 60;
  const WARM_TTL = 20_000;
  out(`## Cómo se calienta la caché (C4, Redis, TTL ${WARM_TTL / 1000} s, ${WARM_RATE} pet/s fijas durante 60 s, sin índice)`);
  out();
  out('| Tramo (s) | Aciertos | Consultas a PG en el tramo | p99 del tramo (ms) |');
  out('|---|---:|---:|---:|');
  const warmCall = plain('/cache/redis/products', `?ttl=${WARM_TTL}`);
  for (let t = 0; t < 60; t += 5) {
    await resetStats(ports);
    const lat = await openLoop(warmCall, { rate: WARM_RATE, warmupS: 0, seconds: 5 });
    const s = await sumStats(ports);
    apiSummaryQueries += s.summaryQueries;
    out(`| ${t}-${t + 5} | ${f0((100 * s.hits) / (s.hits + s.misses))} % | ${s.summaryQueries} | ${f1(lat.p99)} |`);
  }
  out();

  const { rows } = await db.query(
    `SELECT coalesce(sum(calls), 0)::bigint AS calls FROM pg_stat_statements WHERE query LIKE '%to_char(date_trunc%'`,
  );
  out(
    `Comprobación: la API contó ${apiSummaryQueries} consultas del resumen; \`pg_stat_statements\` registró ${rows[0].calls} (la diferencia, si la hay, son peticiones que quedaron en vuelo al terminar cada prueba).`,
  );
  writeFileSync(join(root, 'results/C1-C5_LECTURAS.md'), text());
} finally {
  await db.query('DROP INDEX IF EXISTS orders_product_idx').catch(() => {});
  await db.end();
  redis.disconnect();
  valkey.disconnect();
  stop();
}
