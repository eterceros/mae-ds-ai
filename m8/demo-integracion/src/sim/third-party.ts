// SIMULADOR — El «tercero» (I3): la API de un ERP o de un servicio externo que recibe pedidos.
//   POST /v1/orders     acepta un pedido (201) si hay cupo; si no, 429 + Retry-After (segundos)
//   GET  /stats         contadores para el script de medición
//   POST /reset         pone los contadores en cero
// Límite: cubeta de fichas (token bucket) de RATE fichas/s y capacidad BURST. Cada pedido aceptado
// tarda entre 20 y 60 ms. Con probabilidad FAIL_RATE responde 503 (falla pasajera, sin procesar nada).
// Con la cabecera Idempotency-Key, un pedido repetido no se registra dos veces (responde 200).
import http from 'node:http';
import { THIRD_PARTY_PORT, sleep } from '../lib/config.ts';

const RATE = Number(process.env.RATE ?? 50);
const BURST = Number(process.env.BURST ?? RATE);
const FAIL_RATE = Number(process.env.FAIL_RATE ?? 0.02);

let tokens = BURST, last = performance.now();
let stats = { requests: 0, accepted: 0, duplicates: 0, rejected429: 0, failed503: 0, maxInFlight: 0, perSecond: {} as Record<number, number> };
let seen = new Set<string>();
let inFlight = 0, t0 = Date.now();

function take(): number {   // 0 si hay ficha; si no, segundos hasta la próxima
  const now = performance.now();
  tokens = Math.min(BURST, tokens + ((now - last) / 1000) * RATE);
  last = now;
  if (tokens >= 1) { tokens -= 1; return 0; }
  return (1 - tokens) / RATE;
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') { res.end('ok'); return; }
  if (req.method === 'GET' && req.url === '/stats') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ...stats, unique: seen.size })); return; }
  if (req.method === 'POST' && req.url === '/reset') {
    stats = { requests: 0, accepted: 0, duplicates: 0, rejected429: 0, failed503: 0, maxInFlight: 0, perSecond: {} };
    seen = new Set(); tokens = BURST; last = performance.now(); t0 = Date.now(); res.end('ok'); return;
  }
  if (req.method !== 'POST' || req.url !== '/v1/orders') { res.statusCode = 404; res.end(); return; }
  let body = '';
  for await (const chunk of req) body += chunk;
  stats.requests++;
  const wait = take();
  if (wait > 0) {
    stats.rejected429++;
    // Retry-After en segundos enteros (RFC 9110): se redondea hacia arriba, mínimo 1.
    res.writeHead(429, { 'retry-after': String(Math.max(1, Math.ceil(wait))) }).end('rate limited');
    return;
  }
  if (Math.random() < FAIL_RATE) { stats.failed503++; res.writeHead(503).end('try later'); return; }
  inFlight++; stats.maxInFlight = Math.max(stats.maxInFlight, inFlight);
  await sleep(20 + Math.random() * 40);
  inFlight--;
  const key = String(req.headers['idempotency-key'] ?? JSON.parse(body).order_id);
  if (seen.has(key)) { stats.duplicates++; res.writeHead(200).end('already received'); return; }
  seen.add(key);
  stats.accepted++;
  const sec = Math.floor((Date.now() - t0) / 1000);
  stats.perSecond[sec] = (stats.perSecond[sec] ?? 0) + 1;
  res.writeHead(201).end('created');
});
server.listen(THIRD_PARTY_PORT, '127.0.0.1', () => console.log(`tercero en ${THIRD_PARTY_PORT}: ${RATE}/s, ráfaga ${BURST}, 503 ${FAIL_RATE * 100} % (pid ${process.pid})`));
