// Servicio de precios: GET /precios/:sku -> { sku, cents }.
// Node sin framework. Es el mismo en antes/ y despues/: la lentitud es el problema que hay que
// ENCONTRAR (OA), no lo que se corrige en esta sesión.
import { createServer } from 'node:http';
import { PORT, SLOW_EVERY, SLOW_MS } from './lib/config.js';

let n = 0;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://x');
  if (url.pathname === '/salud') { res.end('ok'); return; }
  const m = /^\/precios\/([\w-]+)$/.exec(url.pathname);
  if (req.method !== 'GET' || !m) { res.statusCode = 404; res.end(); return; }
  n++;
  // 1 de cada SLOW_EVERY: la "consulta a la tarifa del proveedor" tarda SLOW_MS; las demás, 2-5 ms.
  await sleep(n % SLOW_EVERY === 0 ? SLOW_MS : 2 + Math.floor(Math.random() * 4));
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({ sku: m[1], cents: 1000 + (m[1].length * 137) % 900 }));
});

server.listen(PORT, '0.0.0.0', () => console.log(`precios escuchando en ${PORT} (lenta 1 de cada ${SLOW_EVERY}: ${SLOW_MS} ms)`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
