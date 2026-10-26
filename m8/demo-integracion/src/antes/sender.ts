// ANTES (mala práctica) — Enviar pedidos a un tercero (I3).
// "Sincronización programada" típica de un primer intento:
//   1. Toma todo lo que cambió desde la última vez (marca de agua last_synced_at).
//   2. Lo manda TODO A LA VEZ (Promise.all): el tercero tiene un límite de peticiones por segundo.
//   3. Si recibe 429 o 503, reintenta EN EL ACTO, hasta 3 veces, sin mirar Retry-After: vuelve a
//      chocar con el mismo límite, que todavía no se repuso.
//   4. Al final mueve la marca de agua hasta el último pedido, aunque algunos hayan fallado: esos
//      pedidos no se vuelven a mandar nunca (se pierden en silencio, solo queda una línea de log).
// La versión corregida está en src/despues/sender.ts.
import { makePool } from '../lib/db.ts';
import { THIRD_PARTY_URL } from '../lib/config.ts';
import { printResult } from '../lib/memory.ts';

const pool = makePool(5);
const t0 = performance.now();
const { last_synced_at } = (await pool.query(`SELECT last_synced_at FROM sync_state WHERE name = 'third-party'`)).rows[0];
const orders = (await pool.query('SELECT id, customer, amount_cents, updated_at FROM orders_to_sync WHERE updated_at > $1 ORDER BY updated_at', [last_synced_at])).rows;

let requests = 0, got429 = 0, got503 = 0, failed = 0;
async function send(o: { id: number; customer: string; amount_cents: number }) {
  for (let attempt = 1; attempt <= 4; attempt++) {                  // 1 intento + 3 reintentos inmediatos
    requests++;
    try {
      const r = await fetch(`${THIRD_PARTY_URL}/v1/orders`, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ order_id: o.id, customer: o.customer, amount_cents: o.amount_cents }) });
      await r.arrayBuffer();
      if (r.ok) return true;
      if (r.status === 429) got429++;
      if (r.status === 503) got503++;
    } catch { /* error de red: reintento inmediato */ }
  }
  failed++;
  console.error(`no se pudo enviar el pedido ${o.id}`);           // <- solo un log
  return false;
}

await Promise.all(orders.map(send));                                // <- todo a la vez
if (orders.length)                                                  // <- la marca avanza igual
  await pool.query(`UPDATE sync_state SET last_synced_at = $1 WHERE name = 'third-party'`, [orders[orders.length - 1].updated_at]);
await pool.end();
printResult({ orders: orders.length, requests, got429, got503, failed, seconds: (performance.now() - t0) / 1000 });
