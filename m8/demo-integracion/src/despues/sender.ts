// DESPUÉS (práctica corregida) — Enviar pedidos a un tercero (I3). Comparar con src/antes/sender.ts.
// Lee los envíos pendientes de la tabla outbound (una fila por envío, escrita en la misma transacción
// que el cambio del pedido: la outbox de la S08) y los manda con:
//   - un límite de concurrencia (CONCURRENCY peticiones a la vez),
//   - opcionalmente un ritmo máximo propio (CLIENT_RPS) por debajo del límite del tercero,
//   - respeto de Retry-After ante 429 (todos los envíos esperan, no solo el que lo recibió),
//   - reintentos con espera exponencial y jitter ante 5xx o error de red,
//   - Idempotency-Key, por si un reintento llega a un pedido que el tercero sí había registrado.
// Un envío solo se marca "sent" con un 2xx; si se agotan los intentos queda "pending" con
// next_attempt_at y last_error: nada se pierde, se reintenta en la próxima pasada.
import { makePool } from '../lib/db.ts';
import { THIRD_PARTY_URL, sleep } from '../lib/config.ts';
import { printResult } from '../lib/memory.ts';

const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8);
const CLIENT_RPS = Number(process.env.CLIENT_RPS ?? 0);         // 0 = sin ritmo propio
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? 8);     // por envío y por pasada
const MAX_RATE_LIMITED = 50;                                  // 429 seguidos que se toleran por envío
const BASE_MS = 200, CAP_MS = 10_000;

const pool = makePool(CONCURRENCY + 1);
const t0 = performance.now();
let requests = 0, got429 = 0, got503 = 0, gaveUp = 0, sent = 0, waitedRetryAfterMs = 0;

// CORRECCIÓN: Retry-After compartido. Si el tercero dice "espera 1 s", esperan todos los envíos:
// si cada uno esperara por su cuenta, los demás seguirían chocando con el mismo límite.
let pauseUntil = 0;
async function gate() {
  for (;;) {
    const wait = pauseUntil - Date.now();
    if (wait <= 0) break;
    await sleep(wait);
  }
  // CORRECCIÓN (opcional): ritmo propio, para no llegar al límite en vez de rebotar contra él.
  if (CLIENT_RPS > 0) {
    const slot = Math.max(nextSlot, Date.now());
    nextSlot = slot + 1000 / CLIENT_RPS;
    if (slot > Date.now()) await sleep(slot - Date.now());
  }
}
let nextSlot = 0;

// CORRECCIÓN: espera exponencial con jitter completo (un valor al azar entre 0 y el tope), como en la S08:
// sin jitter, todos los que fallaron a la vez reintentan a la vez.
const backoff = (attempt: number) => Math.random() * Math.min(CAP_MS, BASE_MS * 2 ** (attempt - 1));

async function sendOne(row: { id: number; order_id: number; customer: string; amount_cents: number }) {
  let limited = 0;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    await gate();
    requests++;
    let status = 0, retryAfter: string | null = null;
    try {
      const r = await fetch(`${THIRD_PARTY_URL}/v1/orders`, {
        method: 'POST',
        // CORRECCIÓN: Idempotency-Key = id del envío, el mismo en todos los reintentos.
        headers: { 'content-type': 'application/json', 'idempotency-key': `outbound-${row.id}` },
        body: JSON.stringify({ order_id: row.order_id, customer: row.customer, amount_cents: row.amount_cents }),
        signal: AbortSignal.timeout(5000),   // CORRECCIÓN: plazo por petición (S05)
      });
      await r.arrayBuffer();
      status = r.status; retryAfter = r.headers.get('retry-after');
    } catch { status = 0; }
    if (status >= 200 && status < 300) {
      await pool.query(`UPDATE outbound SET status = 'sent', sent_at = now(), attempts = attempts + $2 WHERE id = $1`, [row.id, attempt]);
      sent++;
      return;
    }
    if (status === 429) {
      got429++;
      // CORRECCIÓN: respetar Retry-After (segundos o fecha HTTP), con un poco de jitter para no volver todos en el mismo ms.
      const s = retryAfter === null ? NaN : Number(retryAfter);
      const ms = Number.isFinite(s) ? s * 1000 : Math.max(0, Date.parse(retryAfter ?? '') - Date.now()) || 1000;
      const until = Date.now() + ms + Math.random() * 200;
      if (until > pauseUntil) { waitedRetryAfterMs += until - Math.max(pauseUntil, Date.now()); pauseUntil = until; }
      // Un 429 no gasta intentos (el tercero dijo cuándo volver), pero hay un tope por si nunca se repone.
      if (++limited <= MAX_RATE_LIMITED) attempt--;
      continue;
    }
    if (status === 503) got503++;
    // 4xx distinto de 429: no tiene sentido reintentar (el pedido está mal); se deja para revisión.
    if (status >= 400 && status < 500) break;
    await sleep(backoff(attempt));
  }
  gaveUp++;
  await pool.query(`UPDATE outbound SET attempts = attempts + $2, next_attempt_at = now() + interval '1 minute',
                    last_error = 'agotó los intentos' WHERE id = $1`, [row.id, MAX_ATTEMPTS]);
}

const rows = (await pool.query(`
  SELECT o.id, o.order_id, s.customer, s.amount_cents
    FROM outbound o JOIN orders_to_sync s ON s.id = o.order_id
   WHERE o.status = 'pending' AND o.next_attempt_at <= now() ORDER BY o.id`)).rows;

// CORRECCIÓN: límite de concurrencia: CONCURRENCY "carriles" que van tomando envíos de la lista.
let next = 0;
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
  while (next < rows.length) await sendOne(rows[next++]);
}));
await pool.end();
printResult({ orders: rows.length, requests, got429, got503, sent, gaveUp, waitedRetryAfterS: waitedRetryAfterMs / 1000, seconds: (performance.now() - t0) / 1000 });
