// Relay de la outbox, versión ANTES (como en la S08): toma filas pendientes y las publica con las
// cabeceras guardadas, entre ellas el traceparent manual. Con la auto-instrumentación encendida,
// cada publicación ocurre FUERA de la petición que creó el pedido (en este bucle no hay span activo):
// la instrumentación de amqplib abre una traza nueva y ESCRIBE SU traceparent encima del guardado.
import { assertTopology, connect, sendConfirmed } from '../lib/amqp.js';
import { SCHEMA } from '../lib/config.js';
import { ensureSchema, pool } from '../lib/db.js';

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
      await sendConfirmed(ch, row.payload, row.headers);
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
console.log('relay (antes) publicando la outbox');
while (!parar) {
  const n = await ciclo();
  if (n === 0) await new Promise((r) => setTimeout(r, 50));
}
await ch.close();
process.exit(0);
