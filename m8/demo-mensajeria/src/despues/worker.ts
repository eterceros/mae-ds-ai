// DESPUÉS (práctica corregida) — Worker de envíos IDEMPOTENTE (Q4), con DLQ (Q5)
// y apagado limpio. Comparar con src/antes/worker.ts.
// Ack manual + prefetch: RabbitMQ entrega como máximo PREFETCH mensajes sin confirmar;
// si el proceso muere, los no confirmados vuelven a la cola (redelivered=true).
// WORKER_CRASH_EVERY=N mata el proceso tras el COMMIT del efecto y antes del ack (seq % N === 0).
import type { ConsumeMessage } from 'amqplib';
import { makePool } from '../lib/db.ts';
import { connect, assertTopology, Q_SHIPPING } from '../lib/amqp.ts';
import { crashNow } from '../lib/config.ts';
import { childOf } from '../lib/trace.ts';

const PREFETCH = Number(process.env.PREFETCH ?? 20);
const CRASH_EVERY = Number(process.env.WORKER_CRASH_EVERY ?? 0);
const CONSUMER = 'shipping';

const pool = makePool(PREFETCH);
const conn = await connect();
const ch = await conn.createChannel();
await assertTopology(ch);   // la cola tiene x-delivery-limit y DLX (src/lib/amqp.ts)
await ch.prefetch(PREFETCH);

let inFlight = 0;
let stopping = false;

class PoisonError extends Error {}

async function handle(msg: ConsumeMessage) {
  let ev: { eventId: string; orderId: string; seq: number };
  try { ev = JSON.parse(msg.content.toString()); } catch { throw new PoisonError('cuerpo que no es JSON'); }
  // CORRECCIÓN: traceparent recibido en las cabeceras: el envío queda en la misma traza.
  const tp = childOf(msg.properties.headers?.traceparent as string | undefined);
  const db = await pool.connect();
  let applied = false;
  try {
    await db.query('BEGIN');
    // CORRECCIÓN: tabla de procesados con clave primaria (consumer, event_id), en la MISMA
    // transacción que el efecto. Si la fila ya existía, esta copia es un duplicado: no se repite
    // el efecto, solo se hace ack. Como las dos filas se confirman juntas, no existe el estado
    // "envío hecho pero no registrado" (Q3 -> Q4). La clave es el eventId que nace en la outbox,
    // no el deliveryTag: las copias del relay son mensajes distintos para RabbitMQ.
    const r = await db.query(
      'INSERT INTO processed_messages (consumer, event_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
      [CONSUMER, ev.eventId]);
    if (r.rowCount === 0) { await db.query('ROLLBACK'); ch.ack(msg); return; }
    await db.query('INSERT INTO shipments (order_id, event_id, traceparent) VALUES ($1, $2, $3)',
      [ev.orderId, ev.eventId, tp]);
    await db.query('COMMIT');
    applied = true;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
  }
  if (applied && CRASH_EVERY > 0 && ev.seq % CRASH_EVERY === 0 && !msg.fields.redelivered)
    crashNow(`worker: efecto confirmado (pedido ${ev.seq}), antes del ack`);
  ch.ack(msg);
}

const { consumerTag } = await ch.consume(Q_SHIPPING, (msg) => {
  if (!msg) return;
  inFlight++;
  handle(msg)
    .catch((e) => {
      console.error('[worker] error', e);
      // CORRECCIÓN: reintentos limitados y DLQ. Un mensaje que nunca podrá procesarse
      // (venenoso) va directo a la DLQ con reject(requeue=false). Un fallo quizá pasajero
      // vuelve con reject(requeue=true), que SÍ cuenta para x-delivery-limit en quorum queues;
      // nack(requeue=true) no cuenta y giraría para siempre (Q5).
      ch.reject(msg, !(e instanceof PoisonError));
    })
    .finally(() => { inFlight--; });
}, { noAck: false });
console.log(`worker DESPUÉS (idempotente) prefetch=${PREFETCH} (pid ${process.pid})`);

// CORRECCIÓN: apagado limpio (SIGTERM de `docker stop`): dejar de recibir, terminar lo que está
// en vuelo, cerrar. En Windows los procesos no reciben SIGTERM; esto aplica dentro de contenedores (Q7).
process.on('SIGTERM', async () => {
  if (stopping) return;
  stopping = true;
  await ch.cancel(consumerTag);
  while (inFlight > 0) await new Promise((r) => setTimeout(r, 20));
  await ch.close(); await conn.close(); await pool.end();
  process.exit(0);
});
