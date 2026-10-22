// C6: estampida (cache stampede) al expirar una clave caliente, con dos instancias de la API detrás.
//   A) Ráfaga: N peticiones simultáneas a la misma clave justo cuando vence. ¿Cuántas consultas llegan a Postgres?
//   B) Carga sostenida: W trabajadores pidiendo la misma clave sin parar durante 10 s, TTL de 1 s.
//   C) Muchas claves que vencen a la vez: TTL fijo frente a TTL con jitter (consultas por segundo).
// Defensas: none (sin defensa), singleflight (por proceso), lock (candado distribuido SET NX PX),
//           xfetch (recalcular antes de tiempo con probabilidad, Vattani et al. 2015),
//           swr (TTL lógico + un solo refresco en segundo plano, los demás reciben el valor viejo).
// Sin índice en orders.product_id: recalcular cuesta una consulta de ~40-50 ms.
// Uso: node scripts/bench-stampede.mjs  (unos 3 min). Variables: N (200), W (100), ROUNDS (3).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { Redis } from 'ioredis';
import { PG_URL, REDIS_URL } from './lib/env.mjs';
import { f0, f1, machine, median, request, resetStats, rng, root, startApis, sumStats, writer } from './lib/harness.mjs';
import { pct } from './lib/load.mjs';

const N = Number(process.env.N ?? 200);
const W = Number(process.env.W ?? 100);
const ROUNDS = Number(process.env.ROUNDS ?? 3);
const HOT = 1;
const TTL = 1000;
const DEFENSES = ['none', 'singleflight', 'lock', 'xfetch', 'swr'];
const NAMES = {
  none: 'Sin defensa',
  singleflight: 'Single-flight por proceso',
  lock: 'Candado distribuido (SET NX PX)',
  xfetch: 'Refresco anticipado probabilístico (XFetch)',
  swr: 'TTL lógico + refresco en 2.º plano (stale-while-revalidate)',
};

const db = new pg.Client(PG_URL);
await db.connect();
await db.query('DROP INDEX IF EXISTS orders_product_idx');
await db.end();
const redis = new Redis(REDIS_URL);
const { ports, stop } = await startApis(2);
const { out, text } = writer();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const path = (id, defense, extra = '') => `/cache/redis/products/${id}/summary?ttl=${TTL}&defense=${defense}${extra}`;
const timed = async (port, p) => {
  const t = performance.now();
  await request(port, p);
  return performance.now() - t;
};

// Abre de antemano las conexiones HTTP para que la primera ráfaga no mida el establecimiento de 200 sockets.
await Promise.all(Array.from({ length: N + W }, (_, i) => request(ports[i % 2], '/stats')));

