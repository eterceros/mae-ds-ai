// C7: ventana de datos obsoletos. Se escribe un pedido nuevo de un producto cuyo resumen está en caché y se mide
// cuánto tarda la API en devolver el resumen con ese pedido (consultando cada 10 ms).
//   1) Solo TTL (5 s): nadie borra la clave; la escritura llega en un momento al azar del TTL.
//   2) Invalidar al escribir: DEL de la clave después del commit.
//   3) Invalidar con una lectura lenta en vuelo: la clave acaba de vencer, una lectura empieza a recalcular
//      (consulta de ~40 ms) y 10 ms después llega la escritura. La lectura vieja vuelve a guardar el valor viejo
//      DESPUÉS del DEL: es la carrera clásica de cache-aside. Se reproduce a propósito en cada intento.
//   4) Lo mismo que 3, con doble borrado (otro DEL 300 ms después).
// Uso: node scripts/bench-stale.mjs  (unos 2 min). Variables: TRIALS (10).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PG_URL, REDIS_URL } from './lib/env.mjs';
import { f0, machine, median, post, request, rng, root, startApis, writer } from './lib/harness.mjs';

const TRIALS = Number(process.env.TRIALS ?? 10);
const TTL = 5000;
const db = new pg.Client(PG_URL);
await db.connect();
await db.query('DROP INDEX IF EXISTS orders_product_idx');
const redis = new Redis(REDIS_URL);
const { ports, stop } = await startApis(1);
const port = ports[0];
const { out, text } = writer();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rand = rng(5);
const read = async (id) => JSON.parse((await request(port, `/cache/redis/products/${id}/summary?ttl=${TTL}`)).body).orders;

// Devuelve los ms desde que terminó la escritura hasta la primera lectura que ya incluye el pedido nuevo.
// Cuenta también cuántas lecturas devolvieron el valor viejo.
let staleReads = 0;
async function waitFresh(id, expected, tWrite) {
  for (;;) {
    if ((await read(id)) >= expected) return performance.now() - tWrite;
    staleReads += 1;
    await sleep(10);
  }
}

const modes = [
  {
    name: `1) Solo TTL (${TTL / 1000} s), escritura en un momento al azar`,
    async trial(id) {
      const before = await read(id);
      await sleep(rand() * TTL);
      await post(port, `/products/${id}/orders`);
      const t = performance.now();
      return waitFresh(id, before + 1, t);
    },
  },
  {
    name: '2) Invalidar al escribir (DEL después del commit)',
    async trial(id) {
      const before = await read(id);
      await sleep(rand() * TTL);
      await post(port, `/products/${id}/orders?invalidate=redis`);
      const t = performance.now();
      return waitFresh(id, before + 1, t);
    },
  },
  {
    name: '3) Invalidar al escribir, con una lectura lenta en vuelo (carrera)',
    async trial(id) {
      const before = await read(id);
      await redis.del(`summary:${id}`); // la clave acaba de vencer
      const slowRead = read(id); // empieza a recalcular con los datos de antes
      await sleep(10);
      await post(port, `/products/${id}/orders?invalidate=redis`);
      const t = performance.now();
      await slowRead; // guarda el valor viejo después del DEL
      return waitFresh(id, before + 1, t);
    },
  },
  {
    name: '4) Igual que 3, con doble borrado (otro DEL a los 300 ms)',
    async trial(id) {
      const before = await read(id);
      await redis.del(`summary:${id}`);
      const slowRead = read(id);
      await sleep(10);
      await post(port, `/products/${id}/orders?invalidate=redis&redelete=300`);
      const t = performance.now();
      await slowRead;
      return waitFresh(id, before + 1, t);
    },
  },
];

try {
  out('# C7. Datos obsoletos: TTL frente a invalidar al escribir');
  out();
  out(`Medido el ${new Date().toISOString().slice(0, 10)}. Máquina: ${machine()}.`);
  out();
  out(`Ventana de datos obsoletos = tiempo desde que la escritura respondió hasta que una lectura (una cada 10 ms) devuelve el resumen con el pedido nuevo. Incluye lo que tarda esa lectura: si la clave se borró, la primera lectura recalcula (~40 ms) y ya trae el dato nuevo. Redis, TTL ${TTL / 1000} s, sin índice (recalcular cuesta ~40 ms). ${TRIALS} intentos por modo, cada uno sobre un producto distinto.`);
  out();
  out('| Modo | Mín. (ms) | Mediana (ms) | Máx. (ms) | Intentos con más de 1 s obsoleto | Lecturas con el valor viejo (total) |');
  out('|---|---:|---:|---:|---:|---:|');
  let id = 4001;
  for (const mode of modes) {
    await redis.flushall();
    const w = [];
    staleReads = 0;
    for (let i = 0; i < TRIALS; i++) w.push(await mode.trial(id++));
    out(`| ${mode.name} | ${f0(Math.min(...w))} | ${f0(median(w))} | ${f0(Math.max(...w))} | ${w.filter((x) => x > 1000).length} de ${TRIALS} | ${staleReads} |`);
  }
  out();
  out('Los pedidos de prueba se marcan con `note = \'demo-c7\'`; `npm run seed` deja la base como al principio.');
  writeFileSync(join(root, 'results/C7_OBSOLETOS.md'), text());
} finally {
  await db.end();
  redis.disconnect();
  stop();
}
