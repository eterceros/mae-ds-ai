// ANTES (mala práctica para trabajo lento) — E4 (Q7): la petición HTTP espera al LLM.
//   POST /sync/summaries  llama al LLM dentro de la petición, con plazo LLM_TIMEOUT_MS -> 504 si vence.
// Cada petición ocupa una conexión y un hueco del LLM mientras dura. Cuando llegan más de las que
// el LLM puede atender, la espera crece hasta el plazo y todo termina en 504; el trabajo abortado
// por el cliente además sigue ocupando al LLM un rato (Q7). Versión corregida: src/despues/llm-api.ts.
import http from 'node:http';
import { summarize } from '../lib/llm.ts';

const PORT = Number(process.env.PORT ?? 3000);
const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS ?? 10000);

async function readJson(req: http.IncomingMessage) {
  let b = ''; for await (const c of req) b += c; return JSON.parse(b || '{}');
}
function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  if (req.method === 'POST' && req.url === '/sync/summaries') {
    const { text } = await readJson(req);
    const t0 = Date.now();
    try {
      const summary = await summarize(text, LLM_TIMEOUT_MS);   // la petición espera aquí
      return send(res, 200, { summary, ms: Date.now() - t0 });
    } catch (e: any) {
      const timeout = e?.name === 'TimeoutError' || e?.name === 'APIUserAbortError' || /abort|timeout/i.test(String(e));
      return send(res, timeout ? 504 : 502, { error: timeout ? 'el LLM no respondió a tiempo' : String(e), ms: Date.now() - t0 });
    }
  }
  send(res, 404, { error: 'ruta desconocida' });
});
server.listen(PORT, '0.0.0.0', () => console.log(`llm-api ANTES (síncrona) en ${PORT}; LLM_URL=${process.env.LLM_URL}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
