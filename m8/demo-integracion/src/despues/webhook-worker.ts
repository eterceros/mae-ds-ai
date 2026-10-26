// DESPUÉS (práctica corregida) — Worker de la bandeja de entrada del webhook (I1).
// Usa Postgres como cola: toma eventos pendientes con FOR UPDATE SKIP LOCKED (varios workers no se
// pisan), los marca "processing" con un plazo (locked_until) y hace el trabajo lento FUERA de la
// transacción. Si el worker muere, el plazo vence y otro vuelve a tomar el evento.
import { makePool } from '../lib/db.ts';
import { sleep } from '../lib/config.ts';
import { slowSideEffects } from '../lib/work.ts';

const CONCURRENCY = Number(process.env.WORKER_CONCURRENCY ?? 8);
const LEASE_S = Number(process.env.WORKER_LEASE_S ?? 30);
const MAX_ATTEMPTS = 5;
const pool = makePool(CONCURRENCY + 2);
let stopping = false;

async function claimOne() {
  // CORRECCIÓN: la cola es la misma tabla donde el receptor guardó el evento. SKIP LOCKED salta las
  // filas que otro worker tiene tomadas; el UPDATE deja la marca "processing" con plazo, y la
  // transacción se confirma enseguida (no se tiene abierta durante el trabajo lento).
  const r = await pool.query(`
    UPDATE webhook_inbox SET status = 'processing', attempts = attempts + 1,
           locked_until = clock_timestamp() + make_interval(secs => $1)
     WHERE event_id = (
       SELECT event_id FROM webhook_inbox
        WHERE status = 'pending' OR (status = 'processing' AND locked_until < clock_timestamp())
        ORDER BY received_at
        FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING event_id, payload, attempts`, [LEASE_S]);
  return r.rows[0] as { event_id: string; payload: { data: { order_id: string; amount_cents: number } }; attempts: number } | undefined;
}

async function process1(ev: NonNullable<Awaited<ReturnType<typeof claimOne>>>) {
  // El trabajo externo recibe el event_id para que el ERP o el proveedor de correo puedan
  // deduplicar si este paso se repite (p. ej. si el worker muere después de llamarlos).
  await slowSideEffects(ev.event_id);
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    // CORRECCIÓN: idempotencia del efecto. Solo quien pasa el evento a "done" anota el abono, y las dos
    // cosas van en la misma transacción. Si otro worker ya lo terminó (p. ej. porque este tardó más que
    // el plazo), el UPDATE no devuelve filas y no se repite el abono.
    const done = await db.query(
      `UPDATE webhook_inbox SET status = 'done', processed_at = clock_timestamp(), locked_until = NULL
        WHERE event_id = $1 AND status <> 'done' RETURNING event_id`, [ev.event_id]);
    if (done.rowCount === 1)
      await db.query('INSERT INTO payments_ledger (event_id, order_id, amount_cents) VALUES ($1, $2, $3)',
        [ev.event_id, ev.payload.data.order_id, ev.payload.data.amount_cents]);
    await db.query('COMMIT');
  } catch (e) {
    await db.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    db.release();
  }
}

async function loop() {
  while (!stopping) {
    const ev = await claimOne();
    if (!ev) { await sleep(100); continue; }
    try {
      await process1(ev);
    } catch (e) {
      // Reintento limitado: vuelve a "pending"; tras MAX_ATTEMPTS queda "failed" para revisarlo a mano.
      await pool.query(`UPDATE webhook_inbox SET status = CASE WHEN attempts >= $2 THEN 'failed' ELSE 'pending' END,
                        last_error = $3, locked_until = NULL WHERE event_id = $1`, [ev.event_id, MAX_ATTEMPTS, String(e)]);
    }
  }
}

// Apagado limpio: deja de tomar eventos y termina los que tiene en curso.
process.on('SIGTERM', () => { stopping = true; });
console.log(`worker DESPUÉS: ${CONCURRENCY} en paralelo (pid ${process.pid})`);
await Promise.all(Array.from({ length: CONCURRENCY }, loop));
await pool.end();
