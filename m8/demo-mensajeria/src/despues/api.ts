// DESPUÉS (práctica corregida) — API de pedidos con OUTBOX TRANSACCIONAL (Q2).
// El pedido y su evento se guardan en la misma transacción de Postgres; el relay
// (src/despues/relay.ts) los publica después. Comparar con src/antes/api.ts.
// CRASH_EVERY=N mata el proceso justo después del COMMIT cuando seq % N === 0: aquí ya no se pierde nada.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { makePool } from '../lib/db.ts';
import { RK_ORDER_CREATED } from '../lib/amqp.ts';
import { crashNow } from '../lib/config.ts';
import { childOf } from '../lib/trace.ts';

const PORT = Number(process.env.PORT ?? 18310);
const CRASH_EVERY = Number(process.env.CRASH_EVERY ?? 0);

// CORRECCIÓN: la API ya no abre conexión con RabbitMQ. Solo escribe en Postgres, así que
// no hay "dos escrituras" que puedan quedar a medias (Q1 -> Q2).
const pool = makePool(20);

type NewOrder = { seq: number; customer: string; amountCents: number };

async function createOrder(o: NewOrder, incomingTp: string | undefined) {
  const orderId = randomUUID();
  const eventId = randomUUID();
  // CORRECCIÓN: se propaga traceparent (W3C). Mismo trace-id que el cliente, span nuevo; viaja
  // en la fila de la outbox y de ahí a la cabecera AMQP, para seguir la petición hasta el worker.
  const tp = childOf(incomingTp);
  const event = { eventId, orderId, seq: o.seq, customer: o.customer, amountCents: o.amountCents, occurredAt: new Date().toISOString() };
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query(
      'INSERT INTO orders (id, seq, customer, amount_cents, traceparent) VALUES ($1,$2,$3,$4,$5)',
      [orderId, o.seq, o.customer, o.amountCents, tp]);
    // CORRECCIÓN: el evento es una fila más de la MISMA transacción. O se guardan pedido y
    // evento, o ninguno: no puede haber pedido sin evento (Q1a) ni evento sin pedido (Q1b).
    await db.query(
      'INSERT INTO outbox (event_id, routing_key, payload, headers) VALUES ($1,$2,$3,$4)',
      [eventId, RK_ORDER_CREATED, event, { traceparent: tp }]);
    await db.query('COMMIT');
    if (CRASH_EVERY > 0 && o.seq % CRASH_EVERY === 0) crashNow('después del COMMIT (outbox): no se pierde nada');
    return orderId;
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end('ok'); return; }
  if (req.method !== 'POST' || req.url !== '/orders') { res.statusCode = 404; res.end(); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const id = await createOrder(JSON.parse(body) as NewOrder, req.headers.traceparent as string | undefined);
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id }));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`api DESPUÉS (outbox) en ${PORT} (pid ${process.pid})`));
