// DESPUÉS — E4 (Q7): worker que procesa los encargos de resumen desde la cola summaries.requested.
import type { ConsumeMessage } from 'amqplib';
import { makePool } from '../lib/db.ts';
import { connect, assertTopology, Q_SUMMARIES } from '../lib/amqp.ts';
import { summarize } from '../lib/llm.ts';
import { childOf } from '../lib/trace.ts';

// CORRECCIÓN: prefetch = cuántos encargos atiende a la vez. El worker decide cuánta carga recibe
// el LLM; el exceso espera en la cola (durable y visible), no en conexiones HTTP abiertas.
const PREFETCH = Number(process.env.PREFETCH ?? 2);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 30000);
const pool = makePool(PREFETCH + 1);
const conn = await connect();
const ch = await conn.createChannel();
await assertTopology(ch);   // summaries.requested: quorum, x-delivery-limit 5, DLX -> summaries.requested.dlq
await ch.prefetch(PREFETCH);
let inFlight = 0, stopping = false;

async function handle(m: ConsumeMessage) {
  const { jobId } = JSON.parse(m.content.toString()) as { jobId: string };
  const tp = childOf(m.properties.headers?.traceparent as string | undefined);
  // CORRECCIÓN: idempotente. Solo toma el encargo si sigue 'pending'; si ya está 'done'
  // (murió antes del ack), es una reentrega de algo hecho: solo ack.
  const { rows } = await pool.query(
    `UPDATE summary_jobs SET attempts = attempts + 1, started_at = clock_timestamp(), traceparent_worker = $2
      WHERE id = $1 AND status = 'pending' RETURNING input`, [jobId, tp]);
  if (!rows[0]) { ch.ack(m); return; }
  try {
    const summary = await summarize(rows[0].input, LLM_TIMEOUT_MS);
    await pool.query(`UPDATE summary_jobs SET status = 'done', result = $2, finished_at = clock_timestamp() WHERE id = $1`, [jobId, summary]);
    ch.ack(m);
  } catch (e) {
    // CORRECCIÓN: reintentos limitados. reject(requeue=true) cuenta para x-delivery-limit;
    // al 5.º fallo RabbitMQ lo manda a la DLQ y el recurso de estado queda en 'failed'.
    const count = Number(m.properties.headers?.['x-delivery-count'] ?? 0);
    if (count >= 4) {
      await pool.query(`UPDATE summary_jobs SET status = 'failed', error = $2, finished_at = clock_timestamp() WHERE id = $1`, [jobId, String(e)]);
    }
    ch.reject(m, true);
  }
}

const { consumerTag } = await ch.consume(Q_SUMMARIES, (m) => {
  if (!m) return;
  inFlight++;
  handle(m).catch((e) => { console.error(e); ch.reject(m, true); }).finally(() => inFlight--);
});
console.log(`llm-worker prefetch=${PREFETCH} LLM_URL=${process.env.LLM_URL}`);

// CORRECCIÓN: apagado limpio con SIGTERM (docker stop): deja de recibir, termina lo que tiene, cierra.
process.on('SIGTERM', async () => {
  if (stopping) return;
  stopping = true;
  console.log(`SIGTERM: dejo de recibir; termino ${inFlight} en vuelo`);
  await ch.cancel(consumerTag);
  while (inFlight > 0) await new Promise((r) => setTimeout(r, 50));
  await ch.close(); await conn.close(); await pool.end();
  console.log('apagado limpio');
  process.exit(0);
});
