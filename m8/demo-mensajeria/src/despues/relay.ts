// DESPUÉS — Relay de la outbox (Q2-Q4, y dentro de despues/llm-api.ts en Q7).
// Bucle: toma un lote de filas pendientes, las publica con confirmación del broker y las marca
// como publicadas, todo dentro de una transacción de Postgres.
// Lo que sigue pudiendo pasar: publicar y morir antes del COMMIT -> la fila sigue pendiente y
// se vuelve a publicar. Entrega "al menos una vez": por eso el consumidor debe ser idempotente (Q4).
import { pathToFileURL } from 'node:url';
import type pg from 'pg';
import type { ConfirmChannel } from 'amqplib';
import { makePool } from '../lib/db.ts';
import { connect, assertTopology, publishConfirmed } from '../lib/amqp.ts';
import { crashNow, sleep } from '../lib/config.ts';

type Row = { id: string; event_id: string; exchange: string; routing_key: string; payload: unknown; headers: Record<string, unknown> };

export async function runRelay(opts: {
  pool: pg.Pool; ch: ConfirmChannel; relayId: string; batch?: number; crashEveryBatches?: number;
  stopWhen?: () => boolean;
}) {
  const { pool, ch, relayId, batch = 50, crashEveryBatches = 0 } = opts;
  // CORRECCIÓN: FOR UPDATE SKIP LOCKED. Con dos relays, cada uno se salta las filas que el otro
  // ya bloqueó, así que no publican la MISMA fila los dos. RELAY_LOCK=none lo quita SOLO para
  // el experimento de control de Q2 (sin él: cientos de duplicados sin ninguna caída).
  const lock = process.env.RELAY_LOCK === 'none' ? '' : 'FOR UPDATE SKIP LOCKED';
  let batches = 0;
  while (!opts.stopWhen?.()) {
    const db = await pool.connect();
    let n = 0;
    try {
      await db.query('BEGIN');
      const { rows } = await db.query<Row>(
        `SELECT id, event_id, exchange, routing_key, payload, headers
           FROM outbox
          WHERE published_at IS NULL
          ORDER BY id
          LIMIT $1
          ${lock}`, [batch]);
      n = rows.length;
      // CORRECCIÓN: publisher confirms. Solo se marca como publicada una fila cuando el broker
      // confirmó que el mensaje está en la cola; "publish" sin confirmación solo significa
      // "lo escribí en el socket".
      await Promise.all(rows.map((r) => publishConfirmed(ch, r.exchange, r.routing_key, r.payload, {
        messageId: r.event_id, type: r.routing_key, headers: { ...r.headers, 'x-relay-id': relayId },
      })));
      if (n > 0) {
        batches++;
        if (crashEveryBatches > 0 && batches % crashEveryBatches === 0)
          crashNow(`relay ${relayId}: lote de ${n} publicado y confirmado, antes del COMMIT`);
        await db.query('UPDATE outbox SET published_at = now() WHERE id = ANY($1::bigint[])', [rows.map((r) => r.id)]);
      }
      await db.query('COMMIT');
    } catch (e) {
      await db.query('ROLLBACK').catch(() => {});
      console.error(`[relay ${relayId}]`, e);
      await sleep(500);
    } finally {
      db.release();
    }
    if (n === 0) await sleep(50); // nada pendiente: sondeo corto (en producción, LISTEN/NOTIFY o CDC)
  }
}

// Como proceso independiente: node src/despues/relay.ts
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const pool = makePool(2);
  const conn = await connect();
  const ch = await conn.createConfirmChannel();
  await assertTopology(ch);
  const relayId = process.env.RELAY_ID ?? `relay-${process.pid}`;
  console.log(`${relayId} arrancó (pid ${process.pid})`);
  await runRelay({
    pool, ch, relayId,
    batch: Number(process.env.RELAY_BATCH ?? 50),
    crashEveryBatches: Number(process.env.RELAY_CRASH_EVERY_BATCHES ?? 0),
  });
}
