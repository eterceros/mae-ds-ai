// DESPUÉS (práctica corregida) — E4 (Q7): 202 Accepted + recurso de estado + cola + worker.
//   POST /async/summaries  guarda el trabajo + su evento en la outbox (una transacción) y responde
//                          202 Accepted + Location: /jobs/:id. El worker (despues/llm-worker.ts) lo procesa.
//   GET  /jobs/:id         recurso de estado: pending | done | failed
// Comparar con src/antes/llm-api.ts. El relay de la outbox corre dentro de este mismo proceso.
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { makePool } from '../lib/db.ts';
import { connect, assertTopology, EX_SUMMARIES } from '../lib/amqp.ts';
import { childOf } from '../lib/trace.ts';
import { runRelay } from './relay.ts';

const PORT = Number(process.env.PORT ?? 3000);
const pool = makePool(30);
const conn = await connect();
const ch = await conn.createConfirmChannel();
await assertTopology(ch);
void runRelay({ pool, ch, relayId: 'llm-api', batch: 50 });

async function readJson(req: http.IncomingMessage) {
  let b = ''; for await (const c of req) b += c; return JSON.parse(b || '{}');
}
function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers }).end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });

    if (req.method === 'POST' && req.url === '/async/summaries') {
      const { text } = await readJson(req);
      const id = randomUUID();
      // CORRECCIÓN: traceparent propagado hasta el worker (se guarda en el trabajo y en la outbox).
      const tp = childOf(req.headers.traceparent as string | undefined);
      const db = await pool.connect();
      try {
        // CORRECCIÓN: la petición ya no espera al LLM. Solo registra el encargo; el trabajo y su
        // mensaje se guardan en la misma transacción (outbox, como en Q2): no hay encargo sin mensaje.
        await db.query('BEGIN');
        await db.query('INSERT INTO summary_jobs (id, input, traceparent_in) VALUES ($1, $2, $3)', [id, text, tp]);
        await db.query(
          `INSERT INTO outbox (event_id, exchange, routing_key, payload, headers) VALUES ($1, $2, 'summary.requested', $3, $4)`,
          [randomUUID(), EX_SUMMARIES, { jobId: id }, { traceparent: tp }]);
        await db.query('COMMIT');
      } catch (e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
      // CORRECCIÓN: 202 Accepted + Location: "lo recibí; el resultado estará en este recurso".
      return send(res, 202, { id, status: 'pending' }, { location: `/jobs/${id}` });
    }

    // CORRECCIÓN: recurso de estado que el cliente consulta (Retry-After mientras esté pendiente).
    const m = /^\/jobs\/([0-9a-f-]{36})$/.exec(req.url ?? '');
    if (req.method === 'GET' && m) {
      const { rows } = await pool.query('SELECT id, status, result, error, attempts FROM summary_jobs WHERE id = $1', [m[1]]);
      if (!rows[0]) return send(res, 404, { error: 'no existe' });
      return send(res, 200, rows[0], rows[0].status === 'pending' ? { 'retry-after': '1' } : {});
    }
    send(res, 404, { error: 'ruta desconocida' });
  } catch (e) {
    send(res, 500, { error: String(e) });
  }
});
server.listen(PORT, '0.0.0.0', () => console.log(`llm-api DESPUÉS (202 + cola) en ${PORT}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
