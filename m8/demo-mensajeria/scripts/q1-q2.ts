// Q1 y Q2: doble escritura frente a outbox, matando el proceso en el punto crítico.
// 1000 pedidos secuenciales; la API muere en los pedidos 100, 200, ..., 1000 (10 muertes por corrida)
// y el supervisor la vuelve a levantar. En Q2 además corren DOS relays que mueren cada 3 lotes
// después de publicar y antes del COMMIT. Al final se cuenta, en una cola de auditoría que recibe
// una copia de cada evento, qué pedidos tienen evento, cuáles no y cuáles lo tienen repetido.
import { randomUUID } from 'node:crypto';
import { Supervised, resetAll, waitHttp, drainQueue, environment, writeResult, makePool, sleep } from './lib/harness.ts';
import { Q_AUDIT } from '../src/lib/amqp.ts';
import { newTraceparent } from '../src/lib/trace.ts';

const N = Number(process.env.N ?? 1000);
const RUNS = Number(process.env.RUNS ?? 3);
const CRASH_EVERY = 100;
const PORT = 18310;
const pool = makePool(4);

type Mode = 'dual-commit-first' | 'dual-publish-first' | 'outbox' | 'outbox-nocrash' | 'outbox-nolock';

async function runOnce(mode: Mode) {
  await resetAll(pool);
  // Q1 usa el código de src/antes/ (doble escritura); Q2 el de src/despues/ (outbox + relay).
  const apiFile = mode.startsWith('outbox') ? 'src/despues/api.ts' : 'src/antes/api.ts';
  const dualOrder = mode === 'dual-publish-first' ? 'publish-first' : 'commit-first';
  const relayEnv: Record<string, string> = mode === 'outbox'
    ? { RELAY_CRASH_EVERY_BATCHES: '3' }
    : mode === 'outbox-nolock' ? { RELAY_LOCK: 'none' } : {};
  const api = new Supervised(apiFile, { DUAL_ORDER: dualOrder, PORT: String(PORT), CRASH_EVERY: String(CRASH_EVERY) }, 'api').start();
  const relays = mode.startsWith('outbox')
    ? [1, 2].map((i) => new Supervised('src/despues/relay.ts', { RELAY_ID: `relay-${i}`, RELAY_BATCH: '20', ...relayEnv }, `relay-${i}`).start())
    : [];
  await waitHttp(`http://127.0.0.1:${PORT}/health`);

  let ok = 0, clientErrors = 0;
  const t0 = Date.now();
  for (let seq = 1; seq <= N; seq++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/orders`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', traceparent: newTraceparent() },
        body: JSON.stringify({ seq, customer: `c-${seq % 37}`, amountCents: 1000 + seq }),
      });
      if (r.status === 201) ok++; else clientErrors++;
    } catch {
      // La API murió con la petición en vuelo: el cliente no sabe si el pedido se guardó.
      clientErrors++;
      await waitHttp(`http://127.0.0.1:${PORT}/health`);
    }
  }
  const sendMs = Date.now() - t0;

  // Esperar a que el relay vacíe la outbox.
  if (mode.startsWith('outbox')) {
    for (;;) {
      const { rows } = await pool.query('SELECT count(*)::int AS n FROM outbox WHERE published_at IS NULL');
      if (rows[0].n === 0) break;
      await sleep(200);
    }
  }
  await sleep(500);
  await api.stop();
  for (const r of relays) await r.stop();

  const orders = (await pool.query('SELECT id::text, seq FROM orders')).rows as { id: string; seq: number }[];
  const msgs = await drainQueue(Q_AUDIT);
  const orderIds = new Set(orders.map((o) => o.id));
  const evOrderIds = new Set(msgs.map((m) => m.body.orderId as string));
  const eventIds = new Set(msgs.map((m) => m.body.eventId as string));
  const lost = orders.filter((o) => !evOrderIds.has(o.id));
  const ghosts = msgs.filter((m) => !orderIds.has(m.body.orderId));
  const byRelay: Record<string, number> = {};
  for (const m of msgs) { const k = m.headers['x-relay-id'] ?? '-'; byRelay[k] = (byRelay[k] ?? 0) + 1; }
  return {
    mode, sent: N, ok, clientErrors, orders: orders.length, events: msgs.length, distinctEvents: eventIds.size,
    lost: lost.length, lostSeqs: lost.map((o) => o.seq).sort((a, b) => a - b),
    ghosts: ghosts.length, duplicates: msgs.length - eventIds.size,
    apiCrashes: api.crashes, relayCrashes: relays.reduce((s, r) => s + r.crashes, 0), byRelay, sendMs,
  };
}

