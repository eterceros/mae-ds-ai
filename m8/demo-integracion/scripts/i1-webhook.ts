// I1. Webhook entrante: receptor que procesa dentro de la petición (antes) frente a firma + 202 + bandeja + worker idempotente (despues).
// Cada corrida: el proveedor simulado envía N eventos a RATE/s con plazo TIMEOUT_MS y reenvíos; a los
// 3 s un atacante manda FORGED entregas falsas y REPLAYS repeticiones de entregas viejas.
import { makePool, SCHEMA_I1 } from '../src/lib/db.ts';
import { RECEIVER_PORT, WEBHOOK_SECRET } from '../src/lib/config.ts';
import { deliverWithRetries, attack, isOk, type Delivery } from '../src/sim/webhook-sender.ts';
import { Proc, waitHttp, median, pct, range, environment, writeResult, sleep, today } from './lib/harness.ts';

const N = Number(process.env.N ?? 200);
const RATE = Number(process.env.RATE ?? 20);
const TIMEOUT_MS = Number(process.env.TIMEOUT_MS ?? 2000);
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 5);
const FORGED = Number(process.env.FORGED ?? 20);
const REPLAYS = Number(process.env.REPLAYS ?? 10);
const DUP_EVERY = Number(process.env.DUP_EVERY ?? 10);   // 1 de cada DUP_EVERY eventos se entrega dos veces aunque haya ido bien
const RUNS = Number(process.env.RUNS ?? 3);
const URL_ = `http://127.0.0.1:${RECEIVER_PORT}/webhooks/payments`;

const pool = makePool(5);

async function waitStable(sql: string, quietMs: number, maxMs: number) {
  let last = -1, since = Date.now(); const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const n = Number((await pool.query(sql)).rows[0].n);
    if (n !== last) { last = n; since = Date.now(); } else if (Date.now() - since >= quietMs) return;
    await sleep(250);
  }
}

async function runOnce(variant: 'antes' | 'despues') {
  await pool.query(SCHEMA_I1);
  const procs = [new Proc(`src/${variant}/webhook-receiver.ts`)];
  if (variant === 'despues') procs.push(new Proc('src/despues/webhook-worker.ts'));
  await waitHttp(`http://127.0.0.1:${RECEIVER_PORT}/health`);

  const events = Array.from({ length: N }, (_, i) => ({ eventId: `evt_${String(i).padStart(4, '0')}`, orderId: `ord_${i}`, amount: 1000 + i }));
  const log: Delivery[] = [];
  const t0 = Date.now();
  const genuine = events.map((ev, i) => sleep((i * 1000) / RATE).then(() =>
    deliverWithRetries(URL_, WEBHOOK_SECRET, ev.eventId, ev.orderId, ev.amount, TIMEOUT_MS, MAX_ATTEMPTS, log, DUP_EVERY > 0 && i % DUP_EVERY === DUP_EVERY - 1)));
  const attacker = sleep(3000).then(() => attack(URL_, WEBHOOK_SECRET, events.slice(0, REPLAYS), FORGED, log));
  const delivered = await Promise.all(genuine);
  await attacker;
  const senderDoneS = (Date.now() - t0) / 1000;

  // Esperar a que termine el trabajo pendiente: en antes, el que siguió tras los timeouts;
  // en despues, el que está en la bandeja.
  if (variant === 'antes') await waitStable('SELECT count(*) n FROM payments_ledger', 4000, 60_000);
  else {
    const t1 = Date.now();
    while (Date.now() - t1 < 180_000) {
      const n = Number((await pool.query(`SELECT count(*) n FROM webhook_inbox WHERE status <> 'done'`)).rows[0].n);
      if (n === 0) break;
      await sleep(250);
    }
  }
  const allDoneS = (Date.now() - t0) / 1000;
  for (const p of procs) await p.stop();

  const g = log.filter((d) => d.kind === 'genuine');
  const dupDeliveries = log.filter((d) => d.kind === 'genuine-dup');
  const answered = g.filter((d) => typeof d.status === 'number').map((d) => d.ms);
  const led = (await pool.query(`
    SELECT count(*) FILTER (WHERE event_id LIKE 'evt\\_forged%') forged_rows,
           count(*) FILTER (WHERE event_id NOT LIKE 'evt\\_forged%') genuine_rows,
           count(DISTINCT event_id) FILTER (WHERE event_id NOT LIKE 'evt\\_forged%') genuine_distinct
      FROM payments_ledger`)).rows[0];
  const inbox = variant === 'despues'
    ? (await pool.query(`SELECT count(*) n, extract(epoch FROM max(processed_at) - min(received_at)) span,
                                count(*) FILTER (WHERE attempts > 1) retried FROM webhook_inbox`)).rows[0]
    : null;
  return {
    deliveries: g.length,
    resends: g.length - N,
    dupDeliveries: dupDeliveries.length,
    timeouts: g.filter((d) => d.status === 'timeout').length,
    p50: median(answered), p95: pct(answered, 95), max: Math.max(...answered),
    undelivered: delivered.filter((x) => !x).length,
    effects: Number(led.genuine_rows),
    withEffect: Number(led.genuine_distinct),
    duplicates: Number(led.genuine_rows) - Number(led.genuine_distinct),
    forgedAccepted: log.filter((d) => d.kind.startsWith('forged') && isOk(d.status)).length,
    forgedEffects: Number(led.forged_rows),
    replaysAccepted: log.filter((d) => d.kind === 'replay' && isOk(d.status)).length,
    statusesAttack: [...new Set(log.filter((d) => !d.kind.startsWith('genuine')).map((d) => `${d.kind}:${d.status}`))].sort().join(' '),
    senderDoneS, allDoneS,
    inboxRows: inbox ? Number(inbox.n) : null,
    processSpanS: inbox ? Number(inbox.span) : null,
  };
}

