// Relay de la outbox, versión DESPUÉS: publica cada fila DENTRO del contexto guardado con ella, así el
// span "publish" de amqplib es hijo de la petición que creó el pedido y la traza llega al worker.
import { ROOT_CONTEXT, context, propagation } from '@opentelemetry/api';
import { assertTopology, connect, sendConfirmed } from '../lib/amqp.js';
import { SCHEMA } from '../lib/config.js';
import { ensureSchema, pool } from '../lib/db.js';
import { log } from '../lib/log.js';

await ensureSchema();
const ch = await (await connect()).createConfirmChannel();
await assertTopology(ch);

async function ciclo(): Promise<number> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const { rows } = await c.query(`SELECT id, payload, headers FROM ${SCHEMA}.outbox
      WHERE publicado IS NULL ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED`);
    for (const row of rows) {
      // CORRECCIÓN: se restaura el contexto de la fila (extract) y se publica dentro de él (with).
      // amqplib inyecta en las cabeceras el contexto de SU span, que ahora cuelga de la petición.
      const ctx = propagation.extract(ROOT_CONTEXT, row.headers);
      await context.with(ctx, () => sendConfirmed(ch, row.payload, {}));
      await c.query(`UPDATE ${SCHEMA}.outbox SET publicado = now() WHERE id = $1`, [row.id]);
    }
    await c.query('COMMIT');
    return rows.length;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

let parar = false;
process.on('SIGTERM', () => { parar = true; });
log.info('relay (despues) publicando la outbox');
while (!parar) {
  const n = await ciclo();
  if (n === 0) await new Promise((r) => setTimeout(r, 50));
}
await ch.close();
process.exit(0);
