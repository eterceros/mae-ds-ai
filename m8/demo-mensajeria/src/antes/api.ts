// ANTES (mala práctica) — API de pedidos con DOBLE ESCRITURA (Q1).
// Guarda el pedido en Postgres y, por separado, publica el evento en RabbitMQ.
// Son dos sistemas sin transacción común: si el proceso muere entre los dos pasos,
// uno de ellos queda hecho y el otro no. La versión corregida está en src/despues/api.ts.
//
// DUAL_ORDER=commit-first   (Q1a, por defecto) COMMIT y luego publish -> eventos perdidos
// DUAL_ORDER=publish-first  (Q1b)              publish y luego COMMIT -> eventos "fantasma"
// CRASH_EVERY=N mata el proceso entre los dos pasos cuando seq % N === 0 (inyección de fallos).
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { makePool } from '../lib/db.ts';
import { connect, assertTopology, publishConfirmed, EXCHANGE, RK_ORDER_CREATED } from '../lib/amqp.ts';
import { crashNow } from '../lib/config.ts';

const ORDER = process.env.DUAL_ORDER ?? 'commit-first';
const PORT = Number(process.env.PORT ?? 18310);
const CRASH_EVERY = Number(process.env.CRASH_EVERY ?? 0);

const pool = makePool(20);
const conn = await connect();
const ch = await conn.createConfirmChannel();
await assertTopology(ch);

type NewOrder = { seq: number; customer: string; amountCents: number };
const crashHere = (seq: number) => CRASH_EVERY > 0 && seq % CRASH_EVERY === 0;

async function createOrder(o: NewOrder) {
  const orderId = randomUUID();
  const eventId = randomUUID();
  const event = { eventId, orderId, seq: o.seq, customer: o.customer, amountCents: o.amountCents, occurredAt: new Date().toISOString() };
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('INSERT INTO orders (id, seq, customer, amount_cents) VALUES ($1,$2,$3,$4)',
      [orderId, o.seq, o.customer, o.amountCents]);
    if (ORDER === 'commit-first') {
      await db.query('COMMIT');
      if (crashHere(o.seq)) crashNow('después del COMMIT, antes del publish');   // <- Q1a: evento perdido
      await publishConfirmed(ch, EXCHANGE, RK_ORDER_CREATED, event, { messageId: eventId });
    } else {
      await publishConfirmed(ch, EXCHANGE, RK_ORDER_CREATED, event, { messageId: eventId });
      if (crashHere(o.seq)) crashNow('después del publish, antes del COMMIT');   // <- Q1b: evento fantasma
      await db.query('COMMIT');
    }
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
    const id = await createOrder(JSON.parse(body) as NewOrder);
    res.writeHead(201, { 'content-type': 'application/json' }).end(JSON.stringify({ id }));
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
server.listen(PORT, '127.0.0.1', () => console.log(`api ANTES (${ORDER}) en ${PORT} (pid ${process.pid})`));