const env = await environment(pool);
const rows: { variant: string; run: number; r: Awaited<ReturnType<typeof runOnce>> }[] = [];
for (const variant of ['antes', 'despues'] as const) {
  for (let run = 1; run <= RUNS; run++) {
    const r = await runOnce(variant);
    rows.push({ variant, run, r });
    console.log(variant, run, JSON.stringify(r));
  }
}
await pool.end();

const f0 = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : x.toFixed(0));
const f1 = (x: number | null) => (x === null || !Number.isFinite(x) ? '—' : x.toFixed(1));
let md = `# I1. Webhook entrante: procesar dentro de la petición frente a firma + 202 + bandeja + worker idempotente

Medido el ${today()}. ${env}

Cada corrida: el proveedor simulado ([\`src/sim/webhook-sender.ts\`](../src/sim/webhook-sender.ts)) envía **${N} eventos** \`payment.succeeded\` a ${RATE}/s, firmados al estilo Standard Webhooks, con un plazo de **${TIMEOUT_MS / 1000} s** por entrega; si no recibe un 2xx a tiempo, reenvía tras 1, 2, 4 y 8 s (hasta ${MAX_ATTEMPTS} intentos). Además, 1 de cada ${DUP_EVERY} eventos se entrega **dos veces aunque la primera haya ido bien** (los proveedores garantizan «al menos una vez»). A los 3 s, un atacante manda ${FORGED} entregas falsas (la mitad sin firma, la otra mitad firmadas con otro secreto) y ${REPLAYS} repeticiones de entregas válidas capturadas hace 10 minutos. El trabajo lento de cada evento (ERP, correo) se simula con una espera uniforme de 200-3000 ms, igual en las dos versiones. Efecto: una fila en \`payments_ledger\` (sin \`UNIQUE\`). ${RUNS} corridas por versión.

- **antes** = [\`src/antes/webhook-receiver.ts\`](../src/antes/webhook-receiver.ts): sin firma, trabajo dentro de la petición, sin idempotencia.
- **despues** = [\`src/despues/webhook-receiver.ts\`](../src/despues/webhook-receiver.ts) (firma HMAC en tiempo constante, ventana de 5 min, \`webhook_inbox\` con clave \`webhook-id\`, 202) + [\`src/despues/webhook-worker.ts\`](../src/despues/webhook-worker.ts) (Postgres como cola con \`FOR UPDATE SKIP LOCKED\`, 8 en paralelo, efecto idempotente).

| Versión | Corrida | Entregas del proveedor | Reenvíos por timeout | Entregas duplicadas a propósito | Timeouts (> ${TIMEOUT_MS / 1000} s) | Respuesta p50 / p95 / máx (ms) | Eventos con abono | Abonos duplicados | Falsos aceptados (2xx) | Abonos falsos | Repeticiones aceptadas | Sin entregar | Todo procesado (s) |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|---:|
`;
for (const { variant, run, r } of rows)
  md += `| ${variant} | ${run} | ${r.deliveries + r.dupDeliveries} | **${r.resends}** | ${r.dupDeliveries} | ${r.timeouts} | ${f0(r.p50)} / ${f0(r.p95)} / ${f0(r.max)} | ${r.withEffect} / ${N} | **${r.duplicates}** | **${r.forgedAccepted}** / ${FORGED} | ${r.forgedEffects} | **${r.replaysAccepted}** / ${REPLAYS} | ${r.undelivered} | ${f1(r.allDoneS)} |\n`;

const sum = (v: string) => {
  const rs = rows.filter((x) => x.variant === v).map((x) => x.r);
  const m = (k: keyof typeof rs[0]) => median(rs.map((r) => Number(r[k])));
  return `| ${v} | ${m('resends')} (${range(rs.map((r) => r.resends))}) | ${f0(m('p50'))} / ${f0(m('p95'))} | ${m('duplicates')} (${range(rs.map((r) => r.duplicates))}) | ${m('forgedAccepted')} | ${m('replaysAccepted')} | ${f1(m('allDoneS'))} |\n`;
};
md += `
## Medianas (rango entre corridas)

| Versión | Reenvíos | Respuesta p50 / p95 (ms) | Abonos duplicados | Falsos aceptados | Repeticiones aceptadas | Todo procesado (s) |
|---|---|---|---|---:|---:|---:|
${sum('antes')}${sum('despues')}
Respuestas del receptor al atacante (tipo:código), por corrida: ${[...new Set(rows.map((x) => `${x.variant} → ${x.r.statusesAttack}`))].join('; ')}.

Notas de lectura:

- «Respuesta» son los tiempos de las entregas del proveedor que recibieron respuesta antes del plazo; las que no, cuentan en «Timeouts».
- En **antes**, el trabajo sigue aunque el proveedor ya abandonó la entrega: por eso cada timeout termina en un abono, y el reenvío en otro.
- En **despues**, «Todo procesado» incluye el tiempo que el worker tarda en vaciar la bandeja (${N} eventos de 200-3000 ms con 8 en paralelo); el proveedor ya había terminado mucho antes (sin reenvíos por timeout).
`;
writeResult('I1_WEBHOOK.md', md);
