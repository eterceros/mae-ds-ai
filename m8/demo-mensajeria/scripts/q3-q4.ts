// Q3 y Q4: consumidor sin idempotencia frente a consumidor con tabla de procesados.
// Cadena completa: API (outbox) -> 2 relays -> RabbitMQ -> worker de envíos -> tabla shipments.
// Fuentes de reentrega, las dos reales: (1) los relays mueren cada 3 lotes entre publicar y COMMIT
// (reenvían el lote); (2) el worker muere en los pedidos 50, 100, ... después de confirmar el
// envío en Postgres y antes del ack (RabbitMQ reentrega lo no confirmado).
// Además se comprueba que el traceparent del cliente llega hasta el envío (mismo trace-id).
import { Supervised, resetAll, waitHttp, environment, writeResult, makePool, sleep, queueInfo, drainQueue } from './lib/harness.ts';
import { Q_SHIPPING, Q_AUDIT } from '../src/lib/amqp.ts';
import { newTraceparent, traceIdOf } from '../src/lib/trace.ts';

const N = Number(process.env.N ?? 1000);
const RUNS = Number(process.env.RUNS ?? 3);
const PORT = 18311;
const pool = makePool(4);

async function runOnce(mode: 'naive' | 'idempotent') {
  await resetAll(pool);
  const api = new Supervised('src/despues/api.ts', { PORT: String(PORT) }, 'api').start();
  const relays = [1, 2].map((i) => new Supervised('src/despues/relay.ts',
    { RELAY_ID: `relay-${i}`, RELAY_BATCH: '20', RELAY_CRASH_EVERY_BATCHES: '3' }, `relay-${i}`).start());
  const worker = new Supervised(mode === 'naive' ? 'src/antes/worker.ts' : 'src/despues/worker.ts', { PREFETCH: '20', WORKER_CRASH_EVERY: '50' }, 'worker').start();
  await waitHttp(`http://127.0.0.1:${PORT}/health`);

  const sentTrace = new Map<number, string>();
  for (let seq = 1; seq <= N; seq++) {
    const tp = newTraceparent();
    sentTrace.set(seq, traceIdOf(tp)!);
    const r = await fetch(`http://127.0.0.1:${PORT}/orders`, {
      method: 'POST', headers: { 'content-type': 'application/json', traceparent: tp },
      body: JSON.stringify({ seq, customer: `c-${seq % 37}`, amountCents: 1000 + seq }),
    });
    if (r.status !== 201) throw new Error(`pedido ${seq}: ${r.status}`);
  }
  // Esperar: outbox vacía, todos los pedidos con envío y cola sin mensajes (listos ni sin ack).
  // Las estadísticas de la consola se refrescan cada ~5 s: se exige que sigan en 0 tras 6 s.
  for (let stable = 0; stable < 2;) {
    const pend = (await pool.query('SELECT count(*)::int n FROM outbox WHERE published_at IS NULL')).rows[0].n;
    const done = (await pool.query('SELECT count(DISTINCT order_id)::int n FROM shipments')).rows[0].n;
    const q = await queueInfo(Q_SHIPPING);
    if (pend === 0 && done === N && q.messages === 0) { stable++; await sleep(6000); } else { stable = 0; await sleep(500); }
  }
  await api.stop(); for (const r of relays) await r.stop(); await worker.stop();
  // La cola de auditoría recibe una copia de cada publicación: cuenta exacta de lo que salió de los relays.
  const relayed = (await drainQueue(Q_AUDIT)).length;

  const s = (await pool.query(`
    SELECT count(*)::int AS total, count(DISTINCT order_id)::int AS distinct_orders,
           (SELECT count(*)::int FROM orders o WHERE NOT EXISTS (SELECT 1 FROM shipments s WHERE s.order_id = o.id)) AS missing
      FROM shipments`)).rows[0];
  const rows = (await pool.query('SELECT o.seq, s.traceparent FROM shipments s JOIN orders o ON o.id = s.order_id')).rows as { seq: number; traceparent: string }[];
  const traceOk = rows.filter((r) => traceIdOf(r.traceparent) === sentTrace.get(r.seq)).length;
  const dupOrders = (await pool.query(
    'SELECT count(*)::int n FROM (SELECT order_id FROM shipments GROUP BY order_id HAVING count(*) > 1) x')).rows[0].n;
  return {
    mode, orders: N, messagesIntoQueue: relayed, shipments: s.total, distinctOrders: s.distinct_orders,
    duplicates: s.total - s.distinct_orders, ordersWithDup: dupOrders, missing: s.missing,
    relayCrashes: relays.reduce((a, r) => a + r.crashes, 0), workerCrashes: worker.crashes,
    traceOk, traceTotal: rows.length,
  };
}

const env = await environment(pool);
const all = [];
for (const mode of ['naive', 'idempotent'] as const) {
  for (let i = 1; i <= RUNS; i++) {
    const r = await runOnce(mode);
    console.log(JSON.stringify(r));
    all.push({ ...r, run: i });
  }
}
await pool.end();

let md = `# Q3-Q4. Consumidor sin idempotencia frente a tabla de procesados

Medido el ${new Date().toISOString().slice(0, 10)}. ${env}

Cada corrida: ${N} pedidos por la API con outbox → 2 relays (lotes de 20, mueren cada 3 lotes entre publicar y \`COMMIT\`) → cola quorum \`${Q_SHIPPING}\` → worker de envíos (prefetch 20, ack manual) que muere en los pedidos 50, 100, …, ${N} **después** de confirmar el envío en Postgres y **antes** del ack. Supervisor que reinicia cada proceso. El efecto es una fila en \`shipments\` (sin restricción \`UNIQUE\` a propósito).

| Consumidor | Corrida | Mensajes publicados por los relays (copias incluidas) | Envíos creados | Pedidos con envío | Envíos duplicados | Pedidos sin envío | Muertes relays / worker | \`traceparent\` con el trace-id del cliente |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
`;
for (const r of all) {
  md += `| ${r.mode === 'naive' ? 'Q3 sin idempotencia' : 'Q4 tabla de procesados'} | ${r.run} | ${r.messagesIntoQueue} | ${r.shipments} | ${r.distinctOrders} | **${r.duplicates}** | ${r.missing} | ${r.relayCrashes} / ${r.workerCrashes} | ${r.traceOk} / ${r.traceTotal} |\n`;
}
md += `
Por qué:

- **Q3**: cada copia de un mensaje (reenvío del relay o reentrega tras la muerte del worker) vuelve a ejecutar el \`INSERT\`. El efecto ya estaba confirmado en Postgres; lo que faltaba era el ack, y RabbitMQ no puede saber que el trabajo ya se hizo.
- **Q4**: el worker inserta \`(consumer, event_id)\` en \`processed_messages\` (clave primaria) **en la misma transacción** que el envío. Si la copia ya fue procesada, el \`INSERT ... ON CONFLICT DO NOTHING\` no inserta nada y el worker solo hace ack. Como las dos filas se confirman juntas, no existe un estado «envío hecho pero no registrado».
- La clave es el \`eventId\` que nace en la outbox, no el \`deliveryTag\` ni el \`messageId\` que genere el broker: las copias del relay son mensajes distintos para RabbitMQ pero el mismo evento.
- \`traceparent\`: viaja como cabecera HTTP → fila de la outbox → cabecera AMQP → worker. Cada salto conserva el trace-id y cambia el span-id.
`;
writeResult('Q3-Q4_IDEMPOTENCIA.md', md);
process.exit(0);
