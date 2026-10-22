// C9: maxmemory pequeño y política de expulsión: efecto en el hit ratio, en Redis y en Valkey.
// Simula cache-aside directamente contra el servidor (GET; si falla, SET de un valor de 1 KB), sin API ni Postgres,
// para poder hacer cientos de miles de operaciones por corrida.
//   Carga A: 50 000 claves posibles con Zipf (s = 1): pocas claves muy pedidas y una cola larga.
//   Carga B: la misma, más un barrido cada 20 000 operaciones: 10 000 claves que se piden una sola vez
//            (un proceso por lotes, un rastreador, un informe). Es el caso en que LRU y LFU se separan.
// Políticas: allkeys-lru, allkeys-lfu, allkeys-random, noeviction; y sin límite de memoria como techo.
// Uso: node scripts/bench-eviction.mjs  (unos 4-6 min).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Redis } from 'ioredis';
import { REDIS_URL, VALKEY_URL } from './lib/env.mjs';
import { f0, f1, machine, root, writer, zipf } from './lib/harness.mjs';

const UNIVERSE = 50_000;
const OPS = 200_000;
const MAXMEMORY = process.env.MAXMEMORY ?? '16mb';
const WORKERS = 50;
const VALUE = 'x'.repeat(1000);
const POLICIES = ['allkeys-lru', 'allkeys-lfu', 'allkeys-random', 'noeviction', 'sin límite'];
const { out, text } = writer();

function workload(withScans) {
  const pick = zipf(UNIVERSE, 1, 3);
  const ops = [];
  let scanBase = UNIVERSE;
  for (let i = 0; i < OPS; i++) {
    ops.push({ key: `k:${pick()}`, hot: true });
    if (withScans && i % 20_000 === 19_999) {
      for (let j = 0; j < 10_000; j++) ops.push({ key: `k:${++scanBase}`, hot: false });
    }
  }
  return ops;
}

async function run(r, ops, policy) {
  await r.flushall();
  await r.config('SET', 'maxmemory', policy === 'sin límite' ? '0' : MAXMEMORY);
  await r.config('SET', 'maxmemory-policy', policy === 'sin límite' ? 'noeviction' : policy);
  await r.config('RESETSTAT');
  const skip = Math.floor(ops.length / 4); // el primer cuarto calienta la caché y no se cuenta
  let next = 0;
  let hits = 0;
  let hotTotal = 0;
  let errors = 0;
  const t0 = performance.now();
  await Promise.all(
    Array.from({ length: WORKERS }, async () => {
      while (next < ops.length) {
        const i = next++;
        const op = ops[i];
        const v = await r.get(op.key);
        if (i >= skip && op.hot) {
          hotTotal += 1;
          if (v !== null) hits += 1;
        }
        if (v === null) {
          try {
            await r.set(op.key, VALUE);
          } catch {
            errors += 1; // noeviction: OOM command not allowed when used memory > 'maxmemory'
          }
        }
      }
    }),
  );
  const seconds = (performance.now() - t0) / 1000;
  const info = await r.info();
  const field = (name) => Number(info.match(new RegExp(`^${name}:(\\d+)`, 'm'))?.[1] ?? NaN);
  return {
    hit: (100 * hits) / hotTotal,
    evicted: field('evicted_keys'),
    keys: await r.dbsize(),
    usedMb: field('used_memory') / 2 ** 20,
    errors,
    opsPerS: (ops.length * 1) / seconds,
  };
}

const servers = [
  ['Redis', new Redis(REDIS_URL)],
  ['Valkey', new Redis(VALKEY_URL)],
];
try {
  out('# C9. maxmemory y política de expulsión');
  out();
  out(`Medido el ${new Date().toISOString().slice(0, 10)}. Máquina: ${machine()}.`);
  out();
  out(`Cache-aside simulado contra el servidor: GET y, si falla, SET de un valor de 1000 bytes. ${UNIVERSE} claves posibles con Zipf (s = 1), ${OPS} peticiones, ${WORKERS} en vuelo a la vez. \`maxmemory ${MAXMEMORY}\` (alcanza para una fracción de las claves). Aciertos = sobre las peticiones de la carga Zipf, sin contar el primer cuarto (calentamiento).`);
  out();
  for (const withScans of [false, true]) {
    const ops = workload(withScans);
    out(withScans ? '## Carga B: Zipf + barridos (10 000 claves de un solo uso cada 20 000 peticiones)' : '## Carga A: solo Zipf');
    out();
    out('| Servidor | Política | Aciertos | Claves expulsadas | Claves en memoria | Memoria usada (MB) | Errores al escribir |');
    out('|---|---|---:|---:|---:|---:|---:|');
    for (const [name, r] of servers) {
      for (const policy of POLICIES) {
        const res = await run(r, ops, policy);
        out(`| ${name} | ${policy} | ${f1(res.hit)} % | ${res.evicted} | ${res.keys} | ${f1(res.usedMb)} | ${res.errors} |`);
      }
    }
    out();
  }
  out('Con `noeviction` el servidor no expulsa: cuando se llena, rechaza las escrituras con `OOM command not allowed` y la caché se queda con lo que entró primero.');
} finally {
  for (const [, r] of servers) {
    await r.config('SET', 'maxmemory', '0').catch(() => {});
    await r.config('SET', 'maxmemory-policy', 'noeviction').catch(() => {});
    r.disconnect();
  }
}
writeFileSync(join(root, 'results/C9_EXPULSION.md'), text());
