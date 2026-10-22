// C8: estructuras de Redis/Valkey más allá de GET/SET.
//   A) Rate limiting, 10 peticiones por segundo por cliente, en la API:
//      ventana fija (INCR + PEXPIRE) frente a ventana deslizante (ZSET con marcas de tiempo), ambos en Lua.
//   B) Ranking de productos por ingresos: ZSET (ZINCRBY / ZREVRANGE) frente a la consulta SQL equivalente.
// Uso: node scripts/bench-structures.mjs  (alrededor de 1 min).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PG_URL, REDIS_URL, VALKEY_URL } from './lib/env.mjs';
import { f0, f1, machine, request, root, startApis, writer } from './lib/harness.mjs';
import { pct } from './lib/load.mjs';

const db = new pg.Client(PG_URL);
await db.connect();
await db.query('DROP INDEX IF EXISTS orders_product_idx');
const stores = { Redis: new Redis(REDIS_URL), Valkey: new Redis(VALKEY_URL) };
const redis = stores.Redis;
const { ports, stop } = await startApis(1);
const port = ports[0];
const { out, text } = writer();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const status = async (algo, client) => (await request(port, `/limited/${algo}?client=${client}`)).status;
const NAMES = { fixed: 'Ventana fija (INCR + PEXPIRE)', sliding: 'Ventana deslizante (ZSET)' };

async function timeIt(fn, n) {
  const t = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await fn(i);
    t.push(performance.now() - s);
  }
  t.sort((a, b) => a - b);
  return { p50: pct(t, 0.5), p99: pct(t, 0.99) };
}

