// ANTES (mala práctica) — Worker de envíos SIN IDEMPOTENCIA (Q3).
// Por cada mensaje inserta un envío y hace ack. Si el mismo evento llega dos veces
// (reenvío del relay o reentrega tras una caída), crea dos envíos.
// Ante un error responde nack(requeue=true): en RabbitMQ 4.4 eso NO cuenta para
// x-delivery-limit, así que un mensaje venenoso gira para siempre (Q5).
// La versión corregida está en src/despues/worker.ts.
// WORKER_CRASH_EVERY=N mata el proceso tras el COMMIT del efecto y antes del ack (seq % N === 0).
import type { ConsumeMessage } from 'amqplib';
import { makePool } from '../lib/db.ts';
import { connect, assertTopology, Q_SHIPPING } from '../lib/amqp.ts';
import { crashNow } from '../lib/config.ts';
import { childOf } from '../lib/trace.ts';

const PREFETCH = Number(process.env.PREFETCH ?? 20);
const CRASH_EVERY = Number(process.env.WORKER_CRASH_EVERY ?? 0);

const pool = makePool(PREFETCH);
const conn = await connect();
const ch = await conn.createChannel();
await assertTopology(ch);
await ch.prefetch(PREFETCH);

async function handle(msg: ConsumeMessage) {
  const ev = JSON.parse(msg.content.toString()) as { eventId: string; orderId: string; seq: number };
  const tp = childOf(msg.properties.headers?.traceparent as string | undefined);
  // El efecto, sin preguntar si este evento ya se procesó.
  await pool.query('INSERT INTO shipments (order_id, event_id, traceparent) VALUES ($1, $2, $3)', [ev.orderId, ev.eventId, tp]);
  if (CRASH_EVERY > 0 && ev.seq % CRASH_EVERY === 0 && !msg.fields.redelivered)
    crashNow(`worker: efecto confirmado (pedido ${ev.seq}), antes del ack`);
  ch.ack(msg);
}

await ch.consume(Q_SHIPPING, (msg) => {
  if (!msg) return;
  handle(msg).catch((e) => {
    console.error('[worker] error', e);
    ch.nack(msg, false, true);   // de vuelta a la cola, sin límite real (ver Q5)
  });
}, { noAck: false });
console.log(`worker ANTES (sin idempotencia) prefetch=${PREFETCH} (pid ${process.pid})`);
