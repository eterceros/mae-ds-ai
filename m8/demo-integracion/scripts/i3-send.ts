// I3. Enviar a un tercero con límite: ráfaga + reintento inmediato (antes) frente a concurrencia limitada
// + Retry-After + backoff con jitter + outbox (despues), y la misma versión con ritmo propio (CLIENT_RPS).
import { makePool, SCHEMA_I3 } from '../src/lib/db.ts';
import { THIRD_PARTY_PORT, THIRD_PARTY_URL } from '../src/lib/config.ts';
import { Proc, runToEnd, waitHttp, median, range, environment, writeResult, today } from './lib/harness.ts';

const N = Number(process.env.N ?? 1000);
const RATE = Number(process.env.RATE ?? 50);
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0.02);
const RUNS = Number(process.env.RUNS ?? 3);
const pool = makePool(2);

const third = new Proc('src/sim/third-party.ts', { RATE: String(RATE), BURST: String(RATE), FAIL_RATE: String(FAIL_RATE), THIRD_PARTY_PORT: String(THIRD_PARTY_PORT) });
await waitHttp(`${THIRD_PARTY_URL}/health`);
const stats = async () => (await fetch(`${THIRD_PARTY_URL}/stats`)).json() as Promise<any>;

async function prepare() {
  await pool.query(SCHEMA_I3);
  // updated_at separados por 1 s: la marca de agua de antes/sender.ts pasa por un Date de JavaScript, que
  // solo guarda milisegundos; con clock_timestamp() varias filas caen en el mismo milisegundo y la
  // comparación "updated_at > marca" vuelve a tomar algunas (otro error clásico de las marcas de agua).
  await pool.query(`INSERT INTO orders_to_sync (id, customer, amount_cents, updated_at)
                    SELECT g, 'c-' || (g % 97), 1000 + g, timestamptz '2026-10-01 00:00:00Z' + g * interval '1 second'
                      FROM generate_series(1, $1) g`, [N]);
  await pool.query('INSERT INTO outbound (order_id) SELECT id FROM orders_to_sync ORDER BY id');
  await fetch(`${THIRD_PARTY_URL}/reset`, { method: 'POST' });
}

type Variant = { name: string; file: string; env: Record<string, string> };
const VARIANTS: Variant[] = [
  { name: 'antes', file: 'src/antes/sender.ts', env: {} },
  { name: 'despues', file: 'src/despues/sender.ts', env: { CONCURRENCY: '8' } },
  { name: 'despues + ritmo propio 45/s', file: 'src/despues/sender.ts', env: { CONCURRENCY: '8', CLIENT_RPS: String(Math.round(RATE * 0.9)) } },
];

const env = await environment(pool);
const rows: any[] = [];
for (const v of VARIANTS) {
  for (let run = 1; run <= RUNS; run++) {
    await prepare();
    const r1 = await runToEnd(v.file, v.env);
    if (!r1.result) throw new Error(r1.log.join('\n'));
    const s1 = await stats();
    // Segunda pasada inmediata: ¿recupera algo lo que falló en la primera?
    const r2 = await runToEnd(v.file, v.env);
    const s2 = await stats();
    const pending = v.name === 'antes' ? null : Number((await pool.query(`SELECT count(*) n FROM outbound WHERE status <> 'sent'`)).rows[0].n);
    const perSec = Object.values(s1.perSecond as Record<string, number>);
    const row = { variant: v.name, run, ...r1.result, received: s1.unique, lost: N - s1.unique, dupAtThird: s1.duplicates,
      thirdRequests: s1.requests, maxPerSec: Math.max(...perSec), second: r2.result, receivedAfter2: s2.unique, pending };
    rows.push(row);
    console.log(JSON.stringify(row));
  }
}
await third.stop();
await pool.end();

const f1 = (x: number) => x.toFixed(1);
let md = `# I3. Enviar a un tercero con límite: ráfaga y reintento inmediato frente a Retry-After, backoff y concurrencia limitada

Medido el ${today()}. ${env}

El «tercero» ([\`src/sim/third-party.ts\`](../src/sim/third-party.ts)) acepta **${RATE} pedidos/s** (cubeta de fichas, ráfaga de ${RATE}); por encima responde \`429\` con \`Retry-After\` en segundos; además, el ${FAIL_RATE * 100} % de las peticiones que sí entran responden \`503\` (falla pasajera, sin registrar nada). Cada corrida envía **${N} pedidos** desde Postgres y, enseguida, hace una segunda pasada para ver si recupera lo que falló. ${RUNS} corridas por variante.

- **antes** = [\`src/antes/sender.ts\`](../src/antes/sender.ts): todo a la vez (\`Promise.all\`), hasta 3 reintentos inmediatos, marca de agua que avanza aunque haya fallos.
- **despues** = [\`src/despues/sender.ts\`](../src/despues/sender.ts): tabla \`outbound\` (outbox), 8 envíos a la vez, \`Retry-After\` compartido, backoff exponencial con jitter ante \`503\`, \`Idempotency-Key\`; un envío solo se marca enviado con un 2xx.
- **despues + ritmo propio** = lo mismo con \`CLIENT_RPS=${Math.round(RATE * 0.9)}\` (un poco por debajo del límite del tercero).

| Variante | Corrida | Tiempo (s) | Peticiones | 429 | 503 | Recibidos por el tercero | **Perdidos** | 2.ª pasada: pedidos que toma | Recibidos tras la 2.ª | Pendientes en \`outbound\` | Pico aceptados/s | Duplicados en el tercero |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
`;
for (const r of rows)
  md += `| ${r.variant} | ${r.run} | ${f1(r.seconds)} | ${r.requests} | ${r.got429} | ${r.got503} | ${r.received} | **${r.lost}** | ${r.second?.orders ?? '—'} | ${r.receivedAfter2} | ${r.pending ?? '— (no hay registro)'} | ${r.maxPerSec} | ${r.dupAtThird} |\n`;
md += `
## Medianas (rango entre corridas)

| Variante | Tiempo (s) | Peticiones | 429 | Perdidos | Perdidos tras la 2.ª pasada |
|---|---|---|---|---|---|
`;
for (const v of VARIANTS) {
  const rs = rows.filter((r) => r.variant === v.name);
  const m = (f: (r: any) => number) => `${median(rs.map(f))} (${range(rs.map(f))})`;
  md += `| ${v.name} | ${f1(median(rs.map((r) => r.seconds)))} (${range(rs.map((r) => r.seconds), 1)}) | ${m((r) => r.requests)} | ${m((r) => r.got429)} | **${m((r) => r.lost)}** | ${m((r) => N - r.receivedAfter2)} |\n`;
}
md += `
Tiempo mínimo teórico para ${N} pedidos a ${RATE}/s con una ráfaga inicial de ${RATE}: ${((N - RATE) / RATE).toFixed(0)} s.
`;
writeResult('I3_ENVIO.md', md);