try {
  await redis.flushall();
  out('# C8. Estructuras: rate limiting y ranking');
  out();
  out(`Medido el ${new Date().toISOString().slice(0, 10)}. Máquina: ${machine()}.`);
  out();
  out('## A) Rate limiting: 10 peticiones por segundo por cliente');
  out();

  // A1: ráfaga en el borde de la ventana.
  out('### A1. Ráfaga en el borde: 10 peticiones 50 ms antes de que cambie el segundo y 10 peticiones 50 ms después');
  out();
  out('| Algoritmo | Aceptadas en el 1.er grupo | Aceptadas en el 2.º grupo | Aceptadas en ~100 ms (límite: 10 por s) |');
  out('|---|---:|---:|---:|');
  for (const algo of ['fixed', 'sliding']) {
    const results = [];
    for (let rep = 0; rep < 3; rep++) {
      const client = `edge-${algo}-${rep}`;
      while (Date.now() % 1000 < 900 || Date.now() % 1000 > 950) await sleep(1);
      const boundary = Math.ceil(Date.now() / 1000) * 1000;
      await sleep(boundary - 50 - Date.now());
      const a = await Promise.all(Array.from({ length: 10 }, () => status(algo, client)));
      await sleep(Math.max(0, boundary + 50 - Date.now()));
      const b = await Promise.all(Array.from({ length: 10 }, () => status(algo, client)));
      results.push([a.filter((s) => s === 200).length, b.filter((s) => s === 200).length]);
    }
    const r = results.map(([a, b]) => `${a}`).join(', ');
    const s = results.map(([, b]) => `${b}`).join(', ');
    const t = results.map(([a, b]) => `${a + b}`).join(', ');
    out(`| ${NAMES[algo]} | ${r} | ${s} | ${t} |`);
  }
  out();
  out('Tres repeticiones por algoritmo (una cifra por repetición).');
  out();

  // A2: carga sostenida por encima del límite.
  out('### A2. Un cliente que envía 50 peticiones por segundo durante 6 s');
  out();
  out('| Algoritmo | Aceptadas por segundo (promedio) | Máximo aceptado en cualquier ventana de 1 s | Rechazadas (429) |');
  out('|---|---:|---:|---:|');
  for (const algo of ['fixed', 'sliding']) {
    const client = `steady-${algo}`;
    const accepted = [];
    let rejected = 0;
    const pending = [];
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      pending.push(
        status(algo, client).then((s) => {
          if (s === 200) accepted.push(Date.now());
          else rejected += 1;
        }),
      );
      await sleep(20);
    }
    await Promise.all(pending);
    accepted.sort((a, b) => a - b);
    let maxWin = 0;
    for (let i = 0, j = 0; i < accepted.length; i++) {
      while (accepted[j] < accepted[i] - 999) j++;
      maxWin = Math.max(maxWin, i - j + 1);
    }
    out(`| ${NAMES[algo]} | ${f1(accepted.length / 6)} | ${maxWin} | ${rejected} |`);
  }
  out();

  // A3: costo.
  const fixedLat = await timeIt((i) => status('fixed', `cost-${i}`), 2000);
  const slidingLat = await timeIt((i) => status('sliding', `cost-${i}`), 2000);
  const fixedKey = (await redis.keys('rl:fixed:steady-fixed:*'))[0];
  const now = Date.now();
  for (let i = 0; i < 10; i++) await redis.zadd('rl:mem-sliding', now + i, `${now}-${i}-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`);
  await redis.set('rl:mem-fixed', 10, 'PX', 1000);
  out('### A3. Costo');
  out();
  out('| Algoritmo | p50 de la petición HTTP completa (ms) | p99 (ms) | Memoria por cliente (MEMORY USAGE, bytes) |');
  out('|---|---:|---:|---:|');
  out(`| ${NAMES.fixed} | ${f1(fixedLat.p50)} | ${f1(fixedLat.p99)} | ${await redis.call('MEMORY', 'USAGE', 'rl:mem-fixed')} (un contador) |`);
  out(`| ${NAMES.sliding} | ${f1(slidingLat.p50)} | ${f1(slidingLat.p99)} | ${await redis.call('MEMORY', 'USAGE', 'rl:mem-sliding')} (10 marcas de tiempo) |`);
  out();
  out(`2000 peticiones secuenciales, cada una de un cliente distinto (todas aceptadas). La memoria de la ventana deslizante crece con el límite: guarda una entrada por petición aceptada en la ventana. (Clave de ejemplo de la ventana fija: \`${fixedKey ?? 'rl:fixed:<cliente>:<segundo>'}\`.)`);
  out();

  // B) Ranking.
  out('## B) Ranking de los 10 productos con más ingresos (5000 productos, 3 millones de pedidos)');
  out();
  const sql = 'SELECT product_id, sum(amount) AS revenue FROM orders GROUP BY product_id ORDER BY revenue DESC LIMIT 10';
  const t0 = performance.now();
  const { rows: all } = await db.query('SELECT product_id, sum(amount)::float8 AS revenue FROM orders GROUP BY product_id');
  const loadMs = performance.now() - t0;
  const sqlLat = await timeIt(() => db.query(sql), 20);
  const sqlTop = (await db.query(sql)).rows.map((r) => r.product_id);
  out('| Operación | p50 (ms) | p99 (ms) | Repeticiones |');
  out('|---|---:|---:|---:|');
  out(`| SQL: \`GROUP BY product_id ORDER BY sum(amount) DESC LIMIT 10\` | ${f1(sqlLat.p50)} | ${f1(sqlLat.p99)} | 20 |`);
  const same = [];
  for (const [name, r] of Object.entries(stores)) {
    await r.del('ranking:revenue');
    const pipe = r.pipeline();
    for (const row of all) pipe.zadd('ranking:revenue', row.revenue, String(row.product_id));
    await pipe.exec();
    const top = await timeIt(() => r.zrevrange('ranking:revenue', 0, 9, 'WITHSCORES'), 2000);
    const inc = await timeIt((i) => r.zincrby('ranking:revenue', 1, String(1 + (i % 5000))), 2000);
    const rank = await timeIt((i) => r.zrevrank('ranking:revenue', String(1 + (i % 5000))), 2000);
    out(`| ${name}: \`ZREVRANGE ranking 0 9 WITHSCORES\` (top 10) | ${f1(top.p50)} | ${f1(top.p99)} | 2000 |`);
    out(`| ${name}: \`ZINCRBY\` (registrar una venta) | ${f1(inc.p50)} | ${f1(inc.p99)} | 2000 |`);
    out(`| ${name}: \`ZREVRANK\` (posición de un producto) | ${f1(rank.p50)} | ${f1(rank.p99)} | 2000 |`);
    const memory = await r.call('MEMORY', 'USAGE', 'ranking:revenue');
    same.push(`${name}: ${memory} bytes`);
  }
  out();
  out(`Carga inicial del ZSET desde Postgres (una agregación de ${f0(loadMs)} ms y un *pipeline* de 5000 ZADD). Memoria del ZSET: ${same.join('; ')}. Top 10 por SQL: ${sqlTop.join(', ')}.`);
  out();
  out('Las latencias de Redis/Valkey incluyen el viaje de ida y vuelta desde Node (loopback a Docker); la del SQL incluye recorrer los 3 millones de filas cada vez.');
  writeFileSync(join(root, 'results/C8_ESTRUCTURAS.md'), text());
} finally {
  await db.end();
  for (const r of Object.values(stores)) r.disconnect();
  stop();
}