try {
  out('# C6. Estampida al expirar una clave caliente');
  out();
  out(`Medido el ${new Date().toISOString().slice(0, 10)}. Máquina: ${machine()}.`);
  out();
  out('Dos instancias de la API (cada una con un pool de 10 conexiones a Postgres) y Redis compartido. Sin índice: recalcular el resumen cuesta una consulta de ~40-50 ms en reposo.');
  out(`TTL de la clave caliente: ${TTL} ms. Las peticiones se reparten por igual entre las dos instancias. Cada cifra es la mediana de ${ROUNDS} repeticiones.`);
  out();

  // ---------- A) Ráfaga ----------
  out(`## A) Ráfaga: ${N} peticiones simultáneas a la misma clave en el momento de expirar`);
  out();
  out('Momento de la ráfaga: `none`, `singleflight` y `lock`, 50 ms después de que la clave venció (ya no está). `swr`, 50 ms después del vencimiento lógico (la clave sigue, con el valor viejo). `xfetch`, 100 ms *antes* del vencimiento (después ya no hay valor y se comporta como `none`).');
  out();
  out('| Defensa | Consultas a Postgres | p50 de la ráfaga (ms) | Máx. de la ráfaga (ms) | Respuestas con valor viejo |');
  out('|---|---:|---:|---:|---:|');
  for (const defense of DEFENSES) {
    const q = [];
    const p50 = [];
    const max = [];
    const stale = [];
    for (let round = 0; round < ROUNDS; round++) {
      await redis.flushall();
      await request(ports[0], path(HOT, defense)); // carga la clave
      await sleep(defense === 'xfetch' ? TTL - 100 : TTL + 50);
      await resetStats(ports);
      const lat = await Promise.all(Array.from({ length: N }, (_, i) => timed(ports[i % 2], path(HOT, defense))));
      await sleep(300); // deja terminar un refresco en segundo plano (swr)
      const s = await sumStats(ports);
      lat.sort((a, b) => a - b);
      q.push(s.summaryQueries);
      p50.push(pct(lat, 0.5));
      max.push(lat[lat.length - 1]);
      stale.push(s.staleServed);
    }
    out(`| ${NAMES[defense]} | ${f0(median(q))} (${Math.min(...q)}–${Math.max(...q)}) | ${f1(median(p50))} | ${f1(median(max))} | ${f0(median(stale))} |`);
  }
  out();

  // ---------- B) Carga sostenida ----------
  const SECONDS = 10;
  out(`## B) Carga sostenida: ${W} trabajadores en bucle cerrado sobre la misma clave durante ${SECONDS} s (TTL ${TTL} ms)`);
  out();
  out('| Defensa | Consultas a Postgres | Consultas por vencimiento (aprox.) | Pet/s | p50 (ms) | p99 (ms) | Máx. (ms) |');
  out('|---|---:|---:|---:|---:|---:|---:|');
  for (const defense of DEFENSES) {
    const rows = [];
    for (let round = 0; round < ROUNDS; round++) {
      await redis.flushall();
      await request(ports[0], path(HOT, defense));
      await resetStats(ports);
      const lat = [];
      const end = performance.now() + SECONDS * 1000;
      let i = 0;
      await Promise.all(
        Array.from({ length: W }, async () => {
          while (performance.now() < end) lat.push(await timed(ports[i++ % 2], path(HOT, defense)));
        }),
      );
      await sleep(300);
      const s = await sumStats(ports);
      lat.sort((a, b) => a - b);
      rows.push({ q: s.summaryQueries, rps: lat.length / SECONDS, p50: pct(lat, 0.5), p99: pct(lat, 0.99), max: lat[lat.length - 1] });
    }
    const m = (k) => median(rows.map((r) => r[k]));
    const expirations = (SECONDS * 1000) / TTL;
    out(`| ${NAMES[defense]} | ${f0(m('q'))} | ${f1(m('q') / expirations)} | ${f0(m('rps'))} | ${f1(m('p50'))} | ${f1(m('p99'))} | ${f1(m('max'))} |`);
  }
  out();
  out(`"Consultas por vencimiento" divide el total entre ${SECONDS * 1000 / TTL} vencimientos (${SECONDS} s / TTL). Con \`xfetch\` y \`swr\` la clave casi nunca llega a vencer: el número muestra cuántas veces se recalculó.`);
  out();

  // ---------- C) Jitter ----------
  const KEYS = 100;
  const JTTL = 5000;
  const JSECONDS = 16;
  out(`## C) ${KEYS} claves distintas cargadas a la vez, TTL de ${JTTL / 1000} s fijo frente a TTL con jitter de ±50 %`);
  out();
  out(`Las ${KEYS} claves se cargan juntas en el segundo 1 (como tras un despliegue o un reinicio de la caché); después 50 trabajadores piden claves al azar (uniforme entre ${KEYS}) hasta el segundo ${JSECONDS}. Las dos filas usan además el candado distribuido, para que cada clave que vence cueste una sola consulta y se vea solo el efecto de que venzan muchas claves *distintas* a la vez. Consultas a Postgres en cada segundo (suma de las dos instancias; el segundo 1 incluye la carga inicial):`);
  out();
  const header = Array.from({ length: JSECONDS }, (_, s) => `${s + 1}`);
  out(`| TTL | ${header.join(' | ')} | Máx./s (desde el s 2) | p99 (ms) | Máx. (ms) |`);
  out(`|---|${header.map(() => '---:').join('|')}|---:|---:|---:|`);
  for (const [label, jitter] of [
    ['fijo 5 s', 0],
    ['5 s ± 50 %', 0.5],
  ]) {
    await redis.flushall();
    const extra = `&jitter=${jitter}`;
    const p = (id) => `/cache/redis/products/${id}/summary?ttl=${JTTL}&defense=lock${extra}`;
    await resetStats(ports);
    const rand = rng(11);
    const lat = [];
    const perSecond = [];
    let last = 0;
    const end = performance.now() + JSECONDS * 1000;
    const poll = setInterval(async () => {
      const s = await sumStats(ports);
      perSecond.push(s.summaryQueries - last);
      last = s.summaryQueries;
    }, 1000);
    // Carga inicial: todas las claves a la vez.
    await Promise.all(Array.from({ length: KEYS }, (_, k) => request(ports[k % 2], p(k + 1))));
    let j = 0;
    await Promise.all(
      Array.from({ length: 50 }, async () => {
        while (performance.now() < end) lat.push(await timed(ports[j++ % 2], p(1 + Math.floor(rand() * KEYS))));
      }),
    );
    clearInterval(poll);
    if (perSecond.length < JSECONDS) perSecond.push((await sumStats(ports)).summaryQueries - last);
    lat.sort((a, b) => a - b);
    const cells = Array.from({ length: JSECONDS }, (_, s) => perSecond[s] ?? '-');
    out(`| ${label} | ${cells.join(' | ')} | ${Math.max(...perSecond.slice(1))} | ${f1(pct(lat, 0.99))} | ${f1(lat[lat.length - 1])} |`);
  }
  out();
  writeFileSync(join(root, 'results/C6_ESTAMPIDA.md'), text());
} finally {
  redis.disconnect();
  stop();
}