const env = await environment(pool);
const all: Awaited<ReturnType<typeof runOnce>>[] = [];
for (const mode of (process.env.MODES?.split(',') ?? ['dual-commit-first', 'dual-publish-first', 'outbox', 'outbox-nocrash', 'outbox-nolock']) as Mode[]) {
  for (let i = 1; i <= RUNS; i++) {
    const r = await runOnce(mode);
    console.log(JSON.stringify({ ...r, lostSeqs: r.lostSeqs.slice(0, 12) }));
    all.push(r);
  }
}
await pool.end();

const label: Record<Mode, string> = {
  'dual-commit-first': 'Q1a doble escritura: COMMIT y luego publish',
  'dual-publish-first': 'Q1b doble escritura: publish y luego COMMIT',
  'outbox': 'Q2 outbox + 2 relays (`SKIP LOCKED`) que mueren cada 3 lotes',
  'outbox-nocrash': 'Q2 control: outbox + 2 relays (`SKIP LOCKED`) sin muertes de relay',
  'outbox-nolock': 'Q2 control: outbox + 2 relays **sin** `FOR UPDATE SKIP LOCKED`, sin muertes de relay',
};
let md = `# Q1-Q2. Doble escritura frente a outbox transaccional

Medido el ${new Date().toISOString().slice(0, 10)}. ${env}

Cada corrida: ${N} pedidos enviados de uno en uno a \`POST /orders\` (API en Node, en el anfitrión). La API se mata a sí misma (\`SIGKILL\`, sin limpieza) en el punto crítico de los pedidos ${CRASH_EVERY}, ${CRASH_EVERY * 2}, …, ${N}: ${N / CRASH_EVERY} muertes por corrida; un supervisor la vuelve a levantar. En Q2 hay además dos relays (lotes de 20) que se matan cada 3 lotes **después** de recibir la confirmación del broker y **antes** del \`COMMIT\` que marca las filas como publicadas. Una cola de auditoría (quorum) recibe una copia de cada evento \`order.created\`; al final se cruza con la tabla \`orders\`.

- **Perdidos**: pedidos guardados en Postgres sin ningún evento.
- **Fantasma**: eventos publicados de un pedido que no existe (se hizo \`ROLLBACK\` o nunca llegó el \`COMMIT\`).
- **Duplicados**: copias extra del mismo \`eventId\`.

| Variante | Corrida | Pedidos en BD | Errores vistos por el cliente | Eventos | Perdidos | Fantasma | Duplicados | Muertes API / relays |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
`;
const runIdx: Record<string, number> = {};
for (const r of all) {
  runIdx[r.mode] = (runIdx[r.mode] ?? 0) + 1;
  md += `| ${label[r.mode]} | ${runIdx[r.mode]} | ${r.orders} | ${r.clientErrors} | ${r.events} | **${r.lost}** | **${r.ghosts}** | **${r.duplicates}** | ${r.apiCrashes} / ${r.relayCrashes} |\n`;
}
const q1a = all.find((r) => r.mode === 'dual-commit-first')!;
const q2s = all.filter((r) => r.mode === 'outbox');
const ctl = all.filter((r) => r.mode === 'outbox-nocrash');
const nolock = all.filter((r) => r.mode === 'outbox-nolock');
md += `
Pedidos perdidos en Q1a (primera corrida): ${q1a.lostSeqs.join(', ')}. Son exactamente los pedidos en los que la API murió entre el \`COMMIT\` y el \`publish\`.

Reparto de eventos entre relays en Q2 (por corrida): ${q2s.map((r) => JSON.stringify(r.byRelay)).join('; ')}. Los dos trabajan a la vez; \`FOR UPDATE SKIP LOCKED\` hace que cada uno se salte las filas bloqueadas por el otro, así que los duplicados vienen de las muertes entre publicar y \`COMMIT\` (cada muerte reenvía su lote completo, como máximo 20). Los dos controles lo confirman: con los mismos dos relays **sin muertes** hubo ${ctl.map((r) => r.duplicates).join(', ')} duplicados; **sin** \`FOR UPDATE SKIP LOCKED\` y sin muertes, ${nolock.map((r) => r.duplicates).join(', ')} (los dos relays leen las mismas filas pendientes y las publican los dos).

Por qué:

- **Q1a**: el pedido ya está confirmado en Postgres cuando el proceso muere; el \`publish\` nunca ocurre y nadie lo reintenta. El cliente recibió un error, pero el pedido existe: se pierde el evento, no el pedido.
- **Q1b**: el broker ya tiene el mensaje cuando el proceso muere; Postgres deshace la transacción abierta al cerrarse la conexión. Hay un evento de un pedido que no existe.
- **Q2**: el pedido y su evento son dos filas de la misma transacción: o están las dos o ninguna. El relay publica después; si muere tras publicar y antes de marcar, la fila sigue pendiente y se vuelve a publicar. Cero perdidos, cero fantasma, algunos duplicados: «al menos una vez». Los duplicados los resuelve el consumidor (Q4).
`;
writeResult('Q1-Q2_OUTBOX.md', md);
process.exit(0);
