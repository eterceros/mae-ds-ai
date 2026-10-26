// ANTES (mala práctica) — Receptor del webhook de pagos (I1).
// Hace todo DENTRO de la petición: lee el JSON, ejecuta el trabajo lento (ERP, correo) y anota el
// abono; recién entonces responde. Tres problemas:
//   1. No verifica la firma: cualquiera que conozca la URL puede "pagar" un pedido.
//   2. Responde tarde: si el trabajo pasa del plazo del emisor, el emisor da la entrega por fallida
//      y la REENVÍA, aunque aquí el trabajo siga y termine.
//   3. No es idempotente: cada reenvío (o una repetición maliciosa) vuelve a anotar el abono.
// La versión corregida está en src/despues/webhook-receiver.ts y src/despues/webhook-worker.ts.
import http from 'node:http';
import { makePool } from '../lib/db.ts';
import { RECEIVER_PORT } from '../lib/config.ts';
import { slowSideEffects } from '../lib/work.ts';

const pool = makePool(50);

type PaymentEvent = { type: string; data: { order_id: string; amount_cents: number } };

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end('ok'); return; }
  if (req.method !== 'POST' || req.url !== '/webhooks/payments') { res.statusCode = 404; res.end(); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const ev = JSON.parse(body) as PaymentEvent;                  // <- sin firma: se cree lo que llegue
    const eventId = String(req.headers['webhook-id'] ?? '');
    await slowSideEffects(eventId);                               // <- trabajo lento dentro de la petición
    await pool.query('INSERT INTO payments_ledger (event_id, order_id, amount_cents) VALUES ($1, $2, $3)',
      [eventId, ev.data.order_id, ev.data.amount_cents]);         // <- sin idempotencia
    res.writeHead(200).end('ok');
  } catch (e) {
    res.writeHead(500).end(String(e));
  }
});
server.listen(RECEIVER_PORT, '127.0.0.1', () => console.log(`receptor ANTES en ${RECEIVER_PORT} (pid ${process.pid})`));
